-- ============================================================================
-- migration-club-matches-cm-select.sql (03/09/2026)
-- ============================================================================
-- Trouvé en testant en réel le panneau "Matchs à venir" du Communication Hub
-- (migration-contenus-match-event-link.sql, même chantier) : `club_matches` n'a AUJOURD'HUI
-- AUCUNE policy RLS pour un CM SportVision — seulement `cma_family_select` (famille d'un joueur
-- affilié) et `cma_member_select` (is_club_member, un membre du club lui-même). Un CM n'est ni
-- l'un ni l'autre : il ne pouvait donc jamais lire les matchs d'un club, même le sien, même avec
-- un contrat actif. C'est un vrai trou pré-existant (pas une conséquence de ce chantier), révélé
-- par le premier vrai test du nouveau panneau CM.
--
-- Mirroring exact de `clubs_cm_select` (déjà en place, même condition d'accès CM) : le CM voit un
-- match si le club correspondant a un `portail_client_id` et que ce client lui est visible
-- (cm_lead, ou contenus_visible_par_cm() — même fonction déjà utilisée par clubs_cm_select,
-- aucune nouvelle fonction créée ici).

create policy "cma_cm_select" on club_matches for select using (
  exists (
    select 1 from clubs c
    where c.id = club_matches.club_id
      and c.portail_client_id is not null
      and (
        exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
        or contenus_visible_par_cm(c.portail_client_id, auth.uid())
      )
  )
);

-- ============================================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- select policyname, cmd from pg_policies where tablename='club_matches'; -- 3 lignes attendues
-- Avec un compte CM (niveau_cm renseigné, clients.cm_id = cm) : select sur club_matches du club
--   assigné -> visible. Match d'un club NON assigné à ce CM -> invisible.
-- ============================================================================
