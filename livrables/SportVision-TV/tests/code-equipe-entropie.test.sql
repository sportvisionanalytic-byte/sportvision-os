-- Un code d'équipe doit être un vrai secret (v189, 12/09/2026).
--
-- POURQUOI. Le code valait 'SV-' || catégorie || '-' || 4 chiffres tirés par random() : environ
-- 13 bits, soit 10 000 essais par préfixe, avec des préfixes devinables (U6…U19, SENIORS, CLUB).
-- L'oracle `preview_invite_code` est ouvert à `anon` et distingue introuvable / inactif / expiré /
-- épuisé d'un code valide : toute la plateforme était énumérable depuis un navigateur, sans compte.
--
-- Ce n'était qu'une faiblesse tant qu'un humain validait l'adhésion. Depuis la v186 (11/09),
-- rejoindre PAR CODE se valide tout seul : deviner un code, c'est entrer dans le club.
--
-- Ce test tient pour vrai : format à forte entropie, alphabet sans caractères ambigus, unicité sur
-- un volume, et l'aperçu qui continue de fonctionner pour qui détient le code.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

create temp table tirage on commit drop as
  select generate_team_invite_code(null) as code from generate_series(1, 200);

select pg_temp.note('le code ne porte plus de partie devinable',
  'SV-XXXXX-XXXXX',
  (select case when bool_and(code ~ '^SV-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$')
               then 'SV-XXXXX-XXXXX' else 'format ancien : ' || min(code) end from tirage));

select pg_temp.note('200 tirages, 200 codes différents', '200',
  (select count(distinct code)::text from tirage));

-- Les caractères qu'on confond en dictant un code : I, L, O, 0, 1.
select pg_temp.note('aucun caractère ambigu (I L O 0 1)', '0',
  (select count(*)::text from tirage where code ~ '[ILO01]'));

-- Un code réel continue de s'ouvrir normalement.
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Code (test)','partenaire') returning id),
       clu as (insert into clubs (nom, portail_client_id, plan) select 'ZZ Club Code (test)', id, 'free' from cli returning id),
       eq as (insert into club_teams (club_id, name) select id, 'ZZ U13 code' from clu returning id, club_id),
       code as (insert into team_invite_codes (club_id, team_id, code, actif)
                select club_id, id, generate_team_invite_code(id), true from eq returning code)
  select (select code from code) code;

select pg_temp.note('l''aperçu rend toujours le club à qui détient le code', 'ZZ Club Code (test)',
  coalesce((select club_nom from preview_invite_code((select code from ctx))), 'RIEN'));

select pg_temp.note('un code inconnu reste refusé', 'introuvable',
  coalesce((select raison from preview_invite_code('SV-ZZZZZ-ZZZZZ')), 'RIEN'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
