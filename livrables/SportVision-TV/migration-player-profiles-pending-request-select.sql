-- pp_educateur_select (migration-clubplus-v13.sql) n'autorise un éducateur à lire une fiche
-- player_profiles que si le joueur est DÉJÀ dans team_memberships pour son équipe — or une
-- demande d'adhésion (membership_requests) porte justement sur un joueur PAS ENCORE affilié.
-- Trouvé en vérifiant en réel le dashboard "À traiter" (04/09/2026, chantier Action Center) :
-- un coach voit sa demande en attente ("U13 B à confirmer") mais jamais le nom du joueur
-- concerné — même lacune sur /team-requests, jamais remarquée faute de test en conditions
-- réelles avec un coach non-admin. Policy additive (permissive, OR logique avec les policies
-- existantes) : un éducateur voit aussi les fiches des joueurs ayant une demande encore ouverte
-- pour l'une de ses équipes, jamais les demandes déjà validées/refusées (pas de fuite au-delà du
-- besoin réel de confirmer une identité).

drop policy if exists "pp_educateur_pending_request_select" on player_profiles;
create policy "pp_educateur_pending_request_select" on player_profiles for select using (
  exists (
    select 1 from membership_requests mr
    where mr.player_id = player_profiles.id
      and mr.statut not in ('validee', 'refusee')
      and is_team_educateur(mr.team_id)
  )
);
