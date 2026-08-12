-- Migration v49 : restreint la lecture de club_members aux membres du bureau (+ sa propre ligne)
--
-- Trouvé le 12/08/2026 en revoyant l'audit permissions Communication/Éducateur : cm_same_club_
-- select (migration-clubplus-v1.sql) laissait n'importe quel membre actif d'un club lire TOUTES
-- les lignes club_members du club (prénom/nom/téléphone/rôle/équipes de tout le monde), alors que
-- le master doc Connect V1 (§11) exige que "Utilisateurs" reste réservé à l'administrateur —
-- Communication et Éducateur ne doivent JAMAIS y avoir accès. Un garde côté frontend a déjà été
-- posé (app-next, écran /users) mais §30 du master doc est explicite : "la sécurité ne repose pas
-- sur le masquage de l'interface" — un appel direct à l'API REST contournait ce garde. cm_self_
-- select (déjà existante, inchangée) continue de garantir que chacun lit toujours sa propre ligne,
-- quel que soit son rôle — nécessaire pour session.ts/teamScope.
--
-- Même liste de rôles que club_member_has_financial_access() (migration-connect-v41) : admin,
-- president, tresorier, membre_bureau.
--
-- Vérifié avant écriture : app-next ne lit club_members ailleurs que dans data/club/users.ts (un
-- seul fichier, déjà gaté côté frontend pour Communication/Éducateur par ce même audit) — aucun
-- autre usage légitime de lecture croisée entre membres ne dépend de cm_same_club_select.
-- SportVision OS et les edge functions passent par le service role (RLS non appliquée), non
-- affectés par ce changement.
drop policy if exists "cm_same_club_select" on club_members;
create policy "cm_same_club_select" on club_members for select using (
  is_club_member(club_id)
  and exists (
    select 1 from club_members cm2
    where cm2.user_id = auth.uid()
      and cm2.club_id = club_members.club_id
      and cm2.status = 'actif'
      and cm2.role in ('admin', 'president', 'tresorier', 'membre_bureau')
  )
);
