-- Un membre déjà dans le club accepte l'invitation qu'on lui envoie — et rien de plus.
--
-- Voir migration-comptes-clubplus-v1-acceptation-membre-existant.sql. Avant elle, un coach invité
-- comme directeur sportif, ou le président invité comme coach de son équipe, se heurtaient au
-- trigger `protect_sensitive_club_member_fields` en acceptant par le vrai lien.
--
-- Attendu : les deux acceptations passent, et une personne ne peut toujours pas se donner seule un
-- rôle qu'aucune invitation ne porte, ni toucher la ligne d'un autre.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste. Club de test : Villeneuve 340 SC.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as select '8be55101-0d61-4b27-8d7b-a4761547d88b'::uuid as club_id;
grant select on ctx to authenticated;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('dddddddd-0000-0000-0000-000000000001','zz-mex-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('dddddddd-0000-0000-0000-000000000002','zz-mex-president@example.invalid','',now(),'authenticated','authenticated'),
  ('dddddddd-0000-0000-0000-000000000003','zz-mex-sans-invitation@example.invalid','',now(),'authenticated','authenticated'),
  ('dddddddd-0000-0000-0000-000000000004','zz-mex-autre-role@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into club_members (user_id, club_id, role, status, teams)
select 'dddddddd-0000-0000-0000-000000000001'::uuid, club_id, 'coach', 'actif', '["U16 D3"]'::jsonb from ctx
union all select 'dddddddd-0000-0000-0000-000000000002'::uuid, club_id, 'president', 'actif', '[]'::jsonb from ctx
union all select 'dddddddd-0000-0000-0000-000000000003'::uuid, club_id, 'coach', 'actif', '[]'::jsonb from ctx
union all select 'dddddddd-0000-0000-0000-000000000004'::uuid, club_id, 'coach', 'actif', '[]'::jsonb from ctx;

-- Les invitations, telles que l'Owner Club+ les aurait préparées (service_role ici : c'est leur
-- ACCEPTATION qu'on teste, leur préparation a ses propres tests).
insert into club_invitations (club_id, email, role, teams, token, statut)
select club_id, 'zz-mex-coach@example.invalid', 'directeur_sportif', '[]'::jsonb, 'zz-mex-t1', 'envoyee' from ctx
union all select club_id, 'zz-mex-president@example.invalid', 'coach', '["U18 D2"]'::jsonb, 'zz-mex-t2', 'envoyee' from ctx
union all select club_id, 'zz-mex-autre-role@example.invalid', 'coach', '["U18 D2"]'::jsonb, 'zz-mex-t4', 'envoyee' from ctx;

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;

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

-- 1 · Un coach déjà membre accepte son invitation de directeur sportif.
do $$ declare v text; begin
  perform pg_temp.en('dddddddd-0000-0000-0000-000000000001');
  begin perform accepter_invitation_club('zz-mex-t1'); v := 'accepté'; exception when others then v := 'refusé : ' || sqlerrm; end;
  perform pg_temp.hors();
  insert into verdicts values ('coach → directeur sportif, par son invitation', 'accepté',
    v || ' / rôle=' || (select role from club_members where user_id = 'dddddddd-0000-0000-0000-000000000001'));
end $$;

-- 2 · Le président accepte l'invitation de coach de son équipe : reste président, gagne l'équipe.
do $$ declare v text; begin
  perform pg_temp.en('dddddddd-0000-0000-0000-000000000002');
  begin perform accepter_invitation_club('zz-mex-t2'); v := 'accepté'; exception when others then v := 'refusé : ' || sqlerrm; end;
  perform pg_temp.hors();
  insert into verdicts values ('président invité comme coach', 'accepté',
    v || ' / ' || (select role || ' ' || teams::text from club_members where user_id = 'dddddddd-0000-0000-0000-000000000002'));
end $$;

-- 3 · Sans invitation, personne ne se promeut seul.
do $$ declare v text; begin
  perform pg_temp.en('dddddddd-0000-0000-0000-000000000003');
  begin
    update club_members set role = 'tresorier' where user_id = 'dddddddd-0000-0000-0000-000000000003';
    v := case when (select role from club_members where user_id = 'dddddddd-0000-0000-0000-000000000003') = 'tresorier' then 'accepté' else 'refusé (aucune ligne)' end;
  exception when others then v := 'refusé'; end;
  perform pg_temp.hors();
  insert into verdicts values ('sans invitation, se nommer trésorier', 'refusé', v);
end $$;

-- 4 · Avec une invitation de coach ouverte, on ne se donne pas un AUTRE rôle.
do $$ declare v text; begin
  perform pg_temp.en('dddddddd-0000-0000-0000-000000000004');
  begin
    update club_members set role = 'president' where user_id = 'dddddddd-0000-0000-0000-000000000004';
    v := case when (select role from club_members where user_id = 'dddddddd-0000-0000-0000-000000000004') = 'president' then 'accepté' else 'refusé (aucune ligne)' end;
  exception when others then v := 'refusé'; end;
  begin
    update club_members set role = 'tresorier' where user_id = 'dddddddd-0000-0000-0000-000000000004';
    v := v || ' / ' || case when (select role from club_members where user_id = 'dddddddd-0000-0000-0000-000000000004') = 'tresorier' then 'accepté' else 'refusé (aucune ligne)' end;
  exception when others then v := v || ' / refusé'; end;
  perform pg_temp.hors();
  insert into verdicts values ('invitation coach ouverte : se nommer président / trésorier', 'refusé / refusé', v);
end $$;

-- 5 · Avec une invitation ouverte, on ne touche pas la ligne d'un autre.
do $$ declare v text; begin
  perform pg_temp.en('dddddddd-0000-0000-0000-000000000004');
  begin
    update club_members set role = 'coach', teams = '["U18 D2"]'::jsonb where user_id = 'dddddddd-0000-0000-0000-000000000003';
    v := case when (select teams from club_members where user_id = 'dddddddd-0000-0000-0000-000000000003') = '["U18 D2"]'::jsonb then 'accepté' else 'refusé (aucune ligne)' end;
  exception when others then v := 'refusé'; end;
  perform pg_temp.hors();
  insert into verdicts values ('modifier la ligne d''un autre membre', 'refusé', v);
end $$;

select controle, attendu, obtenu,
       case when obtenu like attendu || '%' or (attendu = 'refusé' and obtenu like 'refusé%')
                 or (attendu = 'refusé / refusé' and obtenu like 'refusé% / refusé%') then 'OK' else 'KO' end as verdict
  from verdicts;

rollback;
