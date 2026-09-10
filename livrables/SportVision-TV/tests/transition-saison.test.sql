-- La transition de saison : qui peut la valider, et ce qu'elle ne doit jamais détruire.
--
-- Décision de Fouka, 10/09/2026 : « La transition de saison fait partie de l'administration
-- normale du club. » Le président la valide, au même titre que l'Admin/Owner. Il n'existe pas de
-- workflow préparation/validation : pour la V1, l'action finale est donc Admin/Owner + Président,
-- et le CM comme le coach sont refusés.
--
-- Deux gestes font la transition, et les deux sont couverts :
--   1. `renew_season_membership`, joueur par joueur ;
--   2. l'UPDATE de `clubs.saison` — le basculement lui-même. Le CM affecté pouvait le faire par
--      un simple UPDATE, sans passer par l'écran (`clubs_cm_affecte_update`).
--
-- Et l'invariant : passer de 2026-2027 à 2027-2028 ne supprime rien. L'ancien rattachement est
-- archivé, le nouveau est créé, la décision est journalisée.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste.

begin;

-- Le décor se pose en `service_role` : la Management API s'exécute en `postgres`, que les
-- protections de club_members (v114) traitent comme un inconnu.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  select c.id as club_id, c.saison as saison_avant,
         (split_part(c.saison, '-', 1)::int + 1)::text || '-' || (split_part(c.saison, '-', 2)::int + 1)::text as saison_apres,
         (select t.id from club_teams t where t.club_id = c.id and not coalesce(t.archivee, false) order by t.name limit 1) as team_id
    from clubs c
   where c.id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54';
grant select on ctx to authenticated;

-- ── Les personnes : une par niveau d'autorité ──
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001','zz-saison-admin@example.invalid','',now(),'authenticated','authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002','zz-saison-president@example.invalid','',now(),'authenticated','authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000003','zz-saison-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000004','zz-saison-coach@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into club_members (user_id, club_id, role, status, teams)
select 'bbbbbbbb-0000-0000-0000-000000000001'::uuid, club_id, 'admin', 'actif', '[]'::jsonb from ctx
union all
select 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, club_id, 'president', 'actif', '[]'::jsonb from ctx
union all
select 'bbbbbbbb-0000-0000-0000-000000000004'::uuid, club_id, 'coach', 'actif',
       to_jsonb(array[(select name from club_teams where id = (select team_id from ctx))]) from ctx;

insert into profiles (id, prenom, nom, role) values ('bbbbbbbb-0000-0000-0000-000000000003','QA','CM','cm')
on conflict (id) do update set role = 'cm';
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'bbbbbbbb-0000-0000-0000-000000000003', 'secondaire', current_date, true from ctx;

-- Un joueur par tentative, pour que chaque refus se mesure sur une ligne intacte.
create temp table joueurs (qui text, player_id uuid, membership_id uuid) on commit drop;
grant select on joueurs to authenticated;

do $$
declare v_qui text; v_player uuid; v_tm uuid;
begin
  foreach v_qui in array array['admin','president','cm','coach'] loop
    insert into player_profiles (prenom, nom, date_naissance, club_id)
    values ('QA', 'Saison ' || v_qui, date '2012-01-01', (select club_id from ctx))
    returning id into v_player;
    insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_player, (select team_id from ctx), (select club_id from ctx), (select saison_avant from ctx), 'active')
    returning id into v_tm;
    insert into joueurs values (v_qui, v_player, v_tm);
  end loop;
end $$;

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;

create temp table mesure_avant on commit drop as
  select (select count(*) from team_memberships) as rattachements,
         (select count(*) from player_profiles) as joueurs,
         (select count(*) from club_matches) as matchs;

-- Renouvelle le joueur de `qui`, sous l'identité de `qui`, et note le verdict.
create or replace function pg_temp.essayer_renouveler(p_qui text, p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform renew_season_membership((select membership_id from joueurs where qui = p_qui), 'renouvele', null,
                                    (select saison_apres from ctx));
    insert into verdicts values ('renouveler un joueur — ' || p_qui, null, 'autorisé');
  exception when others then
    insert into verdicts values ('renouveler un joueur — ' || p_qui, null, 'refusé');
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;

-- Tente de basculer la saison du club, sous l'identité de `qui`, et note le verdict mesuré en
-- base (une policy peut filtrer la ligne sans lever d'erreur : on relit la valeur).
create or replace function pg_temp.essayer_basculer(p_qui text, p_uid uuid) returns void
language plpgsql as $$
declare v_saison text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update clubs set saison = (select saison_apres from ctx) where id = (select club_id from ctx);
  exception when others then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select saison into v_saison from clubs where id = (select club_id from ctx);
  insert into verdicts values ('basculer la saison du club — ' || p_qui, null,
    case when v_saison = (select saison_apres from ctx) then 'autorisé' else 'refusé' end);
  -- Remettre la saison d'origine pour que la tentative suivante parte du même état.
  update clubs set saison = (select saison_avant from ctx) where id = (select club_id from ctx);
end $$;

select pg_temp.essayer_renouveler('cm',        'bbbbbbbb-0000-0000-0000-000000000003');
select pg_temp.essayer_renouveler('coach',     'bbbbbbbb-0000-0000-0000-000000000004');
select pg_temp.essayer_renouveler('president', 'bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.essayer_renouveler('admin',     'bbbbbbbb-0000-0000-0000-000000000001');

select pg_temp.essayer_basculer('cm',        'bbbbbbbb-0000-0000-0000-000000000003');
select pg_temp.essayer_basculer('coach',     'bbbbbbbb-0000-0000-0000-000000000004');
select pg_temp.essayer_basculer('president', 'bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.essayer_basculer('admin',     'bbbbbbbb-0000-0000-0000-000000000001');

update verdicts set attendu = case when controle like '%— president' or controle like '%— admin' then 'autorisé' else 'refusé' end;

-- ── Rien n'a été détruit ──
insert into verdicts
select 'aucun rattachement supprimé', 'oui',
       case when (select count(*) from team_memberships) >= (select rattachements from mesure_avant) then 'oui' else 'non' end
union all
select 'aucun joueur supprimé', 'oui',
       case when (select count(*) from player_profiles) = (select joueurs from mesure_avant) then 'oui' else 'non' end
union all
select 'aucun match supprimé', 'oui',
       case when (select count(*) from club_matches) = (select matchs from mesure_avant) then 'oui' else 'non' end
union all
select 'ancien rattachement du président archivé, pas supprimé', 'oui',
       case when exists (select 1 from team_memberships where id = (select membership_id from joueurs where qui = 'president')
                                                        and statut = 'archivee') then 'oui' else 'non' end
union all
select 'nouveau rattachement créé sur la saison suivante', 'oui',
       case when exists (select 1 from team_memberships
                          where player_id = (select player_id from joueurs where qui = 'president')
                            and saison = (select saison_apres from ctx) and statut = 'active') then 'oui' else 'non' end
union all
select 'décision journalisée', 'oui',
       case when exists (select 1 from season_membership_renewals
                          where from_team_membership_id = (select membership_id from joueurs where qui = 'president')) then 'oui' else 'non' end
union all
select 'rattachement du CM intact', 'oui',
       case when exists (select 1 from team_memberships where id = (select membership_id from joueurs where qui = 'cm')
                                                        and statut = 'active') then 'oui' else 'non' end;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
