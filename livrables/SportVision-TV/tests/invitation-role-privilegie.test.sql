-- Une invitation « président » ne se prépare que par qui peut nommer un président.
--
-- v114 réserve à l'Admin/Owner du club (et au staff SportVision) le droit d'attribuer un rôle
-- privilégié. Mais un rôle s'attribue aussi par INVITATION : `club_invitations` accepte le rôle
-- `president`, et l'acceptation passe la protection de `club_members` dès qu'une invitation
-- correspondante existe. Trouvé le 10/09/2026 en préparant l'invitation du président de SF
-- Villemomble : un CM, ou un président, pouvait préparer une invitation président — ou
-- détourner vers une autre adresse celle que l'Admin/Owner venait de préparer.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid as club_id;
grant select on ctx to authenticated;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('cccccccc-0000-0000-0000-000000000001','zz-inv-owner@example.invalid','',now(),'authenticated','authenticated'),
  ('cccccccc-0000-0000-0000-000000000002','zz-inv-president@example.invalid','',now(),'authenticated','authenticated'),
  ('cccccccc-0000-0000-0000-000000000003','zz-inv-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('cccccccc-0000-0000-0000-000000000004','zz-inv-staff@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into club_members (user_id, club_id, role, status, teams)
select 'cccccccc-0000-0000-0000-000000000001'::uuid, club_id, 'admin', 'actif', '[]'::jsonb from ctx
union all
select 'cccccccc-0000-0000-0000-000000000002'::uuid, club_id, 'president', 'actif', '[]'::jsonb from ctx;

insert into profiles (id, prenom, nom, role) values
  ('cccccccc-0000-0000-0000-000000000003','QA','CM','cm'),
  ('cccccccc-0000-0000-0000-000000000004','QA','Staff','admin')
on conflict (id) do update set role = excluded.role;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'cccccccc-0000-0000-0000-000000000003', 'secondaire', current_date, true from ctx;

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

-- Préparer une invitation président, sous l'identité de `qui`.
create or replace function pg_temp.preparer(p_qui text, p_uid uuid, p_attendu text) returns void language plpgsql as $$
declare v_ok text;
begin
  perform pg_temp.en(p_uid);
  begin
    perform preparer_invitation_club((select club_id from ctx), 'zz-p-' || p_qui || '@example.invalid', 'president');
    v_ok := 'autorisé';
  exception when others then v_ok := 'refusé';
  end;
  perform pg_temp.hors();
  insert into verdicts values ('préparer une invitation président — ' || p_qui, p_attendu, v_ok);
end $$;

select pg_temp.preparer('cm',        'cccccccc-0000-0000-0000-000000000003', 'refusé');
select pg_temp.preparer('president', 'cccccccc-0000-0000-0000-000000000002', 'refusé');
select pg_temp.preparer('owner',     'cccccccc-0000-0000-0000-000000000001', 'autorisé');
select pg_temp.preparer('staff',     'cccccccc-0000-0000-0000-000000000004', 'autorisé');

-- Le CM, par INSERT direct (policy ci_operateur_all), sans passer par la fonction.
do $$
declare v_ok text;
begin
  perform pg_temp.en('cccccccc-0000-0000-0000-000000000003');
  begin
    insert into club_invitations (club_id, email, role, created_by)
    values ((select club_id from ctx), 'zz-p-cm-direct@example.invalid', 'president', 'cccccccc-0000-0000-0000-000000000003');
    v_ok := 'autorisé';
  exception when others then v_ok := 'refusé';
  end;
  perform pg_temp.hors();
  insert into verdicts values ('insérer directement une invitation président — cm', 'refusé', v_ok);
end $$;

-- Le CM détourne l'invitation préparée par l'Admin/Owner vers sa propre adresse. Mesuré sur la
-- ligne : une policy peut filtrer sans lever d'erreur.
do $$
begin
  perform pg_temp.en('cccccccc-0000-0000-0000-000000000003');
  begin
    update club_invitations set email = 'zz-inv-cm@example.invalid'
     where email = 'zz-p-owner@example.invalid';
  exception when others then null;
  end;
  perform pg_temp.hors();
  insert into verdicts values ('détourner l''invitation président de l''Owner — cm', 'refusé',
    case when exists (select 1 from club_invitations where email = 'zz-p-owner@example.invalid') then 'refusé' else 'autorisé' end);
end $$;

-- Le CM change en « président » une invitation de coach déjà préparée.
insert into club_invitations (club_id, email, role, created_by)
select club_id, 'zz-coach-inv@example.invalid', 'coach', 'cccccccc-0000-0000-0000-000000000001' from ctx;
do $$
begin
  perform pg_temp.en('cccccccc-0000-0000-0000-000000000003');
  begin
    update club_invitations set role = 'president' where email = 'zz-coach-inv@example.invalid';
  exception when others then null;
  end;
  perform pg_temp.hors();
  insert into verdicts values ('changer une invitation coach en président — cm', 'refusé',
    (select case when role = 'president' then 'autorisé' else 'refusé' end from club_invitations where email = 'zz-coach-inv@example.invalid'));
end $$;

-- Ce qui doit rester possible sur l'invitation de l'Owner : l'envoyer, puis la révoquer.
do $$
declare v_ok text;
begin
  perform pg_temp.en('cccccccc-0000-0000-0000-000000000003');
  begin
    update club_invitations set statut = 'envoyee', sent_at = now() where email = 'zz-p-owner@example.invalid';
    v_ok := 'autorisé';
  exception when others then v_ok := 'refusé';
  end;
  perform pg_temp.hors();
  insert into verdicts values ('marquer envoyée l''invitation de l''Owner — cm', 'autorisé',
    case when v_ok = 'autorisé' and exists (select 1 from club_invitations where email = 'zz-p-owner@example.invalid' and statut = 'envoyee') then 'autorisé' else 'refusé' end);
end $$;

-- ── Le parcours qui doit marcher : l'invité lui-même accepte, et devient président ──
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('cccccccc-0000-0000-0000-000000000005','zz-p-owner@example.invalid','',now(),'authenticated','authenticated'),
  ('cccccccc-0000-0000-0000-000000000006','zz-intrus@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

-- Le jeton se lit hors identité : l'invité le reçoit par e-mail, il n'a pas le droit de lire
-- `club_invitations`. Le lire sous son identité donnait un jeton vide — et un refus pour la
-- mauvaise raison (vu rouge ainsi, le 10/09/2026).
create temp table lien on commit drop as
  select token from club_invitations where email = 'zz-p-owner@example.invalid';
grant select on lien to authenticated;
do $$ begin
  if (select token from lien) is null then
    raise exception 'DÉCOR INVALIDE : l''invitation de l''Owner n''existe pas, les deux contrôles suivants ne mesureraient rien.';
  end if;
end $$;

-- Un intrus qui a obtenu le lien ne devient pas président à la place de l'invité.
do $$
declare v_ok text;
begin
  perform pg_temp.en('cccccccc-0000-0000-0000-000000000006');
  begin
    perform accepter_invitation_club((select token from lien));
  exception when others then null;
  end;
  perform pg_temp.hors();
  insert into verdicts values ('accepter l''invitation président d''un autre — intrus', 'refusé',
    case when exists (select 1 from club_members where user_id = 'cccccccc-0000-0000-0000-000000000006' and role = 'president')
         then 'autorisé' else 'refusé' end);
end $$;

do $$
begin
  perform pg_temp.en('cccccccc-0000-0000-0000-000000000005');
  begin
    perform accepter_invitation_club((select token from lien));
  exception when others then null;
  end;
  perform pg_temp.hors();
  insert into verdicts values ('accepter sa propre invitation président — invité', 'autorisé',
    case when exists (select 1 from club_members where user_id = 'cccccccc-0000-0000-0000-000000000005'
                                                  and role = 'president' and status = 'actif')
         then 'autorisé' else 'refusé' end);
end $$;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
