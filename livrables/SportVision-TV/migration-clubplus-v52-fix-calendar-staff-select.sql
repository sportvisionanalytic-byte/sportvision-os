-- migration-clubplus-v52-fix-calendar-staff-select.sql
-- Bug trouvé en QA le 02/09/2026 (vérification du sélecteur d'événement dans le modal "Opération
-- commerciale" de l'écran OS "Médias & Ventes") : club_calendar_events n'avait AUCUNE policy RLS
-- SELECT pour le staff SportVision (ccal_family_select/ccal_member_select/ccal_player_select sont
-- toutes scopées club_member/famille/joueur, jamais is_staff()) — même classe de bug que
-- club_teams, corrigée en v51. Un admin OS ouvrant le sélecteur "Événement lié" recevait
-- silencieusement un tableau vide (RLS filtre sans erreur HTTP), le dropdown restant bloqué sur
-- "Aucun" pour tout club.

create policy "ccal_staff_select" on public.club_calendar_events for select using (is_staff());
