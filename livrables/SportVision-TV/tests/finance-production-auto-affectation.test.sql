-- ── DIAGNOSTIC DU 28/09/2026 : CE ROUGE ATTEND UNE PHRASE DE FOUKA ────────────────────────────
--
-- Six verifications de ce fichier echouent, et la mesure dit la meme chose pour les six : sur SA
-- PROPRE LIGNE, le Responsable Production n'est plus REFUSE quand il depasse la grille — le montant
-- est accepte, la remuneration effective reste la grille, et l'ecart part en exception a valider par
-- l'Admin. Mesure brute : `55.00/55.00/a_valider/150.00` la ou ce test attend « refuse ».
--
-- C'est exactement la conception des migrations v148-v150 du 11/09 (« exception Admin sur sa propre
-- ligne »), et c'est un meilleur comportement qu'un refus sec : la demande est tracee au lieu d'etre
-- perdue. Ce test, lui, tient encore la regle d'avant.
--
-- POURQUOI JE NE LE CORRIGE PAS MOI-MEME : ce circuit de remuneration est GELE depuis le 10/09, « en
-- observation reelle », modifiable seulement sur retour concret ou P0/P1. Realigner six attentes
-- financieres sur ma lecture d'une note, sans un mot de Fouka, graverait dans la suite de tests une
-- interpretation qu'il n'a pas relue. Une phrase de sa part suffit, et le realignement prend cinq
-- minutes.
--
-- CE QUI A ETE VERIFIE AU PASSAGE, et qui est rassurant : la sortie montre DEUX lignes pour un meme
-- operateur, ce qui ressemble a un risque de double paiement. Il n'y en a pas — un index unique
-- partiel (`prestations_equipe_active_uniq`) interdit deux lignes ACTIVES pour le meme couple
-- mission/collaborateur, et la production n'en compte aucun cas. La seconde ligne du test vient
-- seulement du premier appel, qui reussit desormais au lieu d'etre refuse.
--
-- CE QUI TIENT TOUJOURS, et qui est l'essentiel : pour un AUTRE operateur, 60 EUR sans motif sur une
-- grille a 50 EUR (20 % d'ecart) est bien refuse. La borne n'a pas disparu, elle ne s'applique pas de
-- la meme facon a sa propre ligne.

-- Le Responsable Production ne fixe pas sa propre rémunération (migration v148, 11/09/2026).
--
-- Ce que ce test tient pour vrai :
--   • Production affecte un autre photographe : le modèle actuel (seuil 15 %, motif) reste, mais le
--     montant recommandé vient de la base, plus du navigateur ;
--   • Production s'affecte elle-même : la grille s'applique d'office ;
--   • un autre montant sur sa propre ligne : motif obligatoire, montant en attente, rémunération
--     effective = la grille ; elle ne peut ni approuver ni forcer l'exception ; l'Admin tranche, et la
--     décision est journalisée ;
--   • elle ne valide ni ne règle sa propre rémunération ; la comptabilité règle.
-- Décor fictif (pôle Basket, sans Production réelle), tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f5f5f5f5-0000-0000-0000-000000000001','zz-fp-prod@example.invalid','',now(),'authenticated','authenticated'),
  ('f5f5f5f5-0000-0000-0000-000000000002','zz-fp-photo@example.invalid','',now(),'authenticated','authenticated'),
  ('f5f5f5f5-0000-0000-0000-000000000003','zz-fp-admin@example.invalid','',now(),'authenticated','authenticated'),
  ('f5f5f5f5-0000-0000-0000-000000000004','zz-fp-compta@example.invalid','',now(),'authenticated','authenticated'),
  -- UN SECOND RESPONSABLE PRODUCTION, AJOUTE LE 29/09/2026, ET VOICI POURQUOI. Depuis l'arbitrage
  -- de Fouka, le depassement de grille sur sa propre ligne est ACCEPTE au lieu d'etre refuse. Du
  -- coup les deux auto-affectations de la section 2, faites sur la MEME personne, creaient deux
  -- lignes pour un seul operateur sur une seule mission — et les quatre verifications suivantes
  -- lisaient les deux lignes collees. Ecrire l'attente a deux lignes aurait GRAVE ce doublon dans
  -- la suite comme un comportement voulu, alors que personne ne l'a decide. Chaque verification
  -- porte donc sur son propre operateur.
  ('f5f5f5f5-0000-0000-0000-000000000005','zz-fp-prod2@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif, niveau_operateur) values
  ('f5f5f5f5-0000-0000-0000-000000000001','QA','Prod','prod',true,3),
  ('f5f5f5f5-0000-0000-0000-000000000002','QA','Photo','photo',true,2),
  ('f5f5f5f5-0000-0000-0000-000000000003','QA','Admin','admin',true,null),
  ('f5f5f5f5-0000-0000-0000-000000000004','QA','Compta','compta',true,null),
  ('f5f5f5f5-0000-0000-0000-000000000005','QA','Prod2','prod',true,3)
on conflict (id) do update set role = excluded.role, niveau_operateur = excluded.niveau_operateur;
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select id, 'f5f5f5f5-0000-0000-0000-000000000001'::uuid, 'membre', true from poles where nom = 'Basket';
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select id, 'f5f5f5f5-0000-0000-0000-000000000005'::uuid, 'membre', true from poles where nom = 'Basket';
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation, pole_id) select 'ZZ Club Finance Prod (test)', 'partenaire', id from poles where nom = 'Basket' returning id),
       pre as (insert into prestations (client_id, pole_id, date_prestation, heure_debut, lieu, type_prestation, statut, source, format_mission)
               select cli.id, (select id from poles where nom = 'Basket'), current_date + 4, '09:30', 'Stade ZZ', 'match', 'planifiée', 'interne', 'standard' from cli returning id)
  select (select id from pre) mission;
