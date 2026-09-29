-- Le récapitulatif mensuel de prestations (v358 à v363, 29/09/2026).
--
-- CE QUE CETTE CHAÎNE FAIT, et pourquoi elle mérite un test permanent. À la fin du mois, Fouka
-- coupe, regarde ce qu'il y a à payer, décide du montant, et envoie à chaque collaborateur
-- FREELANCE un récapitulatif de ses prestations. Le document part chez une vraie personne et
-- annonce un virement. Trois choses peuvent donc mal tourner, et chacune coûte cher :
--   un montant qui bouge après l'envoi, et personne ne sait plus ce qui a été annoncé ;
--   un deuxième envoi, et la même personne s'attend à être payée deux fois ;
--   une fuite, et la paie de chacun devient lisible par un collègue.
--
-- ATTENTION AU PÉRIMÈTRE : LA CHAÎNE VIVANTE VA JUSQU'À v363, PAS JUSQU'À v360. v360 faisait l'envoi
-- d'un bloc (`statut = 'envoye'` et affectations transmises dès l'appel), et trois migrations du même
-- jour l'ont repris. Ce test mesure donc l'état RÉEL de la base :
--   `recap_envoyer`           prépare un BROUILLON (v361), fige les lignes et les totaux, et ne
--                             transmet rien. Rejouable sans doublon tant que rien n'est parti.
--   `recap_marquer_envoye`    confirme que le message est PARTI (v361) : statut `envoye`, date
--                             d'envoi, et affectations en `transmis_compta`. La coupure existe parce
--                             que l'e-mail part après, depuis une edge function : si le fournisseur
--                             tombe, la base ne doit pas affirmer un envoi que personne n'a reçu.
--   `recap_jour_ouvre`        reporte la date de virement annoncée au jour ouvré (v362) : on
--                             annonçait des dimanches, que les banques ne traitent pas.
--   `recap_virement_effectue` paie vraiment, 3 à 5 jours plus tard, et TRACE la date sur le
--                             récapitulatif (v363) au lieu de la déduire de l'état des lignes.
-- Un test écrit sur le seul texte de v360 serait rouge sans qu'aucun défaut existe, et il finirait
-- par être « corrigé » en relâchant ses attentes. La mesure passe donc par les fonctions réellement
-- déployées, pas par le fichier le plus récent que l'on croit connaître.
--
-- CE QUE CE TEST TIENT POUR VRAI :
--   1. les droits : `recap_a_payer` à l'Admin et à la comptabilité seulement, `recap_envoyer` à
--      l'Admin seul, `recap_marquer_envoye` à l'Admin ou au moteur d'envoi. C'est la donnée la
--      plus personnelle de l'OS (décision du 10/09, v129 : « jamais paie globale hors mission ») ;
--   2. un seul envoi par personne et par mois ;
--   3. le mois va du premier au dernier jour, et se compte à Paris (leçon du 14/09) ;
--   4. les montants sont des instantanés : une fois le document parti, modifier la ligne d'origine
--      ne le touche plus ;
--   5. l'envoi ne marque pas « payé », il marque `transmis_compta` ; seul le virement paie
--      (règle du 10/09 : aucune action n'affiche un succès qui n'a pas eu lieu) ;
--   6. le collaborateur lit SON récapitulatif, et seulement une fois envoyé ;
--   7. les ajustements sont négatifs, et le total est leur somme.
--
-- POURQUOI LE PIÈGE DU 1er DU MOIS SUIVANT EST TESTÉ À PART. Une borne de fin écrite `<= dernier
-- jour` sur un instant, ou un `date_trunc` calculé en UTC, fait entrer une mission du 1er octobre à
-- 0 h 30 dans le mois de septembre. Personne ne le verrait sur le document : les montants seraient
-- simplement « un peu gros », et le mois suivant « un peu maigre ». Le décor pose donc exprès une
-- prestation le 1er du mois suivant et une le dernier jour du mois précédent, toutes deux avec une
-- rémunération énorme, pour qu'une fuite saute aux yeux au lieu de se fondre dans un total.
--
-- DÉCOR ENTIÈREMENT FICTIF, TOUT EST ANNULÉ. Cinq identités `zz-recap-*@example.invalid`, un club de
-- décor, quatre prestations, un mois (janvier 2026) antérieur à toute activité réelle. Aucun vrai
-- collaborateur n'est touché, et le `rollback` final ne laisse rien en base : sans cela, ce test
-- préparerait un vrai récapitulatif annonçant un vrai virement à une vraie personne.
--
-- UNE OBSERVATION LAISSÉE TELLE QUELLE, SANS LA CORRIGER NI LA GRAVER. v359 et v361 écartent les
-- ajustements « contestés » par `statut not in ('annulee','contestee')`, mais
-- `mission_penalites.statut` n'admet que 'appliquee' et 'annulee' (v231) : contester écrit
-- `contestation` et `conteste_le`, jamais le statut. Le filtre est donc mort, et une retenue
-- contestée par écrit entre quand même dans le récapitulatif. Ce n'est pas forcément un défaut (une
-- contestation n'est pas une annulation, et la retenue reste due tant que personne n'a tranché),
-- donc ce test ne l'affirme dans AUCUN sens : il attend un mot de Fouka. Noté ici pour que la
-- question ne se redécouvre pas dans six mois sur un document déjà parti.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ══ DÉCOR ═══════════════════════════════════════════════════════════════════════════════════════
-- Des uuid fixes et reconnaissables (c7c7c7c7) : un rouge sur de l'argent se relit dans un journal
-- d'audit financier, et un identifiant aléatoire ne se reconnaît pas.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
  ('c7c7c7c7-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-recap-admin@example.invalid','',now(),now(),now()),
  ('c7c7c7c7-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-recap-compta@example.invalid','',now(),now(),now()),
  ('c7c7c7c7-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-recap-prod@example.invalid','',now(),now(),now()),
  ('c7c7c7c7-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-recap-collab@example.invalid','',now(),now(),now()),
  ('c7c7c7c7-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-recap-ope@example.invalid','',now(),now(),now())
