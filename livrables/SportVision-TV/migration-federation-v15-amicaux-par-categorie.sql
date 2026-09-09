-- Amicaux de categorie, U14 B, et retrait du match en double des U18 feminines.
--
-- Trois demandes de Fouka du 09/09/2026, dans une seule transaction.
--
-- ═══ 1. « la B oui c d4 » ═══
-- Les deux amicaux marques « U14 B » et « U14B » (Val d'Europe le 29/08, Mitry Mory le 05/09)
-- reviennent a l'equipe aujourd'hui nommee « U14 D4 ». Je ne les avais pas rattaches faute de
-- certitude : la lettre tombait bien, ce qui n'est pas une preuve.
--
-- ═══ 2. « pour les match amicaux c du coup toute les equipe convie de la categorie » ═══
-- Un amical marque « U10 » ne designe pas une equipe : les quatre U10 y sont conviees. Or un match
-- ne porte qu'une equipe. Pour que chacune le voie dans SON calendrier — c'est bien l'interet, le
-- coach comme la production regardent le calendrier de leur equipe — le match est duplique une
-- fois par equipe de la categorie, exactement comme un creneau d'entrainement partage l'est deja.
--
-- Le libelle `team` devient le nom de l'equipe ; l'intitule d'origine (« U10 », « U11/12 ») reste
-- dans `comment`, pour qu'on sache d'ou vient la ligne et qu'on ne la prenne pas pour une saisie.
--
-- Seules les equipes MASCULINES sont conviees : ces amicaux viennent du planning masculin, et les
-- equipes feminines (U11 F, U12 F) ont leur propre calendrier. « U11/12 » convie les deux
-- categories.
--
-- Un cas reste sans equipe : l'amical « U15 » du 05/09 contre CO Vincennes. Le club n'a plus
-- aucune equipe U15 masculine engagee cette saison (U15 D2 a ete mise de cote), et la seule U15
-- restante est feminine. On ne le rattache pas.
--
-- ═══ 3. « ok ba retir sa doir etre un bug » ═══
-- L'equipe U18 feminine se retrouvait avec deux matchs le 19/09, coupe a 15h a l'exterieur et
-- championnat a 17h15 a domicile. Le match de coupe part ; le championnat, lui, s'inscrit dans
-- une serie de 18 rencontres coherentes.
--
-- ATTENTION, ce match existait dans les DEUX sources, sous deux orthographes d'adversaire que
-- rien ne rapprochait : « Paris Xiii ES » cote federal, « ES Paris XIII » cote fichier du club.
-- C'est pour cela que le nettoyage des doublons (v6) ne l'avait pas vu — il comparait les sept
-- premiers caracteres de l'adversaire. Supprimer la seule ligne federale ne suffisait donc pas,
-- et laissait en place la version du fichier, la moins bonne des deux (ni competition, ni lieu).
-- Les deux partent.
--
-- Reversible : le match est identifie chez la source (external_event_id), un rechargement de la
-- saison le ramenerait s'il s'avere avoir ete joue.

begin;

-- ── 1. U14 B ──
update public.club_matches m
   set team_id = (select id from public.club_teams
                   where club_id = m.club_id and name = 'U14 D4' and coalesce(archivee, false) = false)
 where m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and m.provider = 'OTHER'
   and m.team in ('U14 B', 'U14B');

-- ── 3. Le match de coupe en trop, dans les deux sources ──
-- Fait avant la duplication des amicaux, pour ne pas le recopier.
delete from public.club_matches m
 using public.club_teams t
 where t.id = m.team_id
   and m.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and m.match_date = '2026-09-19'
   and (
     (m.provider = 'SPORTCORICO' and m.team = 'U18 F 1')   -- la ligne federale
     or (m.provider = 'OTHER' and t.name = 'U18 F')        -- la meme, venue du fichier du club
   );

-- ── 2. Les amicaux de categorie ──
do $$
declare
  v_club uuid := 'f0d3bafa-3004-4831-bd85-249aa9af5c54';
  r record;
  e record;
  premiere boolean;
begin
  for r in
    select m.id, m.team, m.opponent, m.match_date, m.kickoff_time, m.lieu, m.competition,
           m.is_home, m.saison_id, m.provider,
           -- Le libelle du fichier du club vers la ou les categories concernees.
           case m.team
             when 'U11/12' then array['U11', 'U12']
             else array[m.team]
           end as categories
      from public.club_matches m
     where m.club_id = v_club
       and m.team_id is null
       and m.provider = 'OTHER'
       and m.team in ('U10', 'U11', 'U12', 'U14', 'U16', 'U11/12')
  loop
    premiere := true;
    for e in
      select t.id, t.name
        from public.club_teams t
       where t.club_id = v_club
         and coalesce(t.archivee, false) = false
         and t.section = 'Masculin'
         and t.categorie = any (r.categories)
       order by t.name
    loop
      if premiere then
        -- La ligne d'origine sert pour la premiere equipe : on ne cree pas une ligne de plus que
        -- necessaire, et l'identifiant du match reste stable pour qui l'aurait deja ouvert.
        update public.club_matches
           set team_id = e.id,
               team = e.name,
               comment = coalesce(comment || ' · ', '') || 'Amical de catégorie « ' || r.team || ' » : toutes les équipes conviées.'
         where id = r.id;
        premiere := false;
      else
        insert into public.club_matches
          (club_id, team, team_id, opponent, match_date, kickoff_time, lieu, competition,
           is_home, provider, saison_id, comment)
        values
          (v_club, e.name, e.id, r.opponent, r.match_date, r.kickoff_time, r.lieu, r.competition,
           r.is_home, r.provider, r.saison_id,
           'Amical de catégorie « ' || r.team || ' » : toutes les équipes conviées.')
        on conflict do nothing;
      end if;
    end loop;
  end loop;
end $$;

commit;