grant select on ctx to authenticated;
create temp table memo (k text primary key, v text) on commit drop;
grant select, insert, update on memo to authenticated;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text := 'autorisé';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql;
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v;
end $$;
create or replace function pg_temp.ligne(p_uid text) returns text language sql as $$
  select string_agg(coalesce(pe.remuneration::text, '∅') || '/' || coalesce(pe.montant_recommande::text, '∅') || '/'
         || coalesce(to_jsonb(pe)->>'exception_statut', '∅') || '/' || coalesce(to_jsonb(pe)->>'exception_montant', '∅'),
         ' + ' order by pe.created_at, pe.id)
    -- L'ORDRE, ET CE N'EST PAS UN DETAIL (29/09/2026). `string_agg` sans ORDER BY rendait les deux
    -- lignes dans un ordre different d'une execution a l'autre : le meme test annoncait
    -- « 55.00/55.00/a_valider/150.00 + 55.00/55.00/∅/∅ » puis l'inverse deux lignes plus bas. Un
    -- test qui bat au hasard est pire qu'un test rouge : on finit par le croire quand il est vert.
    from prestations_equipe pe where pe.prestation_id = (select mission from ctx) and pe.collaborateur_id = p_uid::uuid; $$;
create or replace function pg_temp.ajouter(p_acteur text, p_col text, p_remu text, p_reco text, p_motif text) returns text language sql as $$
  select pg_temp.fait(p_acteur::uuid,
    'select rpc_ajouter_membre_equipe(' || quote_literal((select mission from ctx)) || '::uuid, ''' || p_col || '''::uuid, null, null, null, '
    || p_remu || ', null, null, null, ' || p_reco || ', ' || coalesce(quote_literal(p_motif), 'null') || ', ' || coalesce(quote_literal(p_motif), 'null') || ', false)'); $$;

-- ── 1. Production affecte un autre photographe (niveau 2 : 50 € recommandés) ──
select pg_temp.note('autre opérateur : 60 € sans motif (20 %) refusé', 'refusé',
  left(pg_temp.ajouter('f5f5f5f5-0000-0000-0000-000000000001', 'f5f5f5f5-0000-0000-0000-000000000002', '60', '60', null), 6));
select pg_temp.note('autre opérateur : 56 €, recommandé « 999 » envoyé par le navigateur', 'autorisé',
  pg_temp.ajouter('f5f5f5f5-0000-0000-0000-000000000001', 'f5f5f5f5-0000-0000-0000-000000000002', '56', '999', null));
select pg_temp.note('le recommandé retenu est celui de la grille, pas celui du navigateur', '56.00/50.00/∅/∅',
  pg_temp.ligne('f5f5f5f5-0000-0000-0000-000000000002'));

-- ── 2. Production s'affecte elle-même (niveau 3 : 55 €) ──
-- ARBITRE PAR FOUKA LE 29/09/2026 : « Accepte et trace, l'Admin valide. » Le depassement de grille
-- sur sa propre ligne n'est plus REFUSE : le montant est accepte, la remuneration effective reste la
-- grille, et l'ecart part en exception a valider par l'Admin. C'est la conception des migrations
-- v148-v150 du 11/09, et c'est mieux qu'un refus sec — la demande est tracee au lieu d'etre perdue.
select pg_temp.note('auto-affectation à 150 € sans motif : acceptée, et tracée en exception', 'autorisé',
  pg_temp.ajouter('f5f5f5f5-0000-0000-0000-000000000001', 'f5f5f5f5-0000-0000-0000-000000000001', '150', '150', null));
select pg_temp.note('auto-affectation sans montant : autorisée', 'autorisé',
  pg_temp.ajouter('f5f5f5f5-0000-0000-0000-000000000005', 'f5f5f5f5-0000-0000-0000-000000000005', 'null', 'null', null));
select pg_temp.note('sa rémunération est la grille, d''office', '55.00/55.00/∅/∅', pg_temp.ligne('f5f5f5f5-0000-0000-0000-000000000005'));
insert into memo select 'pe_prod', id::text from prestations_equipe where prestation_id = (select mission from ctx) and collaborateur_id = 'f5f5f5f5-0000-0000-0000-000000000001' order by created_at desc limit 1;
update prestations_equipe set statut = 'acceptée' where id = (select v::uuid from memo where k = 'pe_prod');

-- ── 3. Elle tente de s'augmenter ──
-- Meme arbitrage : accepte et trace.
select pg_temp.note('150 € sans motif sur sa ligne : acceptée, et tracée', 'autorisé',
  pg_temp.fait('f5f5f5f5-0000-0000-0000-000000000001', 'select modifier_remuneration_mission(''' || (select v from memo where k = 'pe_prod') || ''', 150, 150, null, null)'));
select pg_temp.note('150 € avec motif : demande enregistrée', 'autorisé',
  pg_temp.fait('f5f5f5f5-0000-0000-0000-000000000001', 'select modifier_remuneration_mission(''' || (select v from memo where k = 'pe_prod') || ''', 150, 150, ''urgence'', ''Match très éloigné'')'));
select pg_temp.note('rémunération effective = grille, 150 € en attente Admin', '55.00/55.00/a_valider/150.00', pg_temp.ligne('f5f5f5f5-0000-0000-0000-000000000001'));
select pg_temp.note('aucune notification « augmentée » envoyée à soi-même', '0',
  (select count(*)::text from notifications where destinataire_id = 'f5f5f5f5-0000-0000-0000-000000000001' and type = 'remuneration_modifiee'));

-- ── 4. Elle ne peut pas trancher elle-même ──
select pg_temp.note('Production décide de sa propre exception : refusé', 'refusé',
  left(pg_temp.fait('f5f5f5f5-0000-0000-0000-000000000001', 'select decider_exception_remuneration(''' || (select v from memo where k = 'pe_prod') || ''', true)'), 6));
select pg_temp.note('Production écrit « approuvée » sur la ligne : refusé', 'refusé',
  left(pg_temp.fait('f5f5f5f5-0000-0000-0000-000000000001', 'update prestations_equipe set exception_statut = ''approuvee'', remuneration = 150 where id = ''' || (select v from memo where k = 'pe_prod') || ''''), 6));
select pg_temp.note('la ligne n''a pas bougé', '55.00/55.00/a_valider/150.00', pg_temp.ligne('f5f5f5f5-0000-0000-0000-000000000001'));
select pg_temp.note('l''Admin approuve', 'autorisé',
  pg_temp.fait('f5f5f5f5-0000-0000-0000-000000000003', 'select decider_exception_remuneration(''' || (select v from memo where k = 'pe_prod') || ''', true, ''Déplacement confirmé'')'));
select pg_temp.note('rémunération = montant approuvé', '150.00/55.00/approuvee/150.00', pg_temp.ligne('f5f5f5f5-0000-0000-0000-000000000001'));
select pg_temp.note('décision journalisée : avant, après, demandé, motif, auteur', '55.00→150.00 · Match très éloigné · admin',
  (select l.montant_avant || '→' || l.montant_apres || ' · ' || (l.details->>'motif') || ' · ' || (select role from profiles where id = l.acteur_id)
     from financial_audit_log l where l.ligne_id = (select v::uuid from memo where k = 'pe_prod') and l.action = 'exception_approuvee'));

-- ── 5. Validation et règlement ──
select pg_temp.note('Production valide sa propre rémunération : refusé', 'refusé',
  left(pg_temp.fait('f5f5f5f5-0000-0000-0000-000000000001', 'update prestations_equipe set statut_paiement = ''validé'' where id = ''' || (select v from memo where k = 'pe_prod') || ''''), 6));
select pg_temp.note('Production marque payée sa propre rémunération : refusé', 'refusé',
  left(pg_temp.fait('f5f5f5f5-0000-0000-0000-000000000001', 'update prestations_equipe set statut_paiement = ''payé'', date_paiement = now() where id = ''' || (select v from memo where k = 'pe_prod') || ''''), 6));
update prestations_equipe set statut = 'acceptée' where prestation_id = (select mission from ctx) and collaborateur_id = 'f5f5f5f5-0000-0000-0000-000000000002';
select pg_temp.note('Production valide celle d''un autre opérateur : comme avant', 'autorisé',
  pg_temp.fait('f5f5f5f5-0000-0000-0000-000000000001', 'update prestations_equipe set statut_paiement = ''validé'' where prestation_id = ''' || (select mission from ctx) || ''' and collaborateur_id = ''f5f5f5f5-0000-0000-0000-000000000002'''));
select pg_temp.note('la comptabilité règle la Production', 'autorisé',
  pg_temp.fait('f5f5f5f5-0000-0000-0000-000000000004', 'update prestations_equipe set statut_paiement = ''payé'', date_paiement = now() where id = ''' || (select v from memo where k = 'pe_prod') || ''''));
select pg_temp.note('visible comme payée', 'payé', (select statut_paiement from prestations_equipe where id = (select v::uuid from memo where k = 'pe_prod')));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
