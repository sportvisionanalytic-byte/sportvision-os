-- Migration : accès staff (lecture) sur membership_requests et club_support_tickets
-- À exécuter dans Supabase → SQL Editor.
-- EXÉCUTÉE — appliquée en base réelle le 29/08/2026 (refonte interface Secrétaire,
-- extension du point d'entrée unifié "Demandes").
--
-- Constat (vérifié en lisant les policies réelles, pas supposé) : ces deux
-- tables n'ont AUCUNE policy pour le staff SportVision (admin/sec/...) —
-- uniquement des policies scopées club/joueur/parent/éducateur côté Connect
-- (migration-clubplus-v14.sql pour membership_requests, migration-clubplus-
-- v11.sql pour club_support_tickets). Résultat : ces deux flux entrants
-- (demande de rejoindre une équipe, ticket support club) sont invisibles
-- pour TOUT LE MONDE côté OS, staff compris — pas seulement secrétaire.
-- Aucune UI ne les affichait avant ce soir (grep exhaustif sur
-- SportVision-OS-Full.html : zéro occurrence des deux noms de table).
--
-- Même pattern déjà appliqué à club_requests par migration-clubplus-v93-
-- secretariat-read-club-requests.sql : ajoute une policy SELECT is_staff(),
-- sans toucher aux policies existantes (Connect continue de fonctionner
-- identiquement pour les rôles club/joueur/parent/éducateur).
--
-- Volontairement LECTURE SEULE pour le staff ici : le workflow de
-- validation (membership_requests a un mécanisme éducateur→admin à double
-- validation déjà en place côté Connect ; club_support_tickets n'a pas de
-- colonne de réponse, juste un statut) n'est pas réinventé sans spec précise
-- — l'objectif de cette migration est de sortir ces deux flux de
-- l'invisibilité, pas d'inventer un nouveau processus de traitement.
--
-- Idempotente (drop policy if exists avant chaque create).

drop policy if exists "mr_staff_select" on membership_requests;
create policy "mr_staff_select" on membership_requests for select
  using (is_staff());

drop policy if exists "cst_staff_select" on club_support_tickets;
create policy "cst_staff_select" on club_support_tickets for select
  using (is_staff());

-- Vérification (à exécuter manuellement après migration) :
-- select count(*) from membership_requests; -- avec un JWT staff, doit renvoyer un nombre, pas une erreur RLS
-- select count(*) from club_support_tickets; -- idem
