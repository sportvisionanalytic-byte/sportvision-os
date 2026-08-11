-- ============================================================
-- SPORTVISION CONNECT — v33 : rétablit la policy RLS "prestations_client_insert"
-- manquante en production, bloquant TOUT le module Prestations pour l'Espace Projet.
--
-- ─── Découverte (11/08/2026, câblage du tunnel NewServiceTunnel.tsx) ──────────
-- migration-portail-v2.sql §2 documente une policy "prestations_client_insert"
-- censée déjà autoriser un client_user connecté à créer sa propre prestation.
-- Le code de l'app (app-next/src/lib/data/projet/services.ts, vanilla
-- app/modules/projet-configurateur.js) s'appuie dessus depuis un moment et la
-- documente comme acquise. En câblant réellement NewServiceTunnel.tsx ce soir
-- (jusqu'ici il ne faisait AUCUN appel serveur — voir le commit correspondant),
-- un test de bout en bout RÉEL (organisation Projet jetable + compte auth réel +
-- INSERT via le JWT du client, PAS service_role) a échoué systématiquement :
--
--   new row violates row-level security policy for table "prestations" (42501)
--
-- ...y compris avec un payload strictement minimal (statut + client_id, tous les
-- autres champs à leurs valeurs par défaut du schéma, donc a priori conformes à
-- la condition documentée). Le trigger de sync organizations/memberships
-- fonctionne bien (confirmé par le même test), la self-lecture client_users
-- fonctionne bien (cu_self_select), et la vue client_prestations comme la RPC
-- client_cancel_prestation existent bel et bien côté PostgREST (confirmé via
-- l'OpenAPI du projet) — seule cette policy INSERT semble absente en prod, alors
-- que les autres statements du même fichier migration-portail-v2.sql (colonnes
-- offre_id/options_selectionnees, vue, RPC) ont manifestement été appliqués.
-- Hypothèse la plus probable : exécution partielle/manuelle de ce fichier dans
-- le SQL Editor à l'époque (le README du dossier supabase/functions documente
-- déjà ce même type de désynchronisation code↔prod pour au moins 5 fonctions
-- Edge — même symptôme ici, côté SQL).
--
-- Conséquence concrète avant ce correctif : AUCUN client Espace Projet ne peut
-- soumettre de demande de prestation depuis Connect, quel que soit le code
-- front (déjà correct après ce soir) — la seule chose qui manque est cette
-- policy côté base.
--
-- Reprend à l'identique la condition déjà spécifiée et déjà revue dans
-- migration-portail-v2.sql §2 (aucune nouvelle décision produit ici, seulement
-- un rattrapage) : la demande arrive toujours à l'état initial 'demande_reçue',
-- tous les champs financiers/internes forcés à leur valeur neutre — c'est le
-- staff qui les renseigne ensuite dans l'OS.
--
-- Idempotente (DROP POLICY IF EXISTS avant CREATE). À exécuter dans Supabase →
-- SQL Editor. Aucune autre modification de schéma nécessaire : les colonnes, la
-- vue client_prestations et la RPC client_cancel_prestation existent déjà.
-- ============================================================

drop policy if exists "prestations_client_insert" on prestations;
create policy "prestations_client_insert" on prestations for insert with check (
  statut = 'demande_reçue'
  and exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = prestations.client_id)
  and montant_ht is null
  and montant_ttc is null
  and acompte_montant is null
  and acompte_recu = false
  and acompte_date is null
  and statut_financier = 'non_facturée'
  and contrat_signe = false
  and responsable_prod_id is null
  and responsable_prestation_id is null
  and notes_internes is null
);

-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- select policyname, cmd, permissive, qual, with_check
-- from pg_policies
-- where tablename = 'prestations' and policyname = 'prestations_client_insert';
--
-- Doit retourner exactement une ligne. Un test de bout en bout complet (org
-- Projet jetable + compte auth réel + INSERT via JWT client + vérification
-- notification staff + nettoyage) a déjà été exécuté ce soir avec succès contre
-- le reste de la chaîne (triggers de synchronisation, vue, notification) — seule
-- cette policy restait à rétablir pour que l'INSERT réel passe.
-- ============================================================
