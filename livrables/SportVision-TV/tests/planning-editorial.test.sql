-- Le planning éditorial du CM (migration v141, 11/09/2026).
--
-- Ce que ce test tient pour vrai, sur Villemomble et avec des personas fictifs :
--   • le CM affecté crée un contenu pour les Seniors R2 vendredi 18:00, le déplace à 19:00, change
--     le réseau, le duplique, supprime la copie ; tout est conservé ;
--   • un second CM du club supprime un brouillon du premier ;
--   • un coach, un CM d'un autre club : aucune mutation ; le président lit ce qui est sorti du
--     brouillon et ne modifie rien ;
--   • un contenu publié ne se supprime pas et ne se reprogramme pas ; il s'archive.
-- Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table ctx on commit drop as
  select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid club_id,
         (select portail_client_id from clubs where id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54') client_id,
         (select id from clubs where nom = 'Villeneuve 340 SC') autre_club,
         (select id from club_teams where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54' order by (name ilike '%senior%') desc, name limit 1) team_id,
         (current_date + ((5 - extract(dow from current_date)::int + 7) % 7) + 7)::date vendredi;
grant select on ctx to authenticated;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f2f2f2f2-0000-0000-0000-000000000001','qa-pe-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-0000-0000-0000-000000000002','qa-pe-cm2@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-0000-0000-0000-000000000003','qa-pe-cm-autre@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-0000-0000-0000-000000000004','qa-pe-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('f2f2f2f2-0000-0000-0000-000000000005','qa-pe-president@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('f2f2f2f2-0000-0000-0000-000000000001','QA','CM','cm',true),
  ('f2f2f2f2-0000-0000-0000-000000000002','QA','CM 2','cm',true),
  ('f2f2f2f2-0000-0000-0000-000000000003','QA','CM autre','cm',true)
on conflict (id) do update set role = excluded.role;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'f2f2f2f2-0000-0000-0000-000000000001'::uuid, 'secondaire', current_date, true from ctx union all
select club_id, 'f2f2f2f2-0000-0000-0000-000000000002'::uuid, 'secondaire', current_date, true from ctx union all
select autre_club, 'f2f2f2f2-0000-0000-0000-000000000003'::uuid, 'secondaire', current_date, true from ctx;
insert into club_members (user_id, club_id, role, status, teams)
select 'f2f2f2f2-0000-0000-0000-000000000004'::uuid, club_id, 'coach', 'actif', '[]'::jsonb from ctx union all
select 'f2f2f2f2-0000-0000-0000-000000000005'::uuid, club_id, 'president', 'actif', '[]'::jsonb from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create temp table memo (cle text primary key, v text) on commit drop;
grant select, insert on memo to authenticated;
create or replace function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text := 'autorisé'; n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql; get diagnostics n = row_count; if n = 0 then v := 'sans effet'; end if;
  exception when others then v := 'refusé'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;
create or replace function pg_temp.lu(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into v; exception when others then v := 'erreur : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, 'nul');
end $$;
create or replace function pg_temp.c(p_cle text) returns text language sql as $$ select v from memo where cle = p_cle $$;

-- ── Le CM construit son planning ──
insert into verdicts (controle, attendu, obtenu) values ('CM : créer « Matchday Seniors R2 » vendredi 18:00, Instagram', 'autorisé',
  pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000001', $q$with x as (insert into contenus (client_id, cm_id, titre, type_contenu, plateforme, date_prevue, heure_prevue, team_id, statut)
    select client_id, 'f2f2f2f2-0000-0000-0000-000000000001', 'Matchday Seniors R2', 'carrousel', 'instagram', vendredi, '18:00', team_id, 'brouillon' from ctx returning id)
    insert into memo select 'c1', id::text from x$q$));
insert into verdicts (controle, attendu, obtenu) values ('CM : le retrouver dans le planning du club', '1',
  pg_temp.lu('f2f2f2f2-0000-0000-0000-000000000001', 'select count(*)::text from contenus where client_id = (select client_id from ctx) and id = ''' || pg_temp.c('c1') || ''''));
insert into verdicts (controle, attendu, obtenu) values ('CM : passer à 19:00 et Instagram + Facebook', 'autorisé',
  pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000001', 'update contenus set heure_prevue = ''19:00'', plateforme = ''instagram,facebook'' where id = ''' || pg_temp.c('c1') || ''''));
insert into verdicts (controle, attendu, obtenu) values ('les changements sont conservés', '19:00/instagram,facebook',
  (select to_char(heure_prevue, 'HH24:MI') || '/' || plateforme from contenus where id = pg_temp.c('c1')::uuid));
insert into verdicts (controle, attendu, obtenu) values ('CM : dupliquer', 'autorisé',
  pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000001', $q$with x as (insert into contenus (client_id, cm_id, titre, type_contenu, plateforme, date_prevue, heure_prevue, team_id, statut)
    select client_id, 'f2f2f2f2-0000-0000-0000-000000000001', titre || ' (copie)', type_contenu, plateforme, date_prevue, heure_prevue, team_id, 'brouillon' from contenus where id = '$q$ || pg_temp.c('c1') || $q$' returning id)
    insert into memo select 'c2', id::text from x$q$));
insert into verdicts (controle, attendu, obtenu) values ('un second CM du club : supprimer la copie', 'autorisé',
  pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000002', 'delete from contenus where id = ''' || pg_temp.c('c2') || ''''));
insert into verdicts (controle, attendu, obtenu) values ('la copie a disparu, l''original reste', '0/1',
  (select count(*) filter (where id = pg_temp.c('c2')::uuid)::text || '/' || count(*) filter (where id = pg_temp.c('c1')::uuid)::text from contenus));

-- ── Ceux qui ne construisent pas le planning ──
insert into verdicts (controle, attendu, obtenu) values
 ('CM d''un autre club : modifier', 'sans effet', pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000003', 'update contenus set heure_prevue = ''08:00'' where id = ''' || pg_temp.c('c1') || '''')),
 ('CM d''un autre club : créer pour ce club', 'refusé', pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000003', $q$insert into contenus (client_id, cm_id, titre, statut) select client_id, 'f2f2f2f2-0000-0000-0000-000000000003', 'intrus', 'brouillon' from ctx$q$)),
 ('coach : créer', 'refusé', pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000004', $q$insert into contenus (client_id, cm_id, titre, statut) select client_id, 'f2f2f2f2-0000-0000-0000-000000000004', 'coach', 'brouillon' from ctx$q$)),
 ('coach : modifier', 'sans effet', pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000004', 'update contenus set titre = ''x'' where id = ''' || pg_temp.c('c1') || '''')),
 ('président : ne voit pas un brouillon', '0', pg_temp.lu('f2f2f2f2-0000-0000-0000-000000000005', 'select count(*)::text from contenus where id = ''' || pg_temp.c('c1') || ''''));
-- Le workflow éditorial existant : brouillon → à valider en interne → à valider par le club.
update contenus set statut = 'a_valider_interne' where id = pg_temp.c('c1')::uuid;
update contenus set statut = 'a_valider_client' where id = pg_temp.c('c1')::uuid;
insert into verdicts (controle, attendu, obtenu) values
 ('président : lit le contenu à valider', '1', pg_temp.lu('f2f2f2f2-0000-0000-0000-000000000005', 'select count(*)::text from contenus where id = ''' || pg_temp.c('c1') || '''')),
 ('président : modifier directement', 'sans effet', pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000005', 'update contenus set titre = ''x'' where id = ''' || pg_temp.c('c1') || ''''));

-- ── Un contenu publié appartient à l'historique ──
update contenus set statut = 'valide' where id = pg_temp.c('c1')::uuid;
update contenus set statut = 'programme' where id = pg_temp.c('c1')::uuid;
update contenus set statut = 'publie', date_publication = vendredi from ctx where contenus.id = pg_temp.c('c1')::uuid;
insert into verdicts (controle, attendu, obtenu) values
 ('publié : supprimer', 'sans effet', pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000001', 'delete from contenus where id = ''' || pg_temp.c('c1') || '''')),
 ('publié : reprogrammer', 'refusé', pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000001', 'update contenus set heure_prevue = ''20:00'' where id = ''' || pg_temp.c('c1') || '''')),
 ('publié : archiver', 'autorisé', pg_temp.fait('f2f2f2f2-0000-0000-0000-000000000001', 'update contenus set statut = ''archive'' where id = ''' || pg_temp.c('c1') || ''''));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
