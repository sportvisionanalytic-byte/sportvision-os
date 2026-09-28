-- Une mission par club, par jour et par lieu (migration v133, 10/09/2026), AFFINÉE LE 25/09.
--
-- DÉCOR RENDU EXPLICITE LE 28/09/2026, et c'est tout le sujet. Ce fichier n'écrivait jamais
-- `is_home`, dont la valeur par défaut en base est `true` : les neuf matchs du décor étaient donc
-- TOUS à domicile, sans que le test le dise ni, visiblement, le sache.
--
-- Or la règle a été affinée le 25/09, sur un cas réel : « j'ai créé une mission d'une journée et ça
-- a créé trois missions pour mon responsable production, il faut les réunir en une seule ». Un
-- samedi à Fontainebleau donnait trois missions — « T3 », « T1 », « STADE PHILIPPE MAHUT 2 » —
-- pour trois terrains du MÊME complexe. À domicile, le terrain ne compte donc plus : c'est le même
-- endroit, l'opérateur y passe la journée. À l'extérieur, le lieu compte toujours, et il le faut :
-- on ne peut pas être à Melun et à Provins le même après-midi.
--
-- Conséquence : « autre stade » et « lieu inconnu » ne mesuraient plus rien, puisqu'à domicile tout
-- se regroupe. Les matchs concernés sont désormais déclarés À L'EXTÉRIEUR, ce qui est le scénario
-- que ces vérifications veulent réellement décrire. Et un cas est AJOUTÉ pour verrouiller la
-- décision du 25/09 dans l'autre sens : deux terrains à domicile le même jour = UNE mission.
--
-- Ce que ce test tient pour vrai :
--   • trois matchs le même jour au même stade = une mission, qui dit combien, lesquels, et
--     commence à l'heure du premier ; la Production reçoit une nouvelle mission, puis « match ajouté » ;
--   • à domicile, deux terrains différents le même jour = une seule mission (décision du 25/09) ;
--   • à l'extérieur : autre lieu, ou lieu inconnu = mission à part ;
--   • autre jour, ou mission déjà en cours : mission à part ;
--   • retirer un match d'une mission regroupée garde la mission pour les autres ;
--   • un match ajouté alors qu'une équipe est déjà prévue rejoint la mission, et la Production
--     est invitée à revoir l'équipe.
--
-- Décor fictif (« ZZ »), pôle sans Production réelle. Un adversaire différent par match : la base
-- écarte un second match du même club, même jour, même heure, même adversaire.
-- Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('a7a7a7a7-0000-0000-0000-000000000001','zz-regr-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('a7a7a7a7-0000-0000-0000-000000000002','zz-regr-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('a7a7a7a7-0000-0000-0000-000000000003','zz-regr-photo@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role) values
  ('a7a7a7a7-0000-0000-0000-000000000001','QA','CM','cm'),
  ('a7a7a7a7-0000-0000-0000-000000000002','QA','Production','prod'),
  ('a7a7a7a7-0000-0000-0000-000000000003','QA','Photo','photo')
on conflict (id) do update set role = excluded.role;

create temp table ctx on commit drop as
  with pole as (select id from poles where nom = 'Basket'),
       cli as (insert into clients (nom, statut_relation, pole_id, cm_id)
               select 'ZZ Club Regroupement (test)', 'partenaire', id, 'a7a7a7a7-0000-0000-0000-000000000001' from pole returning id),
       clu as (insert into clubs (nom, portail_client_id) select 'ZZ Club Regroupement (test)', id from cli returning id)
  select (select id from pole) pole_id, (select id from cli) client_id, (select id from clu) club_id, current_date + 5 as j;
grant select on ctx to authenticated;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'a7a7a7a7-0000-0000-0000-000000000001'::uuid, 'principal', current_date, true from ctx;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select pole_id, 'a7a7a7a7-0000-0000-0000-000000000002'::uuid, 'membre', true from ctx;

create temp table m (cle text primary key, id uuid) on commit drop;
grant select on m to authenticated;
-- `domicile` est declare pour CHAQUE match, jamais laisse au defaut : c'est cette colonne qui
-- decide du regroupement, donc l'omettre rendait le decor muet sur ce qu'il mesure.
create temp table decor (k text, equipe text, h time, lieu text, decal int, domicile boolean) on commit drop;
insert into decor values
  ('u10a', 'ZZ U10 A', '09:30', 'Stade Claude Ripert', 0, true),
  ('u10b', 'ZZ U10 B', '10:30', 'Stade Claude Ripert', 0, true),
  ('u10c', 'ZZ U10 C', '11:00', 'stade claude ripert ', 0, true),
  -- Le meme jour, a domicile, sur un AUTRE terrain du complexe : une seule mission (25/09).
  ('autre_terrain', 'ZZ U10 F', '11:30', 'Terrain T3', 0, true),
  -- A l'exterieur, ailleurs : on ne peut pas y etre en meme temps, donc mission a part.
  ('autre_stade', 'ZZ U12', '09:30', 'Gymnase Nord', 0, false),
  ('lendemain', 'ZZ U11 A', '09:30', 'Stade Claude Ripert', 1, true),
  -- A l'exterieur sans lieu connu : on ne devine pas, chacune sa mission.
  ('sans_lieu_1', 'ZZ U13 A', '14:00', null, 0, false),
  ('sans_lieu_2', 'ZZ U13 B', '15:00', null, 0, false),
  ('tard', 'ZZ U10 D', '12:00', 'Stade Claude Ripert', 0, true),
  ('apres_depart', 'ZZ U10 E', '13:00', 'Stade Claude Ripert', 0, true);
insert into club_matches (club_id, team, opponent, match_date, kickoff_time, lieu, is_home)
select ctx.club_id, d.equipe, 'ZZ Adversaire ' || d.k, ctx.j + d.decal, d.h, d.lieu, d.domicile from ctx, decor d;
insert into m select d.k, cm.id from decor d join club_matches cm on cm.team = d.equipe and cm.club_id = (select club_id from ctx);

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;

create or replace function pg_temp.en(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.hors() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.cm(p_sql text) returns text language plpgsql as $$
declare v text := 'autorisé';
begin
  perform pg_temp.en('a7a7a7a7-0000-0000-0000-000000000001');
  begin execute p_sql;
  exception when others then v := 'refusé : ' || sqlerrm; end;
  perform pg_temp.hors();
  return v;
end $$;
create or replace function pg_temp.mission(p_cle text) returns uuid language sql as $$
  select created_prestation_id from planned_presences where match_id = (select id from m where cle = p_cle) and statut <> 'annule'; $$;
create or replace function pg_temp.decider(p_cle text) returns text language sql as $$
  select pg_temp.cm('select cm_definir_couverture(''match:' || (select id from m where cle = p_cle) || ''', ''photo_video'')'); $$;

-- ── Trois matchs, même jour, même stade (casse et espaces différents sur le troisième) ──
select pg_temp.note('décider U10 A, B, C — CM', 'autorisé/autorisé/autorisé',
  pg_temp.decider('u10a') || '/' || pg_temp.decider('u10b') || '/' || pg_temp.decider('u10c'));
select pg_temp.note('une seule mission pour les trois', '1',
  (select count(distinct created_prestation_id)::text from planned_presences
    where match_id in (select id from m where cle in ('u10a', 'u10b', 'u10c')) and statut <> 'annule'));
select pg_temp.note('la mission dit « 3 matchs au même endroit »', 'oui',
  (select case when description_besoin like '%3 matchs au même endroit%' then 'oui' else description_besoin end from prestations where id = pg_temp.mission('u10a')));
select pg_temp.note('ses équipes, dans l''ordre', 'ZZ U10 A, ZZ U10 B, ZZ U10 C',
  (select equipes from prestations where id = pg_temp.mission('u10a')));
select pg_temp.note('elle commence à l''heure du premier match', '09:30',
  (select to_char(heure_debut, 'HH24:MI') from prestations where id = pg_temp.mission('u10a')));
select pg_temp.note('Production : 1 nouvelle mission, puis 2 « match ajouté »', '1/2',
  (select count(*) filter (where type = 'nouvelle_mission')::text || '/' || count(*) filter (where titre = 'Match ajouté à une mission')::text
     from notifications where destinataire_id = 'a7a7a7a7-0000-0000-0000-000000000002'));

-- ── Ce qui reste à part ──
select pg_temp.decider('autre_terrain'), pg_temp.decider('autre_stade'), pg_temp.decider('lendemain'), pg_temp.decider('sans_lieu_1'), pg_temp.decider('sans_lieu_2');
-- Decision du 25/09 : a domicile, le terrain ne compte pas. C'est le cas qui a coute trois missions
-- a un responsable production pour une seule journee a Fontainebleau.
select pg_temp.note('à domicile, un autre terrain rejoint la même mission (25/09)', 'oui',
  case when pg_temp.mission('autre_terrain') = pg_temp.mission('u10a') then 'oui' else 'non' end);
select pg_temp.note('à l''extérieur, un autre lieu fait mission à part', 'oui', case when pg_temp.mission('autre_stade') <> pg_temp.mission('u10a') then 'oui' else 'non' end);
select pg_temp.note('lendemain, même stade : mission à part', 'oui', case when pg_temp.mission('lendemain') <> pg_temp.mission('u10a') then 'oui' else 'non' end);
select pg_temp.note('à l''extérieur, lieu inconnu : pas de regroupement deviné', 'oui', case when pg_temp.mission('sans_lieu_1') <> pg_temp.mission('sans_lieu_2') then 'oui' else 'non' end);

-- ── Retirer un match d'une mission regroupée ──
select pg_temp.note('retirer U10 B — CM', 'autorisé', pg_temp.cm('select cm_annuler_couverture(''match:' || (select id from m where cle = 'u10b') || ''')'));
-- Trois et non deux depuis le 28/09 : le cas « autre terrain a domicile » ajoute plus haut rejoint
-- legitimement cette mission, c'est exactement ce que la decision du 25/09 demande.
select pg_temp.note('la mission reste, pour les trois autres', 'planifiée/3',
  (select p.statut::text || '/' || (select count(*) from planned_presences pp where pp.created_prestation_id = p.id and pp.statut <> 'annule')
     from prestations p where p.id = pg_temp.mission('u10a')));
select pg_temp.note('elle dit maintenant « 3 matchs »', 'oui',
  (select case when description_besoin like '%3 matchs au même endroit%' and equipes = 'ZZ U10 A, ZZ U10 C, ZZ U10 F' then 'oui' else description_besoin || ' | ' || equipes end
     from prestations where id = pg_temp.mission('u10a')));
select pg_temp.note('la Production est prévenue du retrait', '1',
  (select count(*)::text from notifications where destinataire_id = 'a7a7a7a7-0000-0000-0000-000000000002' and titre = 'Match retiré d''une mission'));

-- ── Une équipe est déjà prévue, un match s'ajoute ──
insert into prestations_equipe (prestation_id, collaborateur_id, statut, remuneration)
select pg_temp.mission('u10a'), 'a7a7a7a7-0000-0000-0000-000000000003', 'acceptée', 60;
update prestations set statut = 'équipe_affectée' where id = pg_temp.mission('u10a');
select pg_temp.decider('tard');
select pg_temp.note('le match de 12 h rejoint la mission déjà affectée', 'oui', case when pg_temp.mission('tard') = pg_temp.mission('u10a') then 'oui' else 'non' end);
select pg_temp.note('la Production est invitée à revoir l''équipe', '1',
  (select count(*)::text from notifications where destinataire_id = 'a7a7a7a7-0000-0000-0000-000000000002'
      and titre = 'Match ajouté à une mission' and message like '%Une équipe est déjà prévue%'));

-- ── L'équipe est partie : un nouveau match fait une nouvelle mission ──
update prestations set statut = 'équipe_en_route' where id = pg_temp.mission('u10a');
select pg_temp.decider('apres_depart');
select pg_temp.note('mission déjà en cours : le match de 13 h a sa propre mission', 'oui',
  case when pg_temp.mission('apres_depart') <> pg_temp.mission('u10a') then 'oui' else 'non' end);

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;

rollback;
