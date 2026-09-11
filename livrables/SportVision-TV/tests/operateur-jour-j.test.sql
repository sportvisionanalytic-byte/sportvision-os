-- La journée de l'opérateur, du départ au dépôt des fichiers (v151, 11/09/2026).
--
-- Trouvé en répétant la première mission réelle (Villemomble, 12/09) : une mission affectée
-- reste en « équipe affectée » tant que personne ne la passe en « prête ». L'écran propose à
-- l'opérateur « ✓ Kit prêt, je peux partir », mais la base refusait ce passage à un collaborateur :
-- le matin du match, l'opérateur restait bloqué.
--
-- Ce que ce test tient pour vrai, sous l'identité de l'opérateur affecté, par les mêmes écritures
-- que l'écran (statut de la mission + horodatage dans mission_suivi_operateur) :
--   kit prêt → en route → arrivé → production démarrée → terminée → fichiers sauvegardés → copie
--   vérifiée ; chaque étape horodatée ; un photographe non affecté ne peut rien faire avancer.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f7f7f7f7-0000-0000-0000-000000000001','zz-jj-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('f7f7f7f7-0000-0000-0000-000000000002','zz-jj-intrus@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values
  ('f7f7f7f7-0000-0000-0000-000000000001','QA','Opérateur','photo',true),
  ('f7f7f7f7-0000-0000-0000-000000000002','QA','Intrus','photo',true)
on conflict (id) do update set role = excluded.role;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation) values ('ZZ Club Jour J (test)', 'partenaire') returning id),
       pre as (insert into prestations (client_id, date_prestation, heure_debut, lieu, type_prestation, statut, source)
               select id, current_date, '09:30', 'Stade ZZ', 'match', 'équipe_affectée', 'interne' from cli returning id)
  select (select id from pre) mission;
grant select on ctx to authenticated;
insert into prestations_equipe (prestation_id, collaborateur_id, statut, remuneration)
select mission, 'f7f7f7f7-0000-0000-0000-000000000001', 'acceptée', 55 from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
-- Une étape, comme l'écran : le statut de la mission, puis l'horodatage personnel.
create or replace function pg_temp.etape(p_uid uuid, p_statut text, p_suivi text) returns text language plpgsql as $$
declare v text := 'autorisé'; n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute format('update prestations set statut = %L where id = %L', p_statut, (select mission from ctx));
    get diagnostics n = row_count;
    if n = 0 then v := 'aucune ligne changée'; end if;
    if n > 0 and p_suivi is not null then
      execute format('insert into mission_suivi_operateur (prestation_id, collaborateur_id, %I) values (%L, %L, now())
                      on conflict (prestation_id, collaborateur_id) do update set %I = now()', p_suivi, (select mission from ctx), p_uid, p_suivi);
    end if;
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;

select pg_temp.note('un photographe non affecté ne fait rien avancer', 'aucune ligne changée',
  left(pg_temp.etape('f7f7f7f7-0000-0000-0000-000000000002', 'prête', null), 20));
select pg_temp.note('« ✓ Kit prêt, je peux partir »', 'autorisé', pg_temp.etape('f7f7f7f7-0000-0000-0000-000000000001', 'prête', 'kit_prepare_at'));
select pg_temp.note('« Je suis en route »', 'autorisé', pg_temp.etape('f7f7f7f7-0000-0000-0000-000000000001', 'équipe_en_route', 'parti_at'));
select pg_temp.note('« Je suis arrivé »', 'autorisé', pg_temp.etape('f7f7f7f7-0000-0000-0000-000000000001', 'arrivée_sur_place', 'arrive_at'));
select pg_temp.note('« Démarrer la production »', 'autorisé', pg_temp.etape('f7f7f7f7-0000-0000-0000-000000000001', 'production_démarrée', null));
select pg_temp.note('« Prestation terminée »', 'autorisé', pg_temp.etape('f7f7f7f7-0000-0000-0000-000000000001', 'production_terminée', 'prestation_terminee_at'));
select pg_temp.note('« Fichiers sauvegardés »', 'autorisé', pg_temp.etape('f7f7f7f7-0000-0000-0000-000000000001', 'médias_à_transférer', 'fichiers_securises_at'));
select pg_temp.note('« Copie vérifiée »', 'autorisé', pg_temp.etape('f7f7f7f7-0000-0000-0000-000000000001', 'médias_complets', null));
select pg_temp.note('la mission est bien arrivée au bout', 'médias_complets', (select statut::text from prestations where id = (select mission from ctx)));
select pg_temp.note('chaque étape horodatée pour l''opérateur', 'kit,parti,arrivé,terminé,sécurisé',
  (select concat_ws(',', case when kit_prepare_at is not null then 'kit' end, case when parti_at is not null then 'parti' end,
                    case when arrive_at is not null then 'arrivé' end, case when prestation_terminee_at is not null then 'terminé' end,
                    case when fichiers_securises_at is not null then 'sécurisé' end)
     from mission_suivi_operateur where prestation_id = (select mission from ctx) and collaborateur_id = 'f7f7f7f7-0000-0000-0000-000000000001'));
select pg_temp.note('il ne peut pas sauter à « livrée »', 'refusé',
  left(pg_temp.etape('f7f7f7f7-0000-0000-0000-000000000001', 'livrée', null), 6));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
