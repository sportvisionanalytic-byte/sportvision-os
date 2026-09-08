-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 1c — Un CM lit SES clubs, et rien de plus
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Constat du test de fuite : apres le cloisonnement, un CM ne voyait plus rien du tout — pas meme
-- le club qui lui est affecte. C'est logique : aucune policy ne lui accordait la lecture de
-- `clubs`, et une policy restrictive ne fait que retirer, jamais accorder.
--
-- On accorde donc la LECTURE, et uniquement elle. Ecrire — creer une equipe, inviter un coach,
-- importer des joueurs — viendra avec la phase 3, quand l'ecran qui l'accompagne existera. Donner
-- l'ecriture avant l'ecran, c'est ouvrir un droit que personne ne peut encore exercer ni verifier.
--
-- Chaque policy passe par cm_clubs_autorises(). Les policies restrictives de la v2 restent
-- au-dessus : meme si l'une de celles-ci etait un jour trop large, le perimetre tiendrait.

begin;

drop policy if exists clubs_cm_affecte_select on clubs;
create policy clubs_cm_affecte_select on clubs for select
  using (est_cm_cloisonne() and id in (select cm_clubs_autorises()));

drop policy if exists org_cm_affecte_select on organizations;
create policy org_cm_affecte_select on organizations for select
  using (est_cm_cloisonne() and id in (select cm_clubs_autorises()));

drop policy if exists cop_cm_affecte_select on club_onboarding_progress;
create policy cop_cm_affecte_select on club_onboarding_progress for select
  using (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()));

drop policy if exists cmb_cm_affecte_select on club_members;
create policy cmb_cm_affecte_select on club_members for select
  using (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()));

drop policy if exists tic_cm_affecte_select on team_invite_codes;
create policy tic_cm_affecte_select on team_invite_codes for select
  using (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()));

drop policy if exists pinv_cm_affecte_select on player_invitations;
create policy pinv_cm_affecte_select on player_invitations for select
  using (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()));

drop policy if exists parinv_cm_affecte_select on parent_invitations;
create policy parinv_cm_affecte_select on parent_invitations for select
  using (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()));

commit;
