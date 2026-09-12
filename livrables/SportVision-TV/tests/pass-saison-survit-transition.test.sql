-- Ce qui est payé reste accessible, même après la transition de saison (v200, 12/09/2026).
--
-- `can_access_media` testait d'abord « êtes-vous une famille du club AUJOURD'HUI », et seulement
-- ensuite le droit payé. Or `is_family_of_team` et `is_family_of_club` exigent un
-- `team_memberships` de statut `active`, sans notion de saison, et la transition de saison
-- archive ces lignes (`archivee`, `en_attente_renouvellement`, `quittee_club`).
--
-- Conséquence : en juillet, le président fait sa transition, coche « a quitté le club » pour
-- trois joueurs, et le soir même leurs parents n'ont plus une seule photo — y compris celles du
-- Pass Saison à 30 EUR qu'ils viennent de payer, et y compris les albums de la saison écoulée.
-- Aucun message, rien à comprendre.
--
-- Ce test tient pour vrai qu'un droit payé ouvre l'album à celui qui l'a payé, que sa famille soit
-- encore active ou non. Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('eeff0000-0000-0000-0000-000000000001','zz-parent-pass@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Pass (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Pass (test)', id, 'free' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U15 pass' from clu returning id, club_id),
       sais as (select id from saisons where label = '2026-2027' limit 1),
       enfant as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
                  select club_id, 'Tom', 'ZZPass', date '2011-01-01', 'sans_compte' from eq returning id, club_id),
       -- Le joueur a QUITTÉ le club : sa ligne d'effectif n'est plus active.
       tm as (insert into team_memberships (team_id, club_id, player_id, saison, statut)
              select (select id from eq), (select club_id from eq), (select id from enfant), '2026-2027', 'quittee_club'
              returning team_id),
       alb as (insert into media_albums (club_id, team_id, saison_id, title, event_date, status, published_at)
               select (select club_id from eq), (select id from eq), (select id from sais),
                      'ZZ Album paye', current_date, 'published', now() returning id),
       ent as (insert into media_entitlements (club_id, saison_id, scope_type, scope_id, status,
                                               purchased_by_user_id, beneficiary_person_id)
               select (select club_id from eq), (select id from sais), 'team', (select id from eq), 'active',
                      'eeff0000-0000-0000-0000-000000000001', (select id from enfant) returning id)
  select (select id from alb) album;
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

select pg_temp.sous('eeff0000-0000-0000-0000-000000000001');
select pg_temp.note('ce qui est paye reste ouvert apres le depart du club', 'oui',
  case when can_access_media((select album from ctx)) then 'oui' else 'NON' end);

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
