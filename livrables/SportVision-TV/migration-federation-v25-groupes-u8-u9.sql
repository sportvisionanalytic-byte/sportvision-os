-- Les groupes U8 A/B et U9 A/B existent : on les crée.
--
-- Fouka, 09/09/2026 : « c'est des groupes, il y a U8 A et U8 B et U9 A et B ».
--
-- ── Ce que le planning municipal écrit, et ce qu'il ne dit pas ──
-- Deux écritures cohabitent, et la distinction n'est pas fortuite :
--
--   « U8A-U8B-U9A-U9B » (mardi, Mimoun) et « U8A-U8B » (jeudi, Mimoun)
--        → les groupes sont nommés un par un. Aucune ambiguïté.
--
--   « U8-U9 » (mardi, Ripert) et « U8-U9-U11F » (mercredi, Ripert)
--        → la catégorie, sans distinguer les groupes.
--
-- On rattache donc les deux premières cellules aux groupes nommés, et on laisse les deux autres
-- sur les équipes « U8 » et « U9 », qui désignent la catégorie entière. Elles portent d'ailleurs
-- chacune un match amical libellé « U8 » / « U9 » : les supprimer perdrait ce rattachement.
--
-- ── Ce qui reste ouvert, et qu'on ne devine pas ──
-- Le mardi à 17h30, le planning réserve DEUX terrains : Mimoun pour les quatre groupes, Ripert
-- pour « U8-U9 ». Les mêmes enfants ne peuvent pas être aux deux endroits ; le club répartit
-- vraisemblablement ses groupes sur les deux terrains, mais le planning ne dit pas lequel va où.
-- Tant qu'on ne le sait pas, écrire une répartition serait inventer un fait.

begin;

-- ── 1. Les quatre groupes ──
insert into public.club_teams (club_id, name, categorie, categories, section, saison_id)
select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid, v.name, v.categorie, array[v.categorie], 'Masculin',
       'edc14e27-71c2-4b6e-90fb-ac6e79a5c0b0'::uuid
  from (values ('U8 A','U8'), ('U8 B','U8'), ('U9 A','U9'), ('U9 B','U9')) as v(name, categorie)
 where not exists (
   select 1 from public.club_teams t
    where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' and t.name = v.name
 );

-- ── 2. Les créneaux qui nomment les groupes leur reviennent ──
-- Une ligne par groupe cité, comme pour tout créneau partagé : chaque équipe doit voir la séance
-- dans SON calendrier. `distinct` parce que le créneau du mardi existe en double (une ligne pour
-- U8, une pour U9) avec les mêmes notes — sans lui on tenterait d'insérer deux fois la même chose.
insert into public.club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id, notes)
select distinct g.id, s.jour, s.heure_debut, s.heure_fin, s.venue_id, s.notes
  from public.club_team_training_slots s
  join public.club_teams t on t.id = s.team_id
  join public.club_teams g
    on g.club_id = t.club_id
   and g.name = any (
     -- Les groupes réellement cités dans cette cellule, et eux seuls : le créneau du jeudi ne
     -- nomme que les U8, il ne doit pas convoquer les U9.
     array_remove(array[
       case when s.notes like '%U8A%' then 'U8 A' end,
       case when s.notes like '%U8B%' then 'U8 B' end,
       case when s.notes like '%U9A%' then 'U9 A' end,
       case when s.notes like '%U9B%' then 'U9 B' end
     ], null)
   )
 where t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and t.name in ('U8', 'U9')
   and s.notes like '%U8A-U8B%'
on conflict do nothing;

-- ── 3. Les lignes d'origine n'ont plus lieu d'être sur ces deux créneaux ──
-- Les groupes les portent désormais nommément ; laisser « U8 » dessus ferait apparaître la
-- catégorie ET ses groupes sur la même séance.
delete from public.club_team_training_slots s
 using public.club_teams t
 where t.id = s.team_id
   and t.club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and t.name in ('U8', 'U9')
   and s.notes like '%U8A-U8B%';

commit;
