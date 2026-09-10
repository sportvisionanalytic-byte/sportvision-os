-- Des outils internes qui écrivaient, appelables sans compte.
--
-- Trouvé le 10/09/2026 au balayage des fonctions à droits propriétaire (après les deux P0 du
-- jour, v120 et v122) :
--   • `check_and_record_rate_limit(identifiant, …)` : n'importe qui pouvait remplir le compteur
--     d'un identifiant — une adresse e-mail par exemple — et bloquer ainsi la personne sur un
--     parcours limité (réinitialisation de mot de passe, activation, paiement invité). Seules les
--     fonctions serveur l'appellent, avec la clé de service.
--   • `get_or_create_saison(label)` : un visiteur créait des saisons à volonté. L'OS l'appelle
--     avec le jeton d'un membre du staff ; le déclencheur des clubs, avec ses propres droits.
--   • `club_president_connu(club)` : outil interne du cockpit (v117), resté appelable.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated, anon;

create or replace function pg_temp.essai(p_qui text, p_role text, p_sql text, p_attendu text) returns void language plpgsql as $$
declare v_ok text;
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  elsif p_role = 'authenticated' then
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
  begin
    execute p_sql;
    v_ok := 'autorisé';
  exception when others then v_ok := 'refusé';
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into verdicts values (p_qui, p_attendu, v_ok);
end $$;

select pg_temp.essai('limiteur de débit — visiteur sans compte', 'anon',
  'select check_and_record_rate_limit(''victime@example.invalid'', 5, 3600)', 'refusé');
select pg_temp.essai('limiteur de débit — compte quelconque', 'authenticated',
  'select check_and_record_rate_limit(''victime@example.invalid'', 5, 3600)', 'refusé');
select pg_temp.essai('créer une saison — visiteur sans compte', 'anon',
  'select get_or_create_saison(''2099-2100'')', 'refusé');
select pg_temp.essai('président connu — compte quelconque', 'authenticated',
  'select club_president_connu(''f0d3bafa-3004-4831-bd85-249aa9af5c54'')', 'refusé');
-- Les usages légitimes restent possibles.
select pg_temp.essai('limiteur de débit — fonction serveur (clé de service)', 'postgres',
  'select check_and_record_rate_limit(''zz-test@example.invalid'', 5, 3600)', 'autorisé');
select pg_temp.essai('créer une saison — compte connecté (l''OS)', 'authenticated',
  'select get_or_create_saison(''2099-2100'')', 'autorisé');

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
