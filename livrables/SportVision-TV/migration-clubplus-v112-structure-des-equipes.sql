-- Un coach pouvait créer une équipe, et renommer celle du voisin.
--
-- ── Trouvé pendant la passe navigateur du 10/09/2026 ──
-- L'écran Équipes proposait « Créer une équipe » au coach, en bouton principal. Vérification en
-- base : ce n'était pas un défaut d'affichage, la RLS l'autorisait vraiment.
--
--   coach → insert into club_teams (...)                      ACCEPTÉ
--   coach → update club_teams set name='…' where <équipe voisine>   ACCEPTÉ
--
-- `ctm_member_insert` et `ctm_member_update` ouvrent l'écriture à `is_club_member(club_id)`, sans
-- distinguer ni le rôle ni l'équipe. Tout membre du club pouvait donc renommer n'importe laquelle
-- de ses 43 équipes.
--
-- ── Pourquoi le renommage est le plus grave des deux ──
-- `club_members.teams` désigne les équipes par leur NOM, et `is_team_educateur` compare à la
-- lettre près. Renommer « U15 D1 » retire donc, silencieusement, ses droits au coach de cette
-- équipe — et casse au passage l'affichage du calendrier et des matchs, qui joignent sur le même
-- libellé.
--
-- ── La règle, dans le prolongement de la décision de Fouka ──
-- « Le coach gère l'activité de son équipe, mais ne modifie pas son existence structurelle. »
-- Créer, renommer, recatégoriser et archiver relèvent de la même phrase. L'écriture sur
-- `club_teams` revient donc à qui opère le club et à ses administrateurs.
--
-- Ce que le coach garde : la lecture de toutes les équipes du club (utile pour un calendrier
-- commun), et tout ce qui touche à l'ACTIVITÉ — matchs, résultats, créneaux, effectif, contenus.

begin;

drop policy if exists ctm_member_insert on public.club_teams;
drop policy if exists ctm_member_update on public.club_teams;
drop policy if exists ctm_cm_affecte_insert on public.club_teams;
drop policy if exists ctm_cm_affecte_update on public.club_teams;

-- `ctm_operateur_insert` et `ctm_operateur_update` (migration v108) portent déjà la bonne règle
-- pour l'opérateur du club. Il reste à couvrir l'administrateur du club lui-même, que ces deux
-- policies-là ne nomment pas.
drop policy if exists ctm_admin_insert on public.club_teams;
create policy ctm_admin_insert on public.club_teams
  for insert with check (is_club_admin(club_id));

drop policy if exists ctm_admin_update on public.club_teams;
create policy ctm_admin_update on public.club_teams
  for update using (is_club_admin(club_id)) with check (is_club_admin(club_id));

commit;
