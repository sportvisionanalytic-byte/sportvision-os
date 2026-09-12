-- La signature du parent débloque la demande d'adhésion (v193, 12/09/2026).
--
-- `recompute_request_readiness` fait passer une demande de `en_attente_parent` à
-- `pret_a_valider`. Elle n'était appelée que par `submit_parental_authorization` et
-- `verify_parental_authorization` — deux fonctions que Connect n'utilise pas. La RPC réellement
-- branchée sur l'écran du parent est `signer_autorisation`, qui ne l'appelait pas.
--
-- Conséquence : le parent signait ses autorisations, l'écran disait merci, et la demande restait
-- bloquée en `en_attente_parent`. Personne n'était prévenu que la validation était devenue
-- possible, et côté club le bouton Valider échouait sur « Autorisation parentale manquante ».
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee77ee77-0000-0000-0000-000000000001','zz-parent-signe@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Signature (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Signature (test)', id, 'free' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U11 signature' from clu returning id, club_id),
       enfant as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
                  select club_id, 'Nino', 'ZZSignature', date '2016-06-06', 'sans_compte' from eq returning id, club_id),
       par as (insert into parent_profiles (user_id, prenom, nom)
               values ('ee77ee77-0000-0000-0000-000000000001','Parent','ZZ') returning id),
       lien as (insert into parent_player_relationships (parent_id, player_id, statut, confirmed_at)
                select (select id from par), (select id from enfant), 'confirme', now() returning player_id),
       dem as (insert into membership_requests (club_id, team_id, player_id, statut, source)
               select (select club_id from enfant), (select id from eq), (select id from enfant),
                      'en_attente_parent', 'spontanee' returning id)
  select (select id from enfant) enfant, (select id from dem) demande;
grant select on ctx to authenticated;

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

-- Le parent signe les trois autorisations qui conditionnent la validation.
select pg_temp.sous('ee77ee77-0000-0000-0000-000000000001');
select signer_autorisation((select enfant from ctx), 'creation_compte', true);
select signer_autorisation((select enfant from ctx), 'acces_clubplus', true);
select signer_autorisation((select enfant from ctx), 'traitement_donnees', true);
select pg_temp.stop();

select pg_temp.note('la demande devient validable', 'pret_a_valider',
  (select m.statut from membership_requests m, ctx where m.id = ctx.demande));

-- Et si le parent retire son accord, la demande redevient bloquée.
update parental_authorizations set statut = 'refusee'
 where player_id = (select enfant from ctx)
   and authorization_type_id = (select id from authorization_types where code = 'acces_clubplus');
select pg_temp.note('un accord retiré rebloque la demande', 'autorisation_manquante',
  (select m.statut from membership_requests m, ctx where m.id = ctx.demande));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
