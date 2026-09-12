-- Les accès d'un agent s'arrêtent avec son abonnement (v198, 12/09/2026).
--
-- Résilier passait l'abonnement en `canceled` et rien d'autre : les relations d'accès acceptées
-- n'étaient jamais touchées, et aucune lecture ne filtrait par palier. Un agent souscrivait Pro,
-- faisait accepter vingt accès dans le mois, résiliait, et continuait de lire les contenus, les
-- commandes, les factures et les messages de vingt sportifs, gratuitement et indéfiniment.
--
-- Ce test tient pour vrai : au-delà du palier en cours, seuls les accès les PLUS ANCIENS restent
-- servis — on ne perd jamais un accès au hasard — et rien n'est supprimé.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('eeccee00-0000-0000-0000-000000000000','zz-agent@example.invalid','',now(),'authenticated','authenticated'),
  ('eeccee00-0000-0000-0000-000000000001','zz-sportif1@example.invalid','',now(),'authenticated','authenticated'),
  ('eeccee00-0000-0000-0000-000000000002','zz-sportif2@example.invalid','',now(),'authenticated','authenticated'),
  ('eeccee00-0000-0000-0000-000000000003','zz-sportif3@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into connect_profile_settings (user_id, account_type, profil_particulier) values
  ('eeccee00-0000-0000-0000-000000000000','particulier','agent')
on conflict (user_id) do update set profil_particulier = 'agent';

-- Trois accès acceptés, du plus ancien au plus récent.
insert into connect_access_relationships (owner_user_id, grantee_user_id, relation_type, status, responded_at, right_voir)
values
  ('eeccee00-0000-0000-0000-000000000001','eeccee00-0000-0000-0000-000000000000','agent','acceptee', now() - interval '30 days', true),
  ('eeccee00-0000-0000-0000-000000000002','eeccee00-0000-0000-0000-000000000000','agent','acceptee', now() - interval '20 days', true),
  ('eeccee00-0000-0000-0000-000000000003','eeccee00-0000-0000-0000-000000000000','agent','acceptee', now() - interval '10 days', true);

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

-- On se met dans la peau de l'agent : le palier se lit avec son identite, jamais sans.
create or replace function pg_temp.sous(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.stop() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;
select pg_temp.sous('eeccee00-0000-0000-0000-000000000000');

-- Sans abonnement, le palier effectif est « gratuit » : 2 sportifs.
select pg_temp.note('sans abonnement, deux acces seulement sont servis', '2',
  (select count(*)::text from connect_acces_dans_le_palier('eeccee00-0000-0000-0000-000000000000')));

select pg_temp.note('et ce sont les deux plus anciens', 'oui',
  (select case when bool_and(car.owner_user_id in ('eeccee00-0000-0000-0000-000000000001','eeccee00-0000-0000-0000-000000000002'))
               then 'oui' else 'NON' end
     from connect_acces_dans_le_palier('eeccee00-0000-0000-0000-000000000000') a
     join connect_access_relationships car on car.id = a.relation_id));

select pg_temp.stop();

select pg_temp.note('rien n''a ete supprime', '3',
  (select count(*)::text from connect_access_relationships
    where grantee_user_id = 'eeccee00-0000-0000-0000-000000000000' and status = 'acceptee'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