on conflict (id) do nothing;

insert into profiles (id, prenom, nom, email, role, actif) values
  ('c7c7c7c7-0000-0000-0000-000000000001','ZZ','Recap Admin','zz-recap-admin@example.invalid','admin',true),
  ('c7c7c7c7-0000-0000-0000-000000000002','ZZ','Recap Compta','zz-recap-compta@example.invalid','compta',true),
  ('c7c7c7c7-0000-0000-0000-000000000003','ZZ','Recap Production','zz-recap-prod@example.invalid','prod',true),
  ('c7c7c7c7-0000-0000-0000-000000000004','ZZ','Recap Collaborateur','zz-recap-collab@example.invalid','photo',true),
  ('c7c7c7c7-0000-0000-0000-000000000005','ZZ','Recap Operateur','zz-recap-ope@example.invalid','photo',true)
on conflict (id) do update set role = excluded.role, actif = true, email = excluded.email;

-- La Production est RESPONSABLE de son pôle : sans cela on mesurerait un refus de périmètre au lieu
-- de mesurer que la paie du mois lui est fermée même quand elle a toute autorité sur les missions.
-- C'est exactement l'identité qui pourrait croire y avoir droit.
insert into pole_affectations (pole_id, user_id, role_pole, actif)
select (select id from poles order by nom limit 1), 'c7c7c7c7-0000-0000-0000-000000000003'::uuid, 'responsable', true
on conflict (pole_id, user_id) do update set role_pole = 'responsable', actif = true;

create temp table ctx on commit drop as
  with cli as (
    insert into clients (nom, statut_relation, pole_id)
    select 'ZZ Club Recap Mensuel (test)', 'partenaire', id from poles order by nom limit 1
    returning id)
  select (select id from cli) as client_id, date '2026-01-01' as mois;

-- QUATRE PRESTATIONS, DONT DEUX HORS DU MOIS :
--   2026-01-12 et 2026-01-23 : dans le mois ;
--   2025-12-31 : dernier jour du mois PRÉCÉDENT, ne doit pas entrer ;
--   2026-02-01 : premier jour du mois SUIVANT, ne doit pas entrer. C'est le piège.
insert into prestations (client_id, reference, date_prestation, heure_debut, lieu, type_prestation, statut, couverture)
select ctx.client_id, v.ref, v.d, '10:00', 'STADE ZZ DU TEST', 'match', 'livrée', 'photo'
  from ctx, (values
    ('ZZ-RECAP-M-01', date '2026-01-12'),
    ('ZZ-RECAP-M-02', date '2026-01-23'),
    ('ZZ-RECAP-AVANT', date '2025-12-31'),
    ('ZZ-RECAP-APRES', date '2026-02-01')) v(ref, d);

insert into prestations_equipe (prestation_id, collaborateur_id, fonction, remuneration, frais_declares, frais_km, statut, statut_paiement, travail_valide)
select p.id, 'c7c7c7c7-0000-0000-0000-000000000004'::uuid, 'Photographe',
       case p.reference when 'ZZ-RECAP-M-01' then 90 when 'ZZ-RECAP-M-02' then 110
                        when 'ZZ-RECAP-AVANT' then 500 else 700 end,
       case p.reference when 'ZZ-RECAP-M-01' then 12 else 0 end,
       case p.reference when 'ZZ-RECAP-M-01' then 8 else 0 end,
       'acceptée', 'en_attente', true
  from prestations p
 where p.client_id = (select client_id from ctx) and p.reference like 'ZZ-RECAP-%';

create temp table aff on commit drop as
  select p.reference, pe.id as affectation_id
    from prestations_equipe pe join prestations p on p.id = pe.prestation_id
   where p.client_id = (select client_id from ctx);

-- Une prime de 50 sur la première mission, une retenue de 30 sur la seconde : le document doit
-- porter les deux, la retenue en NÉGATIF.
insert into mission_primes (affectation_id, montant, motif, statut, cree_par)
select affectation_id, 50, 'Deplacement supplementaire', 'active', 'c7c7c7c7-0000-0000-0000-000000000003'
  from aff where reference = 'ZZ-RECAP-M-01';
