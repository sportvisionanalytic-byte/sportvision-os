-- Cinq matchs de championnat existaient en double : une fois par le planning du club, une fois
-- par la fédération.
--
-- ── D'où vient le doublon ──
-- Deux sources décrivent le même calendrier, et elles ne nomment rien pareil :
--
--   planning du club (.xlsx)   « Séniors R2 » contre « St Geneviève », compétition « Championnat »
--   fédération (SportCorico)   « Seniors 1 » contre « Ste Genevieve FC Seniors 2 », « Seniors R2 »
--
-- Aucune des gardes anti-doublon existantes ne pouvait les voir. `club_matches_fallback_uniq`
-- compare `lower(opponent)` : « st geneviève » et « ste genevieve fc seniors 2 » sont deux
-- chaînes différentes. Et `club_matches_provider_external_uniq` ne s'applique qu'aux lignes qui
-- portent un identifiant de source — le planning du club n'en a aucun.
--
-- Ce qui les identifie vraiment : MÊME équipe, MÊME date, MÊME heure de coup d'envoi, MÊME
-- domicile/extérieur. Une équipe ne joue pas deux rencontres différentes au même instant.
--
-- ── Pourquoi on ne pose PAS d'index unique là-dessus ──
-- C'était l'intention. La vérification l'a interdite : sur les 15 collisions (équipe, date,
-- heure) du club, DIX opposent deux matchs FÉDÉRAUX, avec deux adversaires différents. Elles
-- viennent des équipes surclassées — « U14 D1 » est engagée en U14 D2 ET en U15 D1, la même
-- ligne `club_teams` porte donc deux engagements distincts, parfois programmés à la même heure.
-- Ce sont de vrais conflits d'agenda que le club doit voir et arbitrer, pas des doublons à
-- fusionner. Un index unique les aurait rejetés à la prochaine synchro.
--
-- On ne supprime donc que ce qu'on a vérifié un par un : les cinq lignes issues du planning du
-- club qui redisent une rencontre fédérale.
--
-- ── Pourquoi c'est la ligne du club qui part ──
-- Celle de la fédération est plus riche sur tous les points : le nom exact de l'adversaire, le
-- stade officiel, l'identifiant de source (donc les mises à jour de date à venir), le slug du
-- club adverse (donc l'écusson), et le score officiel quand il sortira.
--
-- ── Rien n'est perdu ──
-- Vérifié avant écriture, ligne par ligne : les cinq n'ont ni score, ni buteurs, ni homme du
-- match, ni commentaire, ni prise en charge, ni aucune couverture (`planned_presences`) posée
-- dessus. Les quatre tables qui référencent `club_matches` (contenus, planned_presences,
-- prestations en SET NULL, coverage_wishes en CASCADE) n'ont aucune ligne concernée.

begin;

-- Trace de ce qui est retiré : sans elle, revenir en arrière demanderait de rejouer un import.
create table if not exists public.club_matches_doublons_supprimes (
  supprime_le timestamptz not null default now(),
  motif text not null,
  ligne jsonb not null
);

with doublons as (
  select a.id
    from public.club_matches a
    join public.club_matches b
      on b.club_id = a.club_id
     and b.team_id = a.team_id
     and b.match_date = a.match_date
     and b.kickoff_time = a.kickoff_time
     and coalesce(b.is_home, true) = coalesce(a.is_home, true)
     and b.provider = 'SPORTCORICO'
   where a.provider = 'OTHER'
     and a.team_id is not null
     and a.match_date is not null
     and a.kickoff_time is not null
     -- Aucune saisie du club dessus : la garde vaut autant que la vérification manuelle, et elle
     -- protège si cette migration est rejouée un jour sur d'autres données.
     and a.score is null
     and a.scorers is null
     and a.man_of_match is null
     and a.comment is null
     and a.taken_by is null
     and not exists (select 1 from public.planned_presences pp where pp.match_id = a.id)
)
insert into public.club_matches_doublons_supprimes (motif, ligne)
select 'planning club redisant une rencontre federale (equipe+date+heure+domicile)',
       to_jsonb(m)
  from public.club_matches m
 where m.id in (select id from doublons);

-- On supprime exactement ce qui vient d'être tracé, jamais un ensemble recalculé : entre les deux
-- requêtes, la trace est la seule liste qui fasse foi.
delete from public.club_matches m
 using public.club_matches_doublons_supprimes d
 where d.supprime_le > now() - interval '1 minute'
   and m.id = (d.ligne->>'id')::uuid;

commit;
