-- ============================================================
-- Migration v27 : corrige une fuite RLS confirmée sur la table `frais`.
--
-- ── Constat (audit pré-lancement Partie B, 11/08, vérifié EMPIRIQUEMENT
--    en conditions réelles, pas une lecture de code seule) ──
--
-- migration-frais.sql définit la policy actuelle :
--   create policy "frais_select" on frais for select using (
--     exists (select 1 from profiles where id = auth.uid())
--   );
-- Le commentaire au-dessus dit "prod voit tout, photo voit les siens" —
-- c'est FAUX : la condition ne filtre que "l'utilisateur a un profil",
-- pas "collaborateur_id = auth.uid() OU rôle privilégié". N'importe quel
-- collaborateur connecté (photo, cm, com...) peut lire TOUS les frais de
-- TOUS les collaborateurs.
--
-- Preuve (test réel, données jetables, nettoyées après coup) : création
-- d'un compte de test role='photo', d'un frais appartenant à un AUTRE
-- collaborateur (un vrai photographe de la base), puis lecture de
--   GET /rest/v1/frais?select=id,collaborateur_id,montant,description
-- avec le JWT du compte de test (pas service_role) : la ligne complète du
-- collègue (montant, description) a été retournée sans restriction.
--
-- Le trou est purement côté base — le frontend (SportVision-OS-Full.html)
-- masque déjà l'onglet "Frais & km" pour les rôles non prévus, mais ça ne
-- protège pas un appel API direct avec le token d'un collaborateur normal.
--
-- ── Ce que fait cette migration ──
-- Remplace uniquement frais_select (insert/update/delete déjà corrects,
-- non touchés) : un collaborateur ne voit que SES propres frais
-- (collaborateur_id = auth.uid()) ; admin/prod/compta voient tout, cohérent
-- avec frais_update qui leur donne déjà le droit de valider/rembourser
-- n'importe quel frais (il faut bien pouvoir les lire pour les traiter).
--
-- Idempotente (drop policy if exists + create). À exécuter dans Supabase →
-- SQL Editor. Indépendante des autres migrations en attente (v28/v29
-- réservées à d'autres agents ce soir) — peut s'exécuter dans n'importe
-- quel ordre par rapport à elles, aucune dépendance croisée.
-- ============================================================

drop policy if exists "frais_select" on frais;
create policy "frais_select" on frais for select using (
  collaborateur_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod','compta'))
);
