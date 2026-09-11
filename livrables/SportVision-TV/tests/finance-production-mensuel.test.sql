-- La Finance du Responsable Production, calcul mensuel (migration v149, 11/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • coordination : seules les missions pilotées et non annulées comptent ; acquise à la livraison ;
--   • terrain : sa propre affectation, acquise à la livraison ;
--   • ventes : encaissé HT des seules familles cochées, remboursements déduits, recalcul avant
--     validation, montant figé après ;
--   • il ne valide ni ne règle son calcul ni ses frais ; la comptabilité le fait ;
--   • la Production de Football ne voit rien des finances personnelles de celle de Basket.
-- Décor fictif (pôle Basket, sans Production réelle), tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f6f6f6f6-0000-0000-0000-000000000001','zz-fm-prod-basket@example.invalid','',now(),'authenticated','authenticated'),
  ('f6f6f6f6-0000-0000-0000-000000000002','zz-fm-prod-foot@example.invalid','',now(),'authenticated','authenticated'),
  ('f6f6f6f6-0000-0000-0000-000000000003','zz-fm-compta@example.invalid','',now(),'authenticated','authenticated'),
  ('f6f6f6f6-0000-0000-0000-000000000004','zz-fm-admin@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif, niveau_operateur) values
  ('f6f6f6f6-0000-0000-0000-000000000001','QA','Prod Basket','prod',true,3),
  ('f6f6f6f6-0000-0000-0000-000000000002','QA','Prod Foot','prod',true,3),
  ('f6f6f6f6-0000-0000-0000-000000000003','QA','Compta','compta',true,null),
  ('f6f6f6f6-0000-0000-0000-000000000004','QA','Admin','admin',true,null)
on conflict (id) do update set role = excluded.role, niveau_operateur = excluded.niveau_operateur;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select (select id from poles where nom = 'Basket'), 'f6f6f6f6-0000-0000-0000-000000000001'::uuid, 'membre', true union all
select (select id from poles where nom = 'Football'), 'f6f6f6f6-0000-0000-0000-000000000002'::uuid, 'membre', true;
insert into production_remuneration_config (pole_id, responsable_production_id, coordination_montant, ventes_familles, ventes_taux_pct)
select id, 'f6f6f6f6-0000-0000-0000-000000000001', 10, array['ponctuelles', 'galeries'], 5 from poles where nom = 'Basket'
on conflict (pole_id) do update set responsable_production_id = excluded.responsable_production_id,
  coordination_montant = 10, ventes_familles = excluded.ventes_familles, ventes_taux_pct = 5,
  ventes_paliers = '[]', ventes_bonus_fixe = 0, ventes_objectif_mensuel = null, tva_pct = 20;

create temp table ctx on commit drop as
  with pole as (select id from poles where nom = 'Basket'),
       cli as (insert into clients (nom, statut_relation, pole_id) select 'ZZ Club Finance Mensuel (test)', 'partenaire', id from pole returning id)
  select (select id from pole) pole_id, (select id from cli) client_id, date_trunc('month', current_date)::date as m;
grant select on ctx to authenticated;
-- M1 livrée, M2 planifiée, M3 annulée : toutes pilotées par la Production de Basket, ce mois-ci.
insert into prestations (client_id, pole_id, date_prestation, heure_debut, lieu, type_prestation, statut, source, responsable_prod_id, equipes, format_mission)
select ctx.client_id, ctx.pole_id, ctx.m + v.j, '09:30', 'Stade ZZ', 'match', v.st::statut_prestation, 'interne',
       'f6f6f6f6-0000-0000-0000-000000000001', v.eq, 'standard'
  from ctx, (values (1, 'livrée', 'ZZ M1'), (2, 'planifiée', 'ZZ M2'), (3, 'annulée', 'ZZ M3')) v(j, st, eq);
-- Elle a elle-même photographié M1 (grille niveau 3 : 55 €).
insert into prestations_equipe (prestation_id, collaborateur_id, statut, remuneration, montant_recommande)
select id, 'f6f6f6f6-0000-0000-0000-000000000001', 'acceptée', 55, 55 from prestations where equipes = 'ZZ M1' and client_id = (select client_id from ctx);
-- Encaissements du pôle : 120 € TTC et 60 € TTC ponctuels (éligibles), 240 € TTC d'abonnement (non coché).
insert into paiements (client_id, prestation_id, type_paiement, montant, statut)
select ctx.client_id, (select id from prestations where equipes = 'ZZ M1' and client_id = ctx.client_id), 'totalite', v.mt, 'reussi'
  from ctx, (values (120), (60)) v(mt);
insert into paiements (client_id, type_paiement, montant, statut) select client_id, 'totalite', 240, 'reussi' from ctx;
-- Une note de frais de 42 €, à valider.
insert into frais (collaborateur_id, pole_id, type, montant, description, statut, date_frais)
select 'f6f6f6f6-0000-0000-0000-000000000001', pole_id, 'repas', 42, 'ZZ repas tournoi', 'en_attente', m + 1 from ctx;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.lu(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into v;
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, '∅');
end $$;
create or replace function pg_temp.mes(p_uid uuid, p_chemin text) returns text language sql as $$
  select pg_temp.lu(p_uid, 'select production_mes_finances(' || quote_literal((select m from ctx)) || '::date) #>> ''' || p_chemin || ''''); $$;
create or replace function pg_temp.calc(p_uid uuid) returns text language sql as $$
  select pg_temp.lu(p_uid, 'select total::text || ''/'' || statut from production_calculer_remuneration(' || quote_literal((select pole_id from ctx)) || ', ' || quote_literal((select m from ctx)) || '::date)'); $$;
create or replace function pg_temp.id_calc() returns text language sql as $$
  select id::text from pole_remuneration_calculs where pole_id = (select pole_id from ctx) and periode = (select m from ctx) and beneficiaire = 'responsable_production'; $$;
create or replace function pg_temp.agir(p_uid uuid, p_action text) returns text language sql as $$
  select pg_temp.lu(p_uid, 'select statut from production_regler_remuneration(''' || pg_temp.id_calc() || ''', ''' || p_action || ''')'); $$;

-- ── Les quatre blocs ──
select pg_temp.note('coordination : 2 missions pilotées (l''annulée exclue), 1 acquise (livrée)', '2/1',
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{poles,0,coordination,nb_missions}') || '/' ||
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{poles,0,coordination,nb_acquises}'));
select pg_temp.note('coordination : 10 € acquis, 20 € prévisionnels', '10/20',
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{poles,0,coordination,montant_acquis}') || '/' ||
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{poles,0,coordination,montant_previsionnel}'));
select pg_temp.note('terrain : sa mission M1, 55 €, acquise', '55.00/acquis',
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{terrain,0,montant}') || '/' ||
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{terrain,0,statut}'));
select pg_temp.note('ventes : 150 € HT encaissés éligibles, l''abonnement non coché écarté', '150.00',
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{poles,0,ventes,ca_eligible}'));
select pg_temp.note('ventes : 5 % de 150 € = 7,50 €', '7.50', pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{poles,0,ventes,montant}'));
select pg_temp.note('ventes : chaque ligne dit sa famille et si elle compte', 'abonnements:false',
  (select string_agg((l->>'famille') || ':' || (l->>'eligible'), ',') from jsonb_array_elements(
     (pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{poles,0,ventes,lignes}'))::jsonb) l where l->>'famille' = 'abonnements'));
select pg_temp.note('frais : 42 €, à valider (prévisionnel)', '42.00/previsionnel',
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{frais,0,montant}') || '/' ||
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{frais,0,statut}'));

-- ── Une vente remboursée avant validation : le calcul suit ──
select pg_temp.note('calcul mensuel lancé par elle-même : fixe 0 + coordination 10 + ventes 7,50', '17.50/a_valider', pg_temp.calc('f6f6f6f6-0000-0000-0000-000000000001'));
insert into paiements (client_id, prestation_id, type_paiement, montant, statut)
select client_id, (select id from prestations where equipes = 'ZZ M1' and client_id = ctx.client_id), 'totalite', 60, 'rembourse' from ctx;
select pg_temp.note('remboursement de 60 € TTC : base 100 € HT, prime 5 €', '50.00/5.00',
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{poles,0,ventes,rembourse}') || '/' ||
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{poles,0,ventes,montant}'));
select pg_temp.note('recalcul avant validation', '15.00/a_valider', pg_temp.calc('f6f6f6f6-0000-0000-0000-000000000001'));

-- ── Validation et règlement : jamais par elle-même ──
select pg_temp.note('elle valide son propre calcul : refusé', 'refusé', left(pg_temp.agir('f6f6f6f6-0000-0000-0000-000000000001', 'valider'), 6));
select pg_temp.note('elle marque son calcul payé : refusé', 'refusé', left(pg_temp.agir('f6f6f6f6-0000-0000-0000-000000000001', 'payer'), 6));
select pg_temp.note('elle écrit « payé » directement : aucune ligne changée', '0',
  pg_temp.lu('f6f6f6f6-0000-0000-0000-000000000001',
    'with u as (update pole_remuneration_calculs set statut = ''paye'' where id = ''' || pg_temp.id_calc() || ''' returning 1) select count(*)::text from u'));
select pg_temp.note('la comptabilité valide', 'valide', pg_temp.agir('f6f6f6f6-0000-0000-0000-000000000003', 'valider'));
insert into paiements (client_id, prestation_id, type_paiement, montant, statut)
select client_id, (select id from prestations where equipes = 'ZZ M1' and client_id = ctx.client_id), 'totalite', 120, 'rembourse' from ctx;
select pg_temp.note('après validation, le montant validé est figé', '15.00/valide', pg_temp.calc('f6f6f6f6-0000-0000-0000-000000000001'));
select pg_temp.note('la comptabilité transmet puis règle', 'transmis_compta/paye',
  pg_temp.agir('f6f6f6f6-0000-0000-0000-000000000003', 'transmettre') || '/' || pg_temp.agir('f6f6f6f6-0000-0000-0000-000000000003', 'payer'));
select pg_temp.note('elle le voit payé, au montant validé', 'paye/15.00',
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{poles,0,statut}') || '/' ||
  pg_temp.mes('f6f6f6f6-0000-0000-0000-000000000001', '{poles,0,montant_mensuel}'));
select pg_temp.note('chaque étape est journalisée (ordre alphabétique : même instant dans ce test)', 'calcul,calcul,payer,transmettre,valider',
  (select string_agg(action, ',' order by action) from financial_audit_log where ligne_id = pg_temp.id_calc()::uuid));

-- ── Ses frais ──
select pg_temp.note('elle valide sa propre note de frais : refusé', 'refusé',
  left(pg_temp.lu('f6f6f6f6-0000-0000-0000-000000000001', 'update frais set statut = ''validé'' where description = ''ZZ repas tournoi'' returning statut'), 6));
select pg_temp.note('la comptabilité la valide', 'validé',
  pg_temp.lu('f6f6f6f6-0000-0000-0000-000000000003', 'update frais set statut = ''validé'' where description = ''ZZ repas tournoi'' returning statut'));

-- ── Le cloisonnement entre pôles ──
select pg_temp.note('la Production de Football ouvre les finances de celle de Basket : refusé', 'refusé',
  left(pg_temp.lu('f6f6f6f6-0000-0000-0000-000000000002',
    'select production_mes_finances(' || quote_literal((select m from ctx)) || '::date, ''f6f6f6f6-0000-0000-0000-000000000001'')::text'), 6));
select pg_temp.note('ni son calcul mensuel, ni la configuration du pôle Basket', '0/0',
  pg_temp.lu('f6f6f6f6-0000-0000-0000-000000000002',
    'select (select count(*) from pole_remuneration_calculs where responsable_id = ''f6f6f6f6-0000-0000-0000-000000000001'')::text || ''/'' || (select count(*) from production_remuneration_config where pole_id = ' || quote_literal((select pole_id from ctx)) || ')::text'));
select pg_temp.note('la configuration ne se modifie que par l''Admin', 'refusé',
  left(pg_temp.lu('f6f6f6f6-0000-0000-0000-000000000001',
    'with u as (update production_remuneration_config set coordination_montant = 500 where pole_id = ' || quote_literal((select pole_id from ctx)) || ' returning 1) select case when count(*) = 0 then ''refusé'' else ''modifié'' end from u'), 6));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
