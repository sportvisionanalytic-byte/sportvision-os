-- Le CM affilié devient administrateur OPÉRATIONNEL de ses clubs. Domaine par domaine.
--
-- ── La décision, prise par Fouka le 10/09/2026 ──
-- « Le CM peut pratiquement faire tourner le club au quotidien, mais il ne peut ni prendre
-- possession du club ni prendre possession du compte personnel de quelqu'un. »
--
-- ── Pourquoi PAS un remplacement global ──
-- La tentation était d'écrire `is_club_admin(x) or peut_operer_club(x)` partout où la première
-- apparaît : 32 policies, une seule commande. Consigne explicite de Fouka, et elle est juste —
-- ce remplacement aurait ouvert au passage l'identité légale du club, les fiches personnelles et
-- l'attribution de rôles privilégiés. Chaque domaine est donc traité pour ce qu'il est.
--
-- ── Ce qui reste FERMÉ, et n'est pas touché par ce fichier ──
--   `clubs_admin_update`        identité légale, SIRET, facturation, propriété du club
--   `club_members` DELETE       aucun hard delete : on révoque, on ne supprime pas (v105)
--   `player_profiles` DELETE    idem, et l'identité d'un compte revendiqué (v109)
--   rôles privilégiés           admin / president / cm_externe, gardés par le trigger (v105)
--
-- ── Une remarque sur l'état trouvé ──
-- Plusieurs de ces tables portaient déjà une policy `*_cm_affecte_*` conditionnée à
-- `est_cm_cloisonne()`, vraie uniquement pour un profil `cm`. Le CM issu du staff communication
-- (`com`) en était donc exclu, et les droits différaient d'un CM à l'autre sans qu'aucune règle
-- ne le dise. `peut_operer_club` réunit les deux : c'est la fin du patchwork, pas son extension.

begin;

-- ── Actualités ──
drop policy if exists cni_operateur_manage on public.club_newsroom_items;
create policy cni_operateur_manage on public.club_newsroom_items
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

-- ── Calendrier du club ──
drop policy if exists ccal_operateur_manage on public.club_calendar_events;
create policy ccal_operateur_manage on public.club_calendar_events
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

-- ── Sources et import de calendrier ──
drop policy if exists ccs_operateur_manage on public.club_calendar_sources;
create policy ccs_operateur_manage on public.club_calendar_sources
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

drop policy if exists ctsm_operateur_manage on public.club_team_source_mappings;
create policy ctsm_operateur_manage on public.club_team_source_mappings
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

-- ── Matchs, résultats, feuille de match ──
-- `for all` couvre l'assignation d'équipe (§ « Affectation d'une équipe à un match ») et la
-- vérification d'un résultat, deux gestes que le Match Center propose et que la RLS refusait au CM.
drop policy if exists cma_operateur_manage on public.club_matches;
create policy cma_operateur_manage on public.club_matches
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

-- ── Sponsors ──
drop policy if exists csp_operateur_manage on public.club_sponsors;
create policy csp_operateur_manage on public.club_sponsors
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

-- ── Réservations opérationnelles ──
drop policy if exists cbk_operateur_manage on public.club_bookings;
create policy cbk_operateur_manage on public.club_bookings
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

-- ── Médias du club, et les règles d'accès qui les accompagnent ──
drop policy if exists cmd_operateur_manage on public.club_media;
create policy cmd_operateur_manage on public.club_media
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

drop policy if exists ccr_operateur_manage on public.club_creations;
create policy ccr_operateur_manage on public.club_creations
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

drop policy if exists mar_operateur_manage on public.media_access_rules;
create policy mar_operateur_manage on public.media_access_rules
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

drop policy if exists masp_operateur_manage on public.media_access_selected_players;
create policy masp_operateur_manage on public.media_access_selected_players
  for all
  using (peut_operer_club(media_ref_club_id(media_ref_type, media_ref_id)))
  with check (peut_operer_club(media_ref_club_id(media_ref_type, media_ref_id)));

drop policy if exists mpt_operateur_manage on public.media_player_tags;
create policy mpt_operateur_manage on public.media_player_tags
  for all
  using (peut_operer_club(media_ref_club_id(media_ref_type, media_ref_id)))
  with check (peut_operer_club(media_ref_club_id(media_ref_type, media_ref_id)));

drop policy if exists mrp_operateur_update on public.media_reports;
create policy mrp_operateur_update on public.media_reports
  for update using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

-- ── Équipes et projets ──
-- L'UPDATE, pas le DELETE : une équipe s'ARCHIVE (`club_teams.archivee`). La supprimer
-- effacerait son historique de matchs et de créneaux, et Fouka a tranché pour le soft delete.
drop policy if exists ctm_operateur_update on public.club_teams;
create policy ctm_operateur_update on public.club_teams
  for update using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

drop policy if exists ctm_operateur_insert on public.club_teams;
create policy ctm_operateur_insert on public.club_teams
  for insert with check (peut_operer_club(club_id));

drop policy if exists tpr_operateur_manage on public.team_projects;
create policy tpr_operateur_manage on public.team_projects
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

-- ── Lieux ──
drop policy if exists cven_operateur_manage on public.club_venues;
create policy cven_operateur_manage on public.club_venues
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

-- ── Support ──
drop policy if exists cst_operateur_manage on public.club_support_tickets;
create policy cst_operateur_manage on public.club_support_tickets
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

-- ── Logo et médias dans le stockage ──
-- Le logo d'un club est un objet de communication : c'est le métier du CM. L'identité LÉGALE,
-- elle, reste sur `clubs` et n'est pas touchée.
drop policy if exists club_logos_operateur_write on storage.objects;
create policy club_logos_operateur_write on storage.objects
  for insert
  with check (bucket_id = 'club-logos' and peut_operer_club(((storage.foldername(name))[1])::uuid));

drop policy if exists club_logos_operateur_update on storage.objects;
create policy club_logos_operateur_update on storage.objects
  for update
  using (bucket_id = 'club-logos' and peut_operer_club(((storage.foldername(name))[1])::uuid));

drop policy if exists club_logos_operateur_delete on storage.objects;
create policy club_logos_operateur_delete on storage.objects
  for delete
  using (bucket_id = 'club-logos' and peut_operer_club(((storage.foldername(name))[1])::uuid));

drop policy if exists clubplus_media_operateur_delete on storage.objects;
create policy clubplus_media_operateur_delete on storage.objects
  for delete
  using (bucket_id = 'clubplus-media' and peut_operer_club(((storage.foldername(name))[1])::uuid));

commit;
