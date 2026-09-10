-- Retrouver un joueur par son nom ne se fait pas sans compte.
--
-- Trouvé le 10/09/2026, en balayant les fonctions du même type que le calendrier ouvert (v120) :
-- `find_player_match_candidates(club, prénom, nom, …)` s'exécutait avec les droits du
-- propriétaire, sans aucun contrôle, et restait appelable par `anon`. Connaître le club et le nom
-- d'un enfant suffisait à obtenir son identifiant et sa DATE DE NAISSANCE. La base ne comptait
-- encore aucun joueur : rien n'a pu fuir, mais la porte aurait servi dès les premières
-- inscriptions. `find_duplicate_club_candidates` rendait de même clubs et SIRET sans compte.
--
-- Ses usages légitimes passent par des fonctions qui contrôlent (match_player_candidates exige
-- l'administration du club, les parcours d'inscription exigent un compte) et qui l'appellent avec
-- leurs propres droits. Retirer l'exécution directe ne leur retire rien : ce test le vérifie.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid as club_id;
grant select on ctx to authenticated, anon;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('abababab-0000-0000-0000-000000000001','zz-rech-admin@example.invalid','',now(),'authenticated','authenticated'),
  ('abababab-0000-0000-0000-000000000002','zz-rech-inconnu@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into club_members (user_id, club_id, role, status, teams)
select 'abababab-0000-0000-0000-000000000001'::uuid, club_id, 'admin', 'actif', '[]'::jsonb from ctx;
insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
select club_id, 'Lina', 'Zzrecherche', date '2014-03-07', 'sans_compte' from ctx;

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated, anon;

create or replace function pg_temp.essai(p_qui text, p_uid uuid, p_sql text, p_attendu text) returns void language plpgsql as $$
declare v_n int; v_ok text;
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
  begin
    execute p_sql into v_n using (select club_id from ctx);
    v_ok := case when v_n > 0 then 'trouve' else 'rien' end;
  exception when others then v_ok := 'refusé';
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into verdicts values (p_qui, p_attendu, case when v_ok = 'trouve' then 'trouve le joueur' else 'ne trouve pas' end);
end $$;

select pg_temp.essai('find_player_match_candidates — visiteur sans compte', null,
  'select count(*) from find_player_match_candidates($1, ''Lina'', ''Zzrecherche'', null, null)', 'ne trouve pas');
select pg_temp.essai('find_player_match_candidates — compte sans lien', 'abababab-0000-0000-0000-000000000002'::uuid,
  'select count(*) from find_player_match_candidates($1, ''Lina'', ''Zzrecherche'', null, null)', 'ne trouve pas');
select pg_temp.essai('match_player_candidates — administrateur du club (usage légitime)', 'abababab-0000-0000-0000-000000000001'::uuid,
  'select count(*) from match_player_candidates($1, ''Lina'', ''Zzrecherche'', null, null)', 'trouve le joueur');
select pg_temp.essai('find_duplicate_club_candidates — visiteur sans compte', null,
  'select count(*) from find_duplicate_club_candidates(null, ''SF Villemomble'', null) where $1 is not null', 'ne trouve pas');

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
