-- Le plafond de sportifs suivis ne se contourne pas en sautant une question (v197, 12/09/2026).
--
-- `connect_particulier_limit` rendait 999 dès que `profil_particulier` était vide, avec ce
-- commentaire : « profil jamais choisi (compte pré-v67) : pas de plafond rétroactif ». Le
-- raisonnement était juste pour les comptes existants au moment de la v67. Il s'est appliqué à
-- TOUS les comptes créés depuis, parce que le tunnel d'inscription ne persiste rien quand on
-- répond « Particulier » : la colonne reste vide.
--
-- Un agent qui clique « Particulier » plutôt que « Agent » — le libellé ne dit nulle part que
-- c'est un choix tarifaire — suit donc 30 sportifs sans payer un centime.
--
-- Ce test tient pour vrai : un compte récent sans profil est plafonné comme un parent, un compte
-- antérieur à la v67 garde son absence de plafond, et l'agent garde son palier.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('eebbeebb-0000-0000-0000-000000000001','zz-sans-profil@example.invalid','',now(),'authenticated','authenticated'),
  ('eebbeebb-0000-0000-0000-000000000002','zz-ancien@example.invalid','',now(),'authenticated','authenticated'),
  ('eebbeebb-0000-0000-0000-000000000003','zz-parent-plafond@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into connect_profile_settings (user_id, account_type, profil_particulier, created_at) values
  ('eebbeebb-0000-0000-0000-000000000001','particulier', null, now()),
  ('eebbeebb-0000-0000-0000-000000000002','particulier', null, timestamptz '2026-07-01 10:00:00+00'),
  ('eebbeebb-0000-0000-0000-000000000003','particulier', 'parent', now())
on conflict (user_id) do update set profil_particulier = excluded.profil_particulier, created_at = excluded.created_at;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.sous(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.stop() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;

select pg_temp.sous('eebbeebb-0000-0000-0000-000000000001');
select pg_temp.note('un compte recent sans profil est plafonne comme un parent', '3',
  connect_particulier_limit('eebbeebb-0000-0000-0000-000000000001')::text);
select pg_temp.stop();

select pg_temp.sous('eebbeebb-0000-0000-0000-000000000002');
select pg_temp.note('un compte anterieur a la v67 garde son absence de plafond', '999',
  connect_particulier_limit('eebbeebb-0000-0000-0000-000000000002')::text);
select pg_temp.stop();

select pg_temp.sous('eebbeebb-0000-0000-0000-000000000003');
select pg_temp.note('un parent reste a 3', '3',
  connect_particulier_limit('eebbeebb-0000-0000-0000-000000000003')::text);
select pg_temp.stop();

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
