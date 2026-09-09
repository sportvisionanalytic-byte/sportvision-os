-- Nettoyage des doublons de matchs de SF Villemomble, et retrait de U12 ESPOIR.
--
-- Trois nettoyages distincts, tous valides par Fouka le 09/09/2026, tous verifies avant ecriture :
-- aucune des lignes supprimees ne porte de score, de buteur, d'homme du match, de contenu, ni
-- n'est prise par un operateur. Une synchro de calendrier ne doit jamais effacer le travail de
-- quelqu'un, et une suppression se regarde avant de se lancer.

begin;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Doublons INTERNES a la source federale (27 lignes)
-- ═══════════════════════════════════════════════════════════════════════
-- Decouvert en verifiant l'import : SENIORS 3 avait 44 matchs et U14 2 en avait 40, soit
-- exactement le double d'un championnat. La source expose ces deux calendriers deux fois, sous
-- deux identifiants differents pour une meme rencontre (memes date, heure, competition, equipes).
--
-- Mon import dedupliquait sur l'identifiant de la source, ce qui ne pouvait pas voir ce cas.
-- charger-saison-federale.mjs deduplique desormais aussi sur la signature metier
-- (date + heure + equipe + adversaire), et federation-sync-matchs refuse de creer un match
-- identique a un existant.
--
-- On garde le plus petit identifiant : c'est le calendrier d'origine, celui auquel pointent les
-- pages deja publiees par la source.

delete from public.club_matches m
 where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and m.provider = 'SPORTCORICO'
   and exists (
     select 1 from public.club_matches autre
      where autre.club_id = m.club_id
        and autre.provider = m.provider
        and autre.team = m.team
        and autre.opponent = m.opponent
        and autre.match_date = m.match_date
        and autre.kickoff_time is not distinct from m.kickoff_time
        and autre.external_event_id < m.external_event_id
   );

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Doublons entre le fichier Excel du club et la source federale (5 lignes)
-- ═══════════════════════════════════════════════════════════════════════
-- La version federale est meilleure sur tous les plans : identifiant stable (donc un report la met
-- a jour au lieu de la dupliquer), championnat et poule exacts, ecusson de l'adversaire. Ce sont
-- les lignes issues de l'Excel qui partent.
--
-- Les 62 autres matchs de l'Excel restent : amicaux, plateaux U6-U13, tournois — la federation ne
-- les enregistre pas, et ils seraient definitivement perdus.

delete from public.club_matches a
 where a.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and a.provider = 'OTHER'
   and exists (
     select 1 from public.club_matches b
      where b.club_id = a.club_id
        and b.provider = 'SPORTCORICO'
        and b.match_date = a.match_date
        and lower(left(b.opponent, 7)) = lower(left(a.opponent, 7))
   );

-- ═══════════════════════════════════════════════════════════════════════
-- 3. U12 ESPOIR
-- ═══════════════════════════════════════════════════════════════════════
-- Doublon de saisie de l'import Excel, a cote de « U12 Espoir 1 » et « U12 Espoir 2 ». Confirme
-- par le planning municipal : apres le recalage de la serie U12 (A=REG, B=ELITE, C=Espoir 1,
-- D=Espoir 2), c'est la seule equipe U12 qui ne porte aucune lettre.
-- Verifie avant suppression : 0 creneau, 0 match, 0 membre, 0 evenement, 0 rattachement source.

delete from public.club_teams
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and name = 'U12 ESPOIR';

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Le « D4 » du jeudi soir
-- ═══════════════════════════════════════════════════════════════════════
-- La cellule du planning municipal se lit « U14D4 /D4 » et le second code restait illisible meme
-- au zoom. Fouka a tranche : c'est une erreur du planning, il n'y a qu'une equipe sur ce creneau.
-- On le note, pour qu'on ne reparte pas en enquete la prochaine fois qu'on relit ce fichier.

update public.club_team_training_slots s
   set notes = replace(s.notes, 'U14D4-D4', 'U14D4 (le « /D4 » du planning est une erreur, confirmé par le club le 09/09/2026)')
  from public.club_teams t
 where t.id = s.team_id
   and t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and s.notes like '%U14D4-D4%';

commit;
