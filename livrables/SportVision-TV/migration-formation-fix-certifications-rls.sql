-- ============================================================
-- Fix : collaborateur_certifications n'avait aucune policy INSERT
-- pour un collaborateur normal — la création automatique de
-- certification à la fin d'une formation certifiante
-- (toggleFormLesson() dans SportVision-OS-Full.html) échouait
-- systématiquement et silencieusement (.catch(()=>{})) depuis la
-- création de la table (migration-formation-v2.sql).
--
-- migration-formation-v2.sql n'a créé que deux policies :
--   - cc_own_read    : select sur ses propres lignes (ou admin/prod)
--   - cc_admin_manage: for all, réservée à admin/prod
-- Aucune n'autorise un collaborateur à insérer sa propre
-- certification obtenue en self-service. Découvert le 08/08/2026 :
-- sur toute la base, seules 2 certifications existaient, créées
-- manuellement par Claude (service_role) — aucune n'avait jamais été
-- créée par le flux applicatif normal. 13 certifications de Mikael
-- Athanase Ruffine (formations terminées les 03-04/08) ont été
-- backfillées manuellement avant ce fix.
--
-- Correctif : autoriser l'insertion en self-service, mais seulement
-- pour sa propre fiche (collaborateur_id = auth.uid()) et à condition
-- qu'une inscription à la formation correspondante existe, appartient
-- au même collaborateur et soit réellement 'terminee' — pour éviter
-- qu'un collaborateur s'auto-délivre une certification sans avoir
-- terminé la formation associée. Risque résiduel identique à celui
-- déjà documenté pour xp_gagnes/xp_events (voir
-- migration-formation-fix-trigger-xp-gagnes.sql et
-- migration-connect-v1-securite-hardening.sql item 5) : le contenu
-- exact de la certification (nom, badge, validité) reste fourni par
-- le client JS, pas calculé côté serveur.
-- ============================================================

drop policy if exists "cc_own_insert" on collaborateur_certifications;
create policy "cc_own_insert" on collaborateur_certifications for insert with check (
  collaborateur_id = auth.uid()
  and exists (
    select 1 from formation_inscriptions fi
    where fi.id = inscription_id
      and fi.collaborateur_id = auth.uid()
      and fi.formation_id = collaborateur_certifications.formation_id
      and fi.statut = 'terminee'
  )
);
