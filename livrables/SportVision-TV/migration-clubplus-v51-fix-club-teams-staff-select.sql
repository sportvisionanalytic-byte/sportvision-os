-- migration-clubplus-v51-fix-club-teams-staff-select.sql
-- Bug trouvé en QA le 02/09/2026 (vérification de l'écran OS "Médias & Ventes") : club_teams
-- n'avait AUCUNE policy RLS SELECT pour le staff SportVision (ctm_admin_delete, ctm_family_*,
-- ctm_member_*) — un admin/staff n'est presque jamais club_members d'un club client, donc tout
-- écran OS listant les équipes d'un club (le nouveau sélecteur de portée du moteur média, mais
-- potentiellement d'autres déjà en prod) reçoit silencieusement un tableau vide (RLS filtre sans
-- erreur HTTP, .catch(()=>[]) ne se déclenche jamais). Ajoute la policy manquante, même patron que
-- les autres tables staff-lisibles de ce projet.

create policy "ctm_staff_select" on public.club_teams for select using (is_staff());
