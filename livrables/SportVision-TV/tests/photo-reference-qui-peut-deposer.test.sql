-- Qui peut déposer la photo de référence d'un visage (v323, 28/09/2026).
--
-- Décision de Fouka : « il dépose lui-même sa photo de référence, le parent n'est pas obligé de le
-- faire à sa place ». La règle exigeait d'être parent confirmé OU le joueur ET majeur : un U16 se
-- voyait donc refuser sa propre photo.
--
-- CE QUI PROTÈGE UNE DONNÉE BIOMÉTRIQUE DE MINEUR, C'EST L'ACCORD, pas la main qui téléverse. Ce
-- test tient donc les deux ensemble : le mineur dépose, mais seulement si l'accord existe. Sans
-- accord, personne ne dépose — ni l'enfant, ni le parent. Les conditions pour DONNER cet accord ne
-- sont pas touchées, et ce test ne les mesure pas : c'est une autre règle, et elle est légale.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('fb110000-0000-0000-0000-000000000001','zz-ado@example.invalid','',now(),'authenticated','authenticated'),
  ('fb110000-0000-0000-0000-000000000002','zz-parent@example.invalid','',now(),'authenticated','authenticated'),
  ('fb110000-0000-0000-0000-000000000003','zz-inconnu@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with clu as (insert into clubs (nom, plan) values ('ZZ Club Photo', 'performance') returning id),
       -- Un mineur : ne il y a quinze ans.
       ado as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status, user_id)
               select id, 'ZZ', 'Ado', (current_date - interval '15 years')::date, 'actif',
                      'fb110000-0000-0000-0000-000000000001' from clu returning id),
       -- Un second mineur, SANS accord : c'est lui qui prouve que l'accord reste la condition.
       ado2 as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status, user_id)
                select id, 'ZZ', 'Ado sans accord', (current_date - interval '15 years')::date, 'actif',
                       'fb110000-0000-0000-0000-000000000003' from clu returning id)
  select (select id from ado) ado, (select id from ado2) ado2;
grant select on ctx to authenticated;

insert into parent_profiles (id, user_id, prenom, nom)
values ('fb110000-0000-0000-0000-000000000002','fb110000-0000-0000-0000-000000000002','ZZ','Parent')
on conflict (id) do nothing;
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
select 'fb110000-0000-0000-0000-000000000002'::uuid, ado, 'parent', 'confirme', now() from ctx;

-- L'accord, donné pour le premier seulement.
insert into consentements_biometrie (player_id, donne_par, qualite, texte_version, statut)
select ado, 'fb110000-0000-0000-0000-000000000002', 'parent', 'zz-test', 'accorde' from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant all on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(c text, a text, o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (c, a, o); $$;

-- Deposer revient a ecrire une ligne dans storage.objects : c'est la policy qui tranche.
create or replace function pg_temp.deposer(p_qui uuid, p_joueur uuid) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_qui, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into storage.objects (bucket_id, name, owner)
  values ('sportvision-media-prive', 'visages/' || p_joueur::text || '/ref-' || gen_random_uuid()::text || '.jpg', p_qui);
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'accepte';
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'refuse';
end $$;

select pg_temp.note('l''ado de 15 ans depose LUI-MEME sa photo (v323)', 'accepte',
  pg_temp.deposer('fb110000-0000-0000-0000-000000000001', (select ado from ctx)));

select pg_temp.note('son parent confirme le peut toujours', 'accepte',
  pg_temp.deposer('fb110000-0000-0000-0000-000000000002', (select ado from ctx)));

select pg_temp.note('sans accord, l''ado ne depose rien', 'refuse',
  pg_temp.deposer('fb110000-0000-0000-0000-000000000003', (select ado2 from ctx)));

select pg_temp.note('un inconnu ne depose pas pour un autre', 'refuse',
  pg_temp.deposer('fb110000-0000-0000-0000-000000000003', (select ado from ctx)));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
