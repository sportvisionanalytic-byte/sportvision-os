-- Une invitation de parent ne vaut que pour un enfant DU club qui invite (v188, 12/09/2026).
--
-- La faille : `clubplus-family-invite` vérifiait le club de l'appelant, jamais le club de
-- l'enfant. `accept_parent_invitation` ne vérifiait que l'adresse e-mail — choisie par celui qui
-- invite. Un administrateur de club (un Club+ Gratuit s'ouvre en deux minutes) pouvait donc
-- s'inviter lui-même comme parent de l'enfant d'un AUTRE club et devenir parent « confirmé » :
-- fiche du mineur, calendrier, photos, achats, et dépôt de sa photo de visage.
--
-- Ce test tient pour vrai qu'une invitation dont le joueur n'appartient pas au club de
-- l'invitation est refusée à l'acceptation, et qu'une invitation légitime marche toujours.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ee55ee55-0000-0000-0000-000000000001','zz-pirate@example.invalid','',now(),'authenticated','authenticated'),
  ('ee55ee55-0000-0000-0000-000000000002','zz-vrai-parent@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with cliA as (insert into clients (nom, statut_relation) values ('ZZ Club A (test)','partenaire') returning id),
       cluA as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club A (test)', id, 'free' from cliA returning id),
       cliB as (insert into clients (nom, statut_relation) values ('ZZ Club B pirate (test)','partenaire') returning id),
       cluB as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club B pirate (test)', id, 'free' from cliB returning id),
       enfant as (insert into player_profiles (club_id, prenom, nom, date_naissance, account_status)
                  select id, 'Enzo', 'ZZEnfantA', date '2015-03-03', 'sans_compte' from cluA returning id, club_id),
       -- L'invitation forgée : club B (celui du pirate), enfant du club A.
       invPirate as (insert into parent_invitations (club_id, player_id, email, prenom, nom, statut)
                     select (select id from cluB), (select id from enfant), 'zz-pirate@example.invalid', 'Pirate', 'ZZ', 'envoyee'
                     returning id),
       -- L'invitation legitime : club A, enfant du club A.
       invVraie as (insert into parent_invitations (club_id, player_id, email, prenom, nom, statut)
                    select (select id from cluA), (select id from enfant), 'zz-vrai-parent@example.invalid', 'Vrai', 'Parent', 'envoyee'
                    returning id)
  select (select id from cluA) club_a, (select id from cluB) club_b,
         (select id from enfant) enfant, (select id from invPirate) inv_pirate,
         (select id from invVraie) inv_vraie;
grant select on ctx to authenticated;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.sous(p_uid uuid, p_mail text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'email', p_mail, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.stop() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;
create or replace function pg_temp.essai(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'passe'; exception when others then return 'refus'; end $$;

-- 1. L'invitation forgee : l'enfant n'est pas du club de l'invitation.
select pg_temp.sous('ee55ee55-0000-0000-0000-000000000001','zz-pirate@example.invalid');
select pg_temp.note('un enfant d''un autre club ne peut pas etre accepte', 'refus',
  pg_temp.essai('select accept_parent_invitation('''||(select inv_pirate from ctx)||''')'));
select pg_temp.stop();

select pg_temp.note('et aucun lien parental n''a ete pose', '0',
  (select count(*)::text from parent_player_relationships ppr
     join parent_profiles pp on pp.id = ppr.parent_id, ctx
    where pp.user_id = 'ee55ee55-0000-0000-0000-000000000001' and ppr.player_id = ctx.enfant));

-- 2. L'invitation legitime marche toujours.
select pg_temp.sous('ee55ee55-0000-0000-0000-000000000002','zz-vrai-parent@example.invalid');
select pg_temp.note('le parent invite par le bon club est accepte', 'passe',
  pg_temp.essai('select accept_parent_invitation('''||(select inv_vraie from ctx)||''')'));
select pg_temp.stop();

select pg_temp.note('et son lien est confirme', 'confirme',
  (select ppr.statut from parent_player_relationships ppr
     join parent_profiles pp on pp.id = ppr.parent_id, ctx
    where pp.user_id = 'ee55ee55-0000-0000-0000-000000000002' and ppr.player_id = ctx.enfant));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
