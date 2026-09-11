-- Le statut d'un match voyage dans les deux sens (v165, 12/09/2026).
--
-- Ce que ce test tient pour vrai : ce que la saisie du Match Center écrit (status) arrive au
-- calendrier et aux familles (sport_status), et réciproquement.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Statut (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Statut (test)', id, 'performance' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U15' from clu returning id, club_id),
       m as (insert into club_matches (club_id, team, team_id, opponent, match_date, kickoff_time, status)
             select club_id, 'ZZ U15', id, 'ZZ Adversaire', current_date + 7, '15:00', 'a_venir' from eq returning id)
  select (select id from m) match_id;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.etat() returns text language sql as $$
  select m.status || ' / ' || coalesce(m.sport_status,'(vide)') from club_matches m, ctx where m.id = ctx.match_id; $$;

select pg_temp.note('un match neuf est à venir et programmé', 'a_venir / scheduled', pg_temp.etat());

update club_matches set status = 'reportee' where id = (select match_id from ctx);
select pg_temp.note('reporté dans le Match Center : le calendrier le sait', 'reportee / postponed', pg_temp.etat());

update club_matches set status = 'a_venir' where id = (select match_id from ctx);
select pg_temp.note('reprogrammé : le calendrier le sait aussi', 'a_venir / scheduled', pg_temp.etat());

update club_matches set status = 'annulee' where id = (select match_id from ctx);
select pg_temp.note('annulé dans le Match Center : le calendrier le sait', 'annulee / cancelled', pg_temp.etat());

update club_matches set sport_status = 'scheduled' where id = (select match_id from ctx);
select pg_temp.note('remis au calendrier : le suivi le sait (sens d''origine)', 'a_venir / scheduled', pg_temp.etat());

update club_matches set status = 'recu', score = '2-1' where id = (select match_id from ctx);
select pg_temp.note('résultat saisi : le match est joué', 'recu / completed', pg_temp.etat());

update club_matches set sport_status = 'cancelled' where id = (select match_id from ctx);
select pg_temp.note('annulé côté sportif : le suivi le sait (sens d''origine)', 'annulee / cancelled', pg_temp.etat());

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