insert into mission_penalites (affectation_id, montant, motif, statut, cree_par)
select affectation_id, 30, 'Trois matchs manquants', 'appliquee', 'c7c7c7c7-0000-0000-0000-000000000003'
  from aff where reference = 'ZZ-RECAP-M-02';

-- LE BROUILLON D'UNE AUTRE PERSONNE, pour mesurer les deux cloisons d'un coup : un collaborateur ne
-- lit pas le document d'un collègue, et un brouillon ne se lit pas même par son destinataire.
insert into recapitulatifs_remuneration (id, collaborateur_id, mois, montant_verse, statut)
values ('c7c7c7c7-0000-0000-0000-0000000000b1','c7c7c7c7-0000-0000-0000-000000000005'::uuid, date '2026-01-01', 120, 'brouillon');

-- ══ INSTRUMENTS ═════════════════════════════════════════════════════════════════════════════════
create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

-- On joue SOUS L'IDENTITÉ mesurée, pas sous postgres : un contrôle de droits exécuté en
-- superutilisateur ne mesure rien du tout, et c'est la façon classique de fabriquer un vert creux.
create or replace function pg_temp.essai(p_uid uuid, p_sql text) returns text language plpgsql as $$
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

create or replace function pg_temp.essai_anon(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin execute p_sql into v;
  exception when others then v := 'refusé : ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, '∅');
end $$;

-- On mesure LE REFUS, pas sa formulation : un message reformulé ne doit pas faire rougir un contrôle
-- de droits. Une acceptation, en revanche, est rendue en clair avec le début de ce qui est sorti,
-- pour qu'un rouge dise tout de suite ce qui a fui.
create or replace function pg_temp.refus(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin v := pg_temp.essai(p_uid, p_sql);
  return case when left(v, 6) = 'refusé' then 'refusé' else 'ACCEPTE (' || left(v, 60) || ')' end;
end $$;
create or replace function pg_temp.refus_anon(p_sql text) returns text language plpgsql as $$
declare v text;
begin v := pg_temp.essai_anon(p_sql);
  return case when left(v, 6) = 'refusé' then 'refusé' else 'ACCEPTE (' || left(v, 60) || ')' end;
end $$;

-- Pour une LECTURE, un refus de droit et zéro ligne disent la même chose : la personne ne voit rien.
create or replace function pg_temp.combien(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin v := pg_temp.essai(p_uid, p_sql);
  return case when left(v, 6) = 'refusé' or v = '∅' then '0' else v end;
end $$;
create or replace function pg_temp.combien_anon(p_sql text) returns text language plpgsql as $$
declare v text;
begin v := pg_temp.essai_anon(p_sql);
  return case when left(v, 6) = 'refusé' or v = '∅' then '0' else v end;
end $$;

-- ══ 1. QUI VOIT CE QU'IL Y A À PAYER ════════════════════════════════════════════════════════════
-- Ce que gagne chacun est la donnée la plus personnelle de l'OS. La Production commande les missions
-- et en fixe les montants un par un : elle n'a pas pour autant à lire la paie du mois de tout le
-- monde (décision du 10/09, v129).
select pg_temp.note('l''Admin lit ce qu''il y a à payer', '240',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    $q$select case when montant_du = 240 then '240' else montant_du::text end
         from recap_a_payer(date '2026-01-01')
        where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004'$q$));
select pg_temp.note('la comptabilité lit ce qu''il y a à payer (elle paie)', '240',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000002',
    $q$select case when montant_du = 240 then '240' else montant_du::text end
         from recap_a_payer(date '2026-01-01')
        where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004'$q$));
select pg_temp.note('un responsable de pôle ne lit pas la paie du mois', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000003',
    $q$select count(*)::text from recap_a_payer(date '2026-01-01')$q$));
select pg_temp.note('un photographe ne lit pas la paie du mois', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000005',
    $q$select count(*)::text from recap_a_payer(date '2026-01-01')$q$));
select pg_temp.note('le collaborateur lui-même n''ouvre pas la liste globale', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000004',
    $q$select count(*)::text from recap_a_payer(date '2026-01-01')$q$));
select pg_temp.note('un anonyme ne lit pas la paie du mois', 'refusé',
  pg_temp.refus_anon($q$select count(*)::text from recap_a_payer(date '2026-01-01')$q$));

-- ══ 2. CE QUE L'ÉCRAN DE TRAVAIL COMPTE, ET CE QU'IL LAISSE DEHORS ══════════════════════════════
-- 90 + 110 dans le mois, jamais les 500 du 31 décembre ni les 700 du 1er février.
select pg_temp.note('deux prestations comptées pour janvier, pas quatre', '2',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    $q$select nb_prestations::text from recap_a_payer(date '2026-01-01')
        where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004'$q$));
select pg_temp.note('montant des prestations du mois', '200',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    $q$select case when montant_prestations = 200 then '200' else montant_prestations::text end
         from recap_a_payer(date '2026-01-01')
        where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004'$q$));
select pg_temp.note('les primes du mois', '50',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    $q$select case when montant_primes = 50 then '50' else montant_primes::text end
         from recap_a_payer(date '2026-01-01')
        where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004'$q$));
-- Les ajustements sortent négatifs pour que le total se lise par une simple addition : personne ne
-- doit avoir à se demander dans quel sens compter une retenue.
select pg_temp.note('les ajustements sortent NÉGATIFS', '-30',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    $q$select case when montant_ajustements = -30 then '-30' else montant_ajustements::text end
         from recap_a_payer(date '2026-01-01')
        where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004'$q$));
select pg_temp.note('les frais et kilomètres du mois', '20',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    $q$select case when montant_frais = 20 then '20' else montant_frais::text end
         from recap_a_payer(date '2026-01-01')
        where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004'$q$));
select pg_temp.note('le total est la somme des quatre (200 + 50 - 30 + 20)', 'oui',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    $q$select case when montant_du = montant_prestations + montant_primes + montant_ajustements + montant_frais
                   then 'oui' else 'NON (' || montant_du::text || ')' end
         from recap_a_payer(date '2026-01-01')
        where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004'$q$));

-- ══ 3. LE MOIS VA DU PREMIER AU DERNIER JOUR, ET SE COMPTE À PARIS ══════════════════════════════
-- Le dernier jour est le 31, pas le 1er du mois suivant : c'est ce qu'un humain lit sur le document.
select pg_temp.note('bornes de janvier 2026 (premier / dernier jour)', '2026-01-01/2026-01-31',
  (select debut::text || '/' || fin::text from recap_bornes_du_mois(date '2026-01-15')));
-- Février, parce qu'un mois court est exactement là où un « +1 mois -1 jour » mal écrit se voit.
select pg_temp.note('bornes de février 2026 (mois court)', '2026-02-01/2026-02-28',
  (select debut::text || '/' || fin::text from recap_bornes_du_mois(date '2026-02-15')));
select pg_temp.note('le 1er à 01 h heure de Paris appartient au mois qui commence', 'oui',
  case when date_trunc('month', (timestamptz '2026-10-01 01:00+02' at time zone 'Europe/Paris'))::date = date '2026-10-01'
       then 'oui' else 'NON' end);
-- Le serveur est en UTC : un mois courant calculé en UTC serait faux deux heures par nuit, et ces
-- deux heures tombent précisément au moment où l'on clôture un mois (leçon du 14/09).
select pg_temp.note('recap_mois_courant() rend le mois de Paris', 'oui',
  case when recap_mois_courant() = date_trunc('month', (now() at time zone 'Europe/Paris'))::date
       then 'oui' else 'NON (' || recap_mois_courant()::text || ')' end);
-- LES TROIS FONCTIONS QUI CALCULENT UN JOUR, et elles seules : le mois courant, la date de virement
-- annoncée, la date de paiement. `recap_marquer_envoye` n'y figure pas volontairement, elle ne range
-- qu'un INSTANT (`envoye_le` en timestamptz), et un instant n'a pas de fuseau à choisir. Exiger
-- Europe/Paris là où il n'y a pas de date à tirer aurait rendu ce contrôle faux, pas plus strict.
select pg_temp.note('les trois fonctions qui calculent un jour passent par Europe/Paris', '3',
  (select count(distinct proname)::text from pg_proc
    where proname in ('recap_mois_courant','recap_envoyer','recap_virement_effectue')
      and prosrc like '%Europe/Paris%'));

-- ══ 4. QUI PRÉPARE ET ENVOIE ════════════════════════════════════════════════════════════════════
-- L'Admin seul. Même la comptabilité, qui voit tout et qui paie, n'envoie pas : envoyer, c'est
-- décider du montant et l'annoncer à quelqu'un.
select pg_temp.note('la comptabilité ne prépare pas un récapitulatif', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000002',
    $q$select recap_envoyer('c7c7c7c7-0000-0000-0000-000000000004', 230, date '2026-01-01')::text$q$));
select pg_temp.note('un responsable de pôle ne prépare pas un récapitulatif', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000003',
    $q$select recap_envoyer('c7c7c7c7-0000-0000-0000-000000000004', 230, date '2026-01-01')::text$q$));
select pg_temp.note('le collaborateur ne s''envoie pas son propre récapitulatif', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000004',
    $q$select recap_envoyer('c7c7c7c7-0000-0000-0000-000000000004', 230, date '2026-01-01')::text$q$));
select pg_temp.note('un anonyme n''envoie rien', 'refusé',
  pg_temp.refus_anon(
    $q$select recap_envoyer('c7c7c7c7-0000-0000-0000-000000000004', 230, date '2026-01-01')::text$q$));
-- Aucun de ces quatre refus n'a écrit. Sans ce contrôle, un refus qui laisserait une ligne derrière
-- lui passerait inaperçu, et la vraie préparation buterait plus tard sur l'index d'unicité.
select pg_temp.note('aucun récapitulatif n''a été créé par les quatre refus', '0',
  (select count(*)::text from recapitulatifs_remuneration
    where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004'));

-- ══ 5. LA PRÉPARATION : UN BROUILLON, ET RIEN D'AFFIRMÉ ═════════════════════════════════════════
-- Fouka décide de verser 230 alors que le dû est 240 : les deux montants vivent séparément, parce
-- que cacher l'écart serait malhonnête des deux côtés.
create temp table envoi on commit drop as
  select pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    $q$select recap_envoyer('c7c7c7c7-0000-0000-0000-000000000004', 230, date '2026-01-01',
                            'Merci pour ce mois', 4)::text$q$) as id;
create or replace function pg_temp.recap() returns text language sql as $$ select id from envoi $$;

select pg_temp.note('l''Admin prépare, et un identifiant revient', 'oui',
  case when pg_temp.recap() ~ '^[0-9a-f]{8}-' then 'oui' else pg_temp.recap() end);
-- LA LEÇON DE v361 : tant que l'e-mail n'est pas parti, le document est un BROUILLON. Écrire
-- « envoyé » avant que le fournisseur ait accepté le message, c'est annoncer un virement à
-- quelqu'un qui n'a rien reçu, et personne ne peut s'en apercevoir avant la réclamation.
select pg_temp.note('le document est un brouillon, pas un envoi', 'brouillon',
  coalesce((select statut from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
select pg_temp.note('aucune date d''envoi sur un brouillon', 'oui',
  coalesce((select case when envoye_le is null then 'oui' else 'NON (' || envoye_le::text || ')' end
              from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
select pg_temp.note('rien n''est encore transmis à la comptabilité', 'en_attente',
  (select string_agg(distinct statut_paiement, '+' order by statut_paiement) from prestations_equipe
    where id in (select affectation_id from aff where reference in ('ZZ-RECAP-M-01','ZZ-RECAP-M-02'))));
select pg_temp.note('le document part à l''adresse du collaborateur', 'zz-recap-collab@example.invalid',
  coalesce((select destinataire_email from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
-- On écrit la date annoncée, pas le délai : « d'ici 3 à 5 jours » ne se relit pas une semaine plus tard.
select pg_temp.note('le document annonce un virement daté, à venir', 'oui',
  coalesce((select case when virement_annonce_le > (now() at time zone 'Europe/Paris')::date then 'oui'
                        else 'NON (' || coalesce(virement_annonce_le::text,'∅') || ')' end
              from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
-- ET C'EST UN JOUR OUVRÉ (v362). Trouvé en LISANT le document : « viré au plus tard le dimanche
-- 4 octobre », alors que les banques ne traitent pas le week-end. `date + 5 jours` est un calcul
-- correct qui promet l'impossible deux fois sur sept.
select pg_temp.note('la date annoncée tombe un jour ouvré', 'oui',
  coalesce((select case when extract(dow from virement_annonce_le) not in (0, 6) then 'oui'
                        else 'NON (' || to_char(virement_annonce_le, 'Dy DD/MM') || ')' end
              from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
select pg_temp.note('le dû (240) et le versé (230) coexistent sans se recouvrir', '240/230',
  coalesce((select montant_du::numeric(10,0)::text || '/' || montant_verse::numeric(10,0)::text
              from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
select pg_temp.note('deux prestations figées sur le document, pas quatre', '2',
  coalesce((select nb_prestations::text from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
select pg_temp.note('les quatre montants figés (prestations/primes/ajustements/frais)', '200/50/-30/20',
  coalesce((select montant_prestations::numeric(10,0)::text || '/' || montant_primes::numeric(10,0)::text || '/'
                || montant_ajustements::numeric(10,0)::text || '/' || montant_frais::numeric(10,0)::text
              from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
select pg_temp.note('le total figé est la somme des quatre natures', 'oui',
  coalesce((select case when montant_du = montant_prestations + montant_primes + montant_ajustements + montant_frais
                        then 'oui' else format('NON (%s vs %s+%s+%s+%s)', montant_du, montant_prestations,
                                               montant_primes, montant_ajustements, montant_frais) end
              from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
-- 2 prestations + 1 ligne de frais + 1 prime + 1 ajustement.
select pg_temp.note('cinq lignes copiées sur le document', '5',
  (select count(*)::text from recapitulatifs_remuneration_lignes where recapitulatif_id::text = pg_temp.recap()));
select pg_temp.note('la ligne d''ajustement est portée en négatif', 'oui',
  coalesce((select case when montant < 0 then 'oui' else 'NON (' || montant::text || ')' end
              from recapitulatifs_remuneration_lignes
             where recapitulatif_id::text = pg_temp.recap() and nature = 'ajustement'), '∅'));
select pg_temp.note('aucune ligne hors du mois (première / dernière date)', '2026-01-12/2026-01-23',
  coalesce((select min(date_prestation)::text || '/' || max(date_prestation)::text
              from recapitulatifs_remuneration_lignes where recapitulatif_id::text = pg_temp.recap()), '∅'));
-- LE PIÈGE. Une prestation datée du 1er du mois SUIVANT ne doit pas entrer dans le mois courant.
select pg_temp.note('la prestation du 1er du mois suivant n''est pas sur le document', '0',
  (select count(*)::text from recapitulatifs_remuneration_lignes
    where recapitulatif_id::text = pg_temp.recap()
      and affectation_id = (select affectation_id from aff where reference = 'ZZ-RECAP-APRES')));
select pg_temp.note('la prestation du dernier jour du mois précédent non plus', '0',
  (select count(*)::text from recapitulatifs_remuneration_lignes
    where recapitulatif_id::text = pg_temp.recap()
      and affectation_id = (select affectation_id from aff where reference = 'ZZ-RECAP-AVANT')));
-- Le libellé doit permettre à une vraie personne de reconnaître SA journée : le type seul
-- (« match ») ne suffit pas, le lieu est ce dont on se souvient.
select pg_temp.note('le libellé nomme le lieu, pas seulement le type', 'oui',
  coalesce((select case when count(*) = 2 then 'oui' else 'NON (' || count(*)::text || '/2)' end
              from recapitulatifs_remuneration_lignes
             where recapitulatif_id::text = pg_temp.recap() and nature = 'prestation'
               and libelle like 'Match%STADE ZZ DU TEST'), '∅'));
-- Un montant en cours d'arbitrage n'est pas une annonce : même son destinataire ne le lit pas.
select pg_temp.note('le collaborateur ne lit pas encore son brouillon', '0',
  pg_temp.combien('c7c7c7c7-0000-0000-0000-000000000004',
    'select count(*)::text from recapitulatifs_remuneration where id = ' || quote_literal(pg_temp.recap())));

-- ══ 6. REJOUER LA PRÉPARATION NE CRÉE PAS DE DOUBLON ════════════════════════════════════════════
-- C'est le cas d'un e-mail qui n'est pas parti : on recommence. Le même brouillon doit être repris,
-- avec son identifiant, sinon deux documents partent pour un seul mois.
select pg_temp.note('rejouer la préparation rend le MÊME identifiant', 'oui',
  case when pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
         $q$select recap_envoyer('c7c7c7c7-0000-0000-0000-000000000004', 230, date '2026-01-01',
                                 'Merci pour ce mois', 4)::text$q$) = pg_temp.recap()
       then 'oui' else 'NON' end);
select pg_temp.note('un seul récapitulatif pour ce couple après le second essai', '1',
  (select count(*)::text from recapitulatifs_remuneration
    where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004' and mois = date '2026-01-01'));
select pg_temp.note('et toujours cinq lignes, pas dix', '5',
  (select count(*)::text from recapitulatifs_remuneration_lignes where recapitulatif_id::text = pg_temp.recap()));

-- ══ 7. LE DOCUMENT N'EST « ENVOYÉ » QUE QUAND IL EST PARTI ══════════════════════════════════════
-- La bascule appartient au moteur d'envoi (clé de service) ou à l'Admin qui confirme à la main.
-- Personne d'autre : c'est elle qui transforme un brouillon en annonce de paiement.
select pg_temp.note('un responsable de pôle ne déclare pas un envoi', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000003',
    'select recap_marquer_envoye(' || quote_literal(pg_temp.recap()) || ')::text'));
select pg_temp.note('le collaborateur ne déclare pas son propre envoi', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000004',
    'select recap_marquer_envoye(' || quote_literal(pg_temp.recap()) || ')::text'));
select pg_temp.note('un anonyme ne déclare aucun envoi', 'refusé',
  pg_temp.refus_anon('select recap_marquer_envoye(' || quote_literal(pg_temp.recap()) || ')::text'));
select pg_temp.note('l''Admin confirme que le document est parti', 'true',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    'select recap_marquer_envoye(' || quote_literal(pg_temp.recap()) || ', ''zz-reference-envoi'')::text'));
select pg_temp.note('le document est alors envoyé, et daté', 'envoye/date',
  coalesce((select statut || '/' || case when envoye_le is not null then 'date' else 'SANS DATE' end
              from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
-- Idempotent : un e-mail accepté deux fois ne redate pas l'envoi et ne rejoue pas la bascule.
select pg_temp.note('une seconde confirmation ne redate rien', 'false',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    'select recap_marquer_envoye(' || quote_literal(pg_temp.recap()) || ')::text'));
-- L'écran de travail doit maintenant dire que c'est parti, sinon Fouka renvoie sans le savoir.
select pg_temp.note('l''écran de travail signale que c''est déjà envoyé', 'oui',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    $q$select case when deja_envoye then 'oui' else 'NON' end from recap_a_payer(date '2026-01-01')
        where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004'$q$));

-- ══ 8. UN SEUL ENVOI PAR PERSONNE ET PAR MOIS ═══════════════════════════════════════════════════
-- Deux récapitulatifs, c'est deux paiements annoncés à la même personne. Et le message doit dire
-- quoi faire, au lieu de laisser un index unique répondre par un 23505 que personne ne sait lire.
select pg_temp.note('une fois parti, un nouvel envoi est refusé', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000001',
    $q$select recap_envoyer('c7c7c7c7-0000-0000-0000-000000000004', 230, date '2026-01-01')::text$q$));
select pg_temp.note('le refus explique qu''un récapitulatif est déjà parti', 'oui',
  case when pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
         $q$select recap_envoyer('c7c7c7c7-0000-0000-0000-000000000004', 230, date '2026-01-01')::text$q$)
         ilike '%déjà%' then 'oui' else 'NON' end);
select pg_temp.note('il n''existe qu''un récapitulatif envoyé pour ce couple', '1',
  (select count(*)::text from recapitulatifs_remuneration
    where collaborateur_id = 'c7c7c7c7-0000-0000-0000-000000000004'
      and mois = date '2026-01-01' and statut = 'envoye'));

-- ══ 9. LES MONTANTS SONT DES INSTANTANÉS ════════════════════════════════════════════════════════
-- LE COEUR DU MODÈLE. On porte la rémunération de la première mission de 90 à 130 APRÈS l'envoi. Si
-- le document se recalculait, une correction de grille faite en octobre changerait après coup ce
-- qu'on a écrit en janvier, et personne ne saurait plus ce que le collaborateur a reçu.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update prestations_equipe set remuneration = 130
 where id = (select affectation_id from aff where reference = 'ZZ-RECAP-M-01');

-- Sans ce premier contrôle, les trois suivants seraient verts même si la modification n'avait pas eu
-- lieu : on mesurerait alors l'absence de changement de rien du tout.
select pg_temp.note('la ligne d''origine a bien changé', '130',
  (select remuneration::numeric(10,0)::text from prestations_equipe
    where id = (select affectation_id from aff where reference = 'ZZ-RECAP-M-01')));
select pg_temp.note('le total du document n''a pas bougé', '200',
  coalesce((select montant_prestations::numeric(10,0)::text from recapitulatifs_remuneration
             where id::text = pg_temp.recap()), '∅'));
select pg_temp.note('la ligne copiée vaut toujours 90', '90',
  coalesce((select montant::numeric(10,0)::text from recapitulatifs_remuneration_lignes
             where recapitulatif_id::text = pg_temp.recap()
               and affectation_id = (select affectation_id from aff where reference = 'ZZ-RECAP-M-01')
               and nature = 'prestation'), '∅'));
select pg_temp.note('le dû annoncé n''a pas bougé', '240',
  coalesce((select montant_du::numeric(10,0)::text from recapitulatifs_remuneration
             where id::text = pg_temp.recap()), '∅'));

-- ══ 10. L'ENVOI NE MARQUE PAS « PAYÉ » ══════════════════════════════════════════════════════════
-- Le virement part 3 à 5 jours plus tard. Écrire « payé » à l'envoi serait afficher un succès qui
-- n'a pas eu lieu (règle du 10/09), et sur de l'argent dû à quelqu'un c'est le pire endroit pour le
-- faire : à la question « est-ce que je l'ai payé, ou est-ce que je le lui ai seulement dit ? »,
-- personne ne pourrait plus répondre.
select pg_temp.note('après l''envoi, les affectations sont transmises, pas payées', 'transmis_compta',
  (select string_agg(distinct statut_paiement, '+' order by statut_paiement) from prestations_equipe
    where id in (select affectation_id from aff where reference in ('ZZ-RECAP-M-01','ZZ-RECAP-M-02'))));
select pg_temp.note('aucune date de paiement à l''envoi', '0',
  (select count(*)::text from prestations_equipe
    where id in (select affectation_id from aff where reference in ('ZZ-RECAP-M-01','ZZ-RECAP-M-02'))
      and date_paiement is not null));
select pg_temp.note('les affectations hors du mois n''ont pas été touchées', 'en_attente',
  (select string_agg(distinct statut_paiement, '+' order by statut_paiement) from prestations_equipe
    where id in (select affectation_id from aff where reference in ('ZZ-RECAP-AVANT','ZZ-RECAP-APRES'))));
-- LE VIREMENT EST TRACÉ, PAS DÉDUIT (v363). Tant qu'il n'a pas eu lieu, la date est vide : déduire
-- « c'est payé » de l'état des lignes ferait disparaître le geste dès qu'un autre écran passe une
-- ligne à `payé`, et on croirait avoir viré sans avoir viré.
select pg_temp.note('aucune date de virement avant le virement', 'oui',
  coalesce((select case when vire_le is null then 'oui' else 'NON (' || vire_le::text || ')' end
              from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
-- ON NE PAIE PAS CE QU'ON N'A PAS ANNONCÉ : un virement sur un brouillon donne au collaborateur de
-- l'argent qu'il ne sait rattacher à aucun mois.
select pg_temp.note('l''Admin ne vire pas sur un récapitulatif non envoyé', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000001',
    $q$select recap_virement_effectue('c7c7c7c7-0000-0000-0000-0000000000b1')::text$q$));
select pg_temp.note('un responsable de pôle ne déclare pas le virement', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000003',
    'select recap_virement_effectue(' || quote_literal(pg_temp.recap()) || ')::text'));
select pg_temp.note('le collaborateur ne déclare pas son propre virement', 'refusé',
  pg_temp.refus('c7c7c7c7-0000-0000-0000-000000000004',
    'select recap_virement_effectue(' || quote_literal(pg_temp.recap()) || ')::text'));
select pg_temp.note('un anonyme ne déclare aucun virement', 'refusé',
  pg_temp.refus_anon('select recap_virement_effectue(' || quote_literal(pg_temp.recap()) || ')::text'));
select pg_temp.note('l''Admin déclare le virement : deux lignes réglées', '2',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000001',
    'select recap_virement_effectue(' || quote_literal(pg_temp.recap()) || ')::text'));
select pg_temp.note('et alors seulement les affectations sont payées', 'payé',
  (select string_agg(distinct statut_paiement, '+' order by statut_paiement) from prestations_equipe
    where id in (select affectation_id from aff where reference in ('ZZ-RECAP-M-01','ZZ-RECAP-M-02'))));
select pg_temp.note('avec la date du jour, comptée à Paris', '2',
  (select count(*)::text from prestations_equipe
    where id in (select affectation_id from aff where reference in ('ZZ-RECAP-M-01','ZZ-RECAP-M-02'))
      and date_paiement::date = (now() at time zone 'Europe/Paris')::date));
select pg_temp.note('le virement est maintenant daté, et signé de qui l''a fait', 'oui',
  coalesce((select case when vire_le is not null
                         and vire_par = 'c7c7c7c7-0000-0000-0000-000000000001'::uuid then 'oui'
                        else 'NON (' || coalesce(vire_le::text,'sans date') || '/'
                             || coalesce(vire_par::text,'sans auteur') || ')' end
              from recapitulatifs_remuneration where id::text = pg_temp.recap()), '∅'));
-- La comptabilité aussi : régler est son métier. Elle rend 0 parce que le virement est déjà daté
-- (idempotence), et zéro n'est PAS un refus : c'est tout ce que ce contrôle distingue.
select pg_temp.note('la comptabilité est autorisée aussi (virement déjà daté)', '0',
  pg_temp.essai('c7c7c7c7-0000-0000-0000-000000000002',
    'select recap_virement_effectue(' || quote_literal(pg_temp.recap()) || ')::text'));

-- ══ 11. LE COLLABORATEUR LIT SON DOCUMENT, ET RIEN D'AUTRE ══════════════════════════════════════
-- C'est son document : il doit pouvoir le relire sans redemander. Mais seulement le sien, et
-- seulement une fois envoyé.
select pg_temp.note('le collaborateur lit son récapitulatif envoyé', '1',
  pg_temp.combien('c7c7c7c7-0000-0000-0000-000000000004',
    'select count(*)::text from recapitulatifs_remuneration where id = ' || quote_literal(pg_temp.recap())));
select pg_temp.note('et le détail de ses cinq lignes', '5',
  pg_temp.combien('c7c7c7c7-0000-0000-0000-000000000004',
    'select count(*)::text from recapitulatifs_remuneration_lignes where recapitulatif_id = ' || quote_literal(pg_temp.recap())));
select pg_temp.note('un autre opérateur ne lit pas le récapitulatif du collaborateur', '0',
  pg_temp.combien('c7c7c7c7-0000-0000-0000-000000000005',
    'select count(*)::text from recapitulatifs_remuneration where id = ' || quote_literal(pg_temp.recap())));
select pg_temp.note('ni ses lignes de détail', '0',
  pg_temp.combien('c7c7c7c7-0000-0000-0000-000000000005',
    'select count(*)::text from recapitulatifs_remuneration_lignes where recapitulatif_id = ' || quote_literal(pg_temp.recap())));
select pg_temp.note('le destinataire d''un brouillon ne le lit pas', '0',
  pg_temp.combien('c7c7c7c7-0000-0000-0000-000000000005',
    $q$select count(*)::text from recapitulatifs_remuneration where id = 'c7c7c7c7-0000-0000-0000-0000000000b1'$q$));
select pg_temp.note('la comptabilité lit le récapitulatif envoyé', '1',
  pg_temp.combien('c7c7c7c7-0000-0000-0000-000000000002',
    'select count(*)::text from recapitulatifs_remuneration where id = ' || quote_literal(pg_temp.recap())));
select pg_temp.note('l''Admin lit le récapitulatif envoyé', '1',
  pg_temp.combien('c7c7c7c7-0000-0000-0000-000000000001',
    'select count(*)::text from recapitulatifs_remuneration where id = ' || quote_literal(pg_temp.recap())));
select pg_temp.note('un anonyme ne lit aucun récapitulatif', '0',
  pg_temp.combien_anon('select count(*)::text from recapitulatifs_remuneration where id = ' || quote_literal(pg_temp.recap())));
select pg_temp.note('un anonyme ne lit aucune ligne de détail', '0',
  pg_temp.combien_anon('select count(*)::text from recapitulatifs_remuneration_lignes where recapitulatif_id = ' || quote_literal(pg_temp.recap())));

-- ══ 12. LES TROIS GESTES SONT JOURNALISÉS ═══════════════════════════════════════════════════════
-- Un mouvement d'argent annoncé à un tiers qui ne laisse pas de trace ne se défend pas. Les trois
-- actions sont comptées en DISTINCT et triées par nom : elles partagent le même `created_at` dans
-- une transaction, un tri chronologique serait instable et le test clignoterait.
select pg_temp.note('préparation, envoi et virement sont journalisés',
  'recapitulatif_envoye,recapitulatif_prepare,virement_effectue',
  coalesce((select string_agg(distinct action, ',' order by action) from financial_audit_log
             where ligne_id::text = pg_temp.recap()), '∅'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu
  from verdicts order by n;
rollback;
