-- Le calendrier d'un club ne se lit que par qui a un lien avec ce club.
--
-- Trouvé le 10/09/2026 en construisant la fiche équipe : `club_calendrier` s'exécutait avec les
-- droits de son propriétaire, ne vérifiait rien, et restait appelable SANS COMPTE. Un simple appel
-- anonyme à l'API rendait le calendrier complet de SF Villemomble : matchs, et horaires et lieux
-- des entraînements d'équipes de mineurs.
--
-- Qui doit lire : qui opère le club (Owner, président, CM affecté), tout membre actif (un coach),
-- le staff SportVision hors CM cloisonné, un joueur du club ou le parent confirmé d'un joueur.
-- Qui ne doit pas : un visiteur sans compte, un compte sans lien, un coach ou un CM d'un autre club.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid as club_id,
         (select id from clubs where nom = 'Villeneuve 340 SC') as autre_club,
         date '2026-09-01' as du, date '2026-09-30' as au;
grant select on ctx to authenticated, anon;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ffffffff-0000-0000-0000-000000000001','zz-cal-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('ffffffff-0000-0000-0000-000000000002','zz-cal-coach-autre@example.invalid','',now(),'authenticated','authenticated'),
  ('ffffffff-0000-0000-0000-000000000003','zz-cal-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('ffffffff-0000-0000-0000-000000000004','zz-cal-cm-autre@example.invalid','',now(),'authenticated','authenticated'),
  ('ffffffff-0000-0000-0000-000000000005','zz-cal-joueur@example.invalid','',now(),'authenticated','authenticated'),
  ('ffffffff-0000-0000-0000-000000000006','zz-cal-inconnu@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into club_members (user_id, club_id, role, status, teams)
select 'ffffffff-0000-0000-0000-000000000001'::uuid, club_id, 'coach', 'actif', '[]'::jsonb from ctx
union all
select 'ffffffff-0000-0000-0000-000000000002'::uuid, autre_club, 'coach', 'actif', '[]'::jsonb from ctx;

insert into profiles (id, prenom, nom, role) values
  ('ffffffff-0000-0000-0000-000000000003','QA','CM','cm'),
  ('ffffffff-0000-0000-0000-000000000004','QA','CM autre','cm')
on conflict (id) do update set role = excluded.role;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'ffffffff-0000-0000-0000-000000000003'::uuid, 'secondaire', current_date, true from ctx
union all
select autre_club, 'ffffffff-0000-0000-0000-000000000004'::uuid, 'secondaire', current_date, true from ctx;

insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
select club_id, 'ffffffff-0000-0000-0000-000000000005', 'QA', 'Joueur', date '2010-01-01', 'actif' from ctx;

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated, anon;

-- Lire le calendrier sous l'identité de `qui` (NULL = visiteur sans compte).
create or replace function pg_temp.lire(p_qui text, p_uid uuid, p_attendu text) returns void language plpgsql as $$
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
    select count(*) into v_n from club_calendrier((select club_id from ctx), (select du from ctx), (select au from ctx));
    v_ok := case when v_n > 0 then 'lit' else 'rien' end;
  exception when others then v_ok := 'refusé';
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into verdicts values ('calendrier de Villemomble — ' || p_qui, p_attendu,
    case when v_ok = 'lit' then 'lit' else 'ne lit pas' end);
end $$;

select pg_temp.lire('visiteur sans compte',         null,                                          'ne lit pas');
select pg_temp.lire('compte sans lien',             'ffffffff-0000-0000-0000-000000000006'::uuid, 'ne lit pas');
select pg_temp.lire('coach d''un autre club',       'ffffffff-0000-0000-0000-000000000002'::uuid, 'ne lit pas');
select pg_temp.lire('CM d''un autre club',          'ffffffff-0000-0000-0000-000000000004'::uuid, 'ne lit pas');
select pg_temp.lire('coach du club',                'ffffffff-0000-0000-0000-000000000001'::uuid, 'lit');
select pg_temp.lire('CM affecté au club',           'ffffffff-0000-0000-0000-000000000003'::uuid, 'lit');
select pg_temp.lire('joueur du club',               'ffffffff-0000-0000-0000-000000000005'::uuid, 'lit');

-- Le tableau de bord du CM lit le calendrier par cette fonction : il doit continuer de compter.
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'ffffffff-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := cm_tableau_de_bord((select club_id from ctx));
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into verdicts values ('tableau de bord du CM : la semaine est toujours comptée', 'oui',
    case when (v->'semaine'->>'entrainements')::int > 0 then 'oui' else 'non' end);
end $$;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
