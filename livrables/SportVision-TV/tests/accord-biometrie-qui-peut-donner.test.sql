-- Qui peut donner l'accord de reconnaissance (v324, 28/09/2026).
--
-- Fouka : « l'enfant peut tout faire sans son parent ». C'est déjà vrai à partir de 15 ans, et ce
-- seuil n'est pas un choix de conception : c'est celui du RGPD et de la loi Informatique et
-- Libertés. En dessous, l'accord vient du titulaire de l'autorité parentale.
--
-- CE QUE CE TEST A TROUVÉ AU PASSAGE. La fonction `donner_consentement_biometrie` connaissait le
-- titre `joueur_15_17` et savait le poser ; la policy `cb_donner`, elle, n'acceptait que le parent
-- ou le sportif MAJEUR. Les deux se contredisaient. Personne n'en souffrait — la fonction est
-- SECURITY DEFINER, elle passe au-dessus — et c'est ce qui rendait le défaut sournois : il
-- attendait la première écriture qui ne passerait pas par elle.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('fc110000-0000-0000-0000-000000000001','zz-16ans@example.invalid','',now(),'authenticated','authenticated'),
  ('fc110000-0000-0000-0000-000000000002','zz-12ans@example.invalid','',now(),'authenticated','authenticated'),
  ('fc110000-0000-0000-0000-000000000003','zz-parent12@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with clu as (insert into clubs (nom, plan) values ('ZZ Club Accord','performance') returning id),
       grand as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status, user_id)
                 select id, 'ZZ', 'Seize ans', (current_date - interval '16 years')::date, 'actif',
                        'fc110000-0000-0000-0000-000000000001' from clu returning id),
       petit as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status, user_id)
                 select id, 'ZZ', 'Douze ans', (current_date - interval '12 years')::date, 'actif',
                        'fc110000-0000-0000-0000-000000000002' from clu returning id)
  select (select id from grand) grand, (select id from petit) petit;
grant select on ctx to authenticated;

insert into parent_profiles (id, user_id, prenom, nom)
values ('fc110000-0000-0000-0000-000000000003','fc110000-0000-0000-0000-000000000003','ZZ','Parent douze')
on conflict (id) do nothing;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'fc110000-0000-0000-0000-000000000003'::uuid, petit, 'parent', 'confirme', now() from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant all on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(c text, a text, o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (c, a, o); $$;

-- Par la FONCTION, le chemin que l'application emprunte.
create or replace function pg_temp.accord(p_qui uuid, p_joueur uuid) returns text language plpgsql as $$
declare r uuid;   -- la fonction rend un uuid, pas un jsonb : une sonde mal typee accuse le produit
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_qui, 'role', 'authenticated')::text, true);
  r := donner_consentement_biometrie(p_joueur, 'zz-test-v324');
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce((select qualite from consentements_biometrie where player_id = p_joueur order by created_at desc limit 1), 'accorde sans titre');
exception when others then
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'refuse';
end $$;

-- Par la TABLE, le chemin qu'un script ou un futur ecran emprunterait.
create or replace function pg_temp.accord_direct(p_qui uuid, p_joueur uuid) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_qui, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into consentements_biometrie (player_id, donne_par, qualite, texte_version, statut)
  values (p_joueur, p_qui, 'joueur_15_17', 'zz-direct', 'accorde');
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'accepte';
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'refuse';
end $$;

select pg_temp.note('a 16 ans, le sportif donne son accord SEUL', 'joueur_15_17',
  pg_temp.accord('fc110000-0000-0000-0000-000000000001', (select grand from ctx)));

select pg_temp.note('a 12 ans, le sportif seul est refuse', 'refuse',
  pg_temp.accord('fc110000-0000-0000-0000-000000000002', (select petit from ctx)));

select pg_temp.note('a 12 ans, son parent confirme le donne', 'parent',
  pg_temp.accord('fc110000-0000-0000-0000-000000000003', (select petit from ctx)));

-- v324 : la policy disait non la ou la fonction disait oui.
select pg_temp.note('et la policy dit la meme chose que la fonction (v324)', 'accepte',
  pg_temp.accord_direct('fc110000-0000-0000-0000-000000000001', (select grand from ctx)));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
