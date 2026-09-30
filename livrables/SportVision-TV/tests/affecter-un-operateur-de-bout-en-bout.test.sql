-- Affecter un opérateur, de bout en bout (30/09/2026).
--
-- C'est le geste central de l'application OS du responsable de production, et il engage de
-- l'argent : une affectation crée une rémunération. Ce test rejoue EXACTEMENT ce que fait l'écran,
-- avec l'identité d'un `prod`, et vérifie chaque maillon.
--
-- Ce qu'il tient pour vrai :
--   • un `prod` de ce pôle a le droit d'affecter (c'est ce que l'écran demande AVANT d'afficher
--     le bouton : on ne montre pas un geste qui finira en refus) ;
--   • `rpc_ajouter_membre_equipe(p_envoyer => false)` crée la ligne au statut `a_envoyer` ;
--   • à ce stade l'opérateur ne voit RIEN — il est prévu, pas invité ;
--   • `envoyer_propositions_mission` la fait passer en `invitation_envoyée` ET écrit la
--     notification, avec le lieu, l'heure et le montant ;
--   • l'opérateur voit alors sa mission, et reçoit la notification ;
--   • `rpc_retirer_membre_equipe` fait marche arrière.
--
-- POURQUOI DEUX APPELS ET PAS `p_envoyer => true` : la RPC seule ne prévient personne.
-- `envoyer_propositions_mission` porte le texte de l'invitation, et il n'est écrit qu'une fois,
-- en base. L'écran ne le recopie pas.
--
-- PIÈGE DE MESURE, PAYÉ LE 30/09 : compter les notifications avec l'identité de CELUI QUI AFFECTE
-- répond zéro, toujours. La policy de `notifications` ne laisse lire que les siennes. On compte
-- donc avec les yeux du destinataire. Un test écrit à l'envers aurait conclu « l'invitation ne
-- part pas » sur une chaîne parfaitement saine.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('dd11dd11-0000-0000-0000-000000000001','zz-prod-affect@example.invalid','',now(),'authenticated','authenticated'),
  ('dd11dd11-0000-0000-0000-000000000002','zz-photo-affect@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into profiles (id, prenom, nom, role, actif) values
  ('dd11dd11-0000-0000-0000-000000000001','ZZ','Prod affectation','prod',true),
  ('dd11dd11-0000-0000-0000-000000000002','ZZ','Photo affectation','photo',true)
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with pole as (select pole_id id from pole_affectations group by pole_id order by count(*) desc limit 1),
       cli as (insert into clients (nom, statut_relation) values ('ZZ Client affectation','partenaire') returning id),
       pr as (insert into prestations (client_id, date_prestation, heure_debut, lieu, statut, couverture, pole_id)
              select cli.id, current_date + 7, time '13:45', 'ZZ Stade de test', 'confirmée', 'photo_video', pole.id
              from cli, pole returning id, reference)
  select (select id from pr) presta, (select reference from pr) ref, (select id from pole) pole;

-- Les deux comptes sont dans le pôle de la mission : sans ça, le test serait rouge pour une raison
-- qui n'a rien à voir avec ce qu'il prétend vérifier.
insert into pole_affectations (user_id, pole_id)
select id, (select pole from ctx) from profiles
where id in ('dd11dd11-0000-0000-0000-000000000001','dd11dd11-0000-0000-0000-000000000002')
on conflict do nothing;
grant select on ctx to authenticated;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

create or replace function pg_temp.vu_par(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, '(null)');
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'refusé : ' || sqlerrm;
end $$;

select pg_temp.note('le prod du pôle a le droit d''affecter', 'true',
  pg_temp.vu_par('dd11dd11-0000-0000-0000-000000000001',
    'select prestation_pole_scope_ok((select presta from ctx))::text'));

select pg_temp.note('l''affectation est créée', 'oui',
  case when pg_temp.vu_par('dd11dd11-0000-0000-0000-000000000001',
    'select rpc_ajouter_membre_equipe(p_prestation_id => (select presta from ctx), p_collaborateur_id => ''dd11dd11-0000-0000-0000-000000000002''::uuid, p_fonction => null, p_notes => null, p_heure_rdv => null, p_remuneration => 55, p_envoyer => false)::text')
    like 'refusé%' then 'non' else 'oui' end);

select pg_temp.note('elle naît au statut a_envoyer', 'a_envoyer',
  (select statut::text from prestations_equipe where prestation_id = (select presta from ctx)));

-- LE CONTRÔLE QUI COMPTE VRAIMENT À CE STADE : prévu n'est pas invité. Si l'opérateur voyait déjà
-- la mission, la production ne pourrait plus préparer une affectation sans l'annoncer.
select pg_temp.note('l''opérateur ne la voit PAS encore', '0',
  pg_temp.vu_par('dd11dd11-0000-0000-0000-000000000002',
    'select count(*)::text from prestations_equipe where prestation_id = (select presta from ctx)'));

select pg_temp.note('envoyer_propositions_mission déplace 1 ligne', '1',
  pg_temp.vu_par('dd11dd11-0000-0000-0000-000000000001',
    'select envoyer_propositions_mission((select presta from ctx))::text'));

select pg_temp.note('la ligne est passée en invitation_envoyée', 'invitation_envoyée',
  (select statut::text from prestations_equipe where prestation_id = (select presta from ctx)));

select pg_temp.note('l''opérateur voit maintenant sa mission', '1',
  pg_temp.vu_par('dd11dd11-0000-0000-0000-000000000002',
    'select count(*)::text from prestations_equipe where prestation_id = (select presta from ctx)'));

-- Compté avec les yeux du DESTINATAIRE. Voir l'en-tête : compté avec ceux de l'affecteur, ce
-- contrôle répondrait zéro sur une chaîne parfaitement saine.
select pg_temp.note('il a reçu l''invitation', '1',
  pg_temp.vu_par('dd11dd11-0000-0000-0000-000000000002',
    'select count(*)::text from notifications where prestation_id = (select presta from ctx) and type = ''invitation'''));

select pg_temp.note('l''invitation porte le montant proposé', 'oui',
  case when pg_temp.vu_par('dd11dd11-0000-0000-0000-000000000002',
    'select message from notifications where prestation_id = (select presta from ctx) and type = ''invitation'' limit 1')
    like '%55 €%' then 'oui' else 'non' end);

-- EN DEUX INSTRUCTIONS, ET C'EST UNE LEÇON DE CE TEST : écrites en une seule, le retrait et le
-- comptage donnaient « 1 ligne restante » sur une suppression parfaitement réussie. Postgres
-- évalue une sous-requête non corrélée UNE FOIS, au démarrage de l'instruction — donc avant
-- l'appel qui supprime. Le test accusait la base d'un défaut qui était le sien.
select pg_temp.note('le retrait est accepté', 'accepté',
  case when pg_temp.vu_par('dd11dd11-0000-0000-0000-000000000001',
    'select rpc_retirer_membre_equipe(p_equipe_id => (select id from prestations_equipe where prestation_id = (select presta from ctx)))::text') like 'refusé%'
  then 'refusé' else 'accepté' end);

select pg_temp.note('et la ligne a disparu', '0',
  (select count(*)::text from prestations_equipe where prestation_id = (select presta from ctx)));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
