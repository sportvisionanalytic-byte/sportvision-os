-- Un match synchronisé retrouve son équipe (v204, 12/09/2026).
--
-- 25 rapprochements CONFIRMÉS à la main dans Club+ (« Seniors 3 » chez la fédération = telle équipe
-- du club) ne servaient qu'à l'assistant d'import : la synchro hebdomadaire s'en remettait au
-- trigger `resolve_team_id_from_name`, qui comparait le nom en égalité stricte. Une majuscule de
-- différence, et le match restait sans équipe : invisible du calendrier de l'équipe, et sans
-- galerie rattachable. Le commentaire du code promettait pourtant l'inverse.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Federation (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Federation (test)', id, 'performance' from cli returning id),
       eqA as (insert into club_teams (club_id, name) select id, 'ZZ Séniors 3' from clu returning id, club_id),
       eqB as (insert into club_teams (club_id, name) select id, 'ZZ U16 Elite' from clu returning id, club_id),
       map as (insert into club_team_source_mappings (club_id, team_id, saison_id, provider, external_team_id, external_team_name, status, confirmed_at)
               select (select club_id from eqA), (select id from eqA),
                      (select id from saisons where active limit 1), 'SPORTCORICO', 'ZZ-EXT-1', 'SEN 3 FED', 'confirmed', now()
               returning id)
  select (select club_id from eqA) club, (select id from eqA) eq_a, (select id from eqB) eq_b;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

-- 1. Le libellé de la fédération, rapproché à la main par le club.
insert into club_matches (club_id, team, opponent, match_date, provider, competition)
select club, 'SEN 3 FED', 'ZZ Adversaire', current_date, 'SPORTCORICO', 'ZZ Championnat' from ctx;
select pg_temp.note('le rapprochement confirme par le club est utilise', 'oui',
  (select case when m.team_id = ctx.eq_a then 'oui' else 'NON' end
     from club_matches m, ctx where m.team = 'SEN 3 FED'));

-- 2. Un libellé qui ne differe que par la casse et les accents.
insert into club_matches (club_id, team, opponent, match_date, provider, competition)
select club, 'zz u16 elite', 'ZZ Adversaire 2', current_date, 'SPORTCORICO', 'ZZ Championnat' from ctx;
select pg_temp.note('une difference de casse ou d''accent ne perd plus le match', 'oui',
  (select case when m.team_id = ctx.eq_b then 'oui' else 'NON' end
     from club_matches m, ctx where m.team = 'zz u16 elite'));

-- 3. Un libellé inconnu ne se rattache a personne, plutot que de deviner.
insert into club_matches (club_id, team, opponent, match_date, provider, competition)
select club, 'ZZ Equipe inconnue', 'ZZ Adversaire 3', current_date, 'SPORTCORICO', 'ZZ Championnat' from ctx;
select pg_temp.note('un libelle inconnu ne se rattache a personne', 'oui',
  (select case when m.team_id is null then 'oui' else 'NON' end
     from club_matches m where m.team = 'ZZ Equipe inconnue'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
