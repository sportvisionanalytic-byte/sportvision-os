-- ============================================================
-- SPORTVISION CLUB+ — Migration v17
-- Suite de migration-clubplus-v1 à v16.sql. Idempotente.
--
-- Portée : Phase 7 du module « Espace Joueur & Famille »
-- (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md) — un parent doit pouvoir
-- transmettre une autorisation parentale par import de document (méthode
-- 2, §5 du prompt d'origine). Réutilise le bucket 'clubplus-media' déjà
-- créé en v10 (même principe que le logo/écusson du club) plutôt qu'un
-- nouveau bucket, avec un préfixe de chemin dédié : un parent n'est
-- jamais club_member, il ne peut donc pas passer par les policies
-- clubplus_media_member_* existantes (scopées par club_id via
-- is_club_member) — deux policies additives sont nécessaires, scopées
-- par player_id via is_confirmed_parent_of.
--
-- Convention de chemin : clubplus-media/family-docs/<player_id>/<authorization_id>.<ext>
--
-- Limite connue, assumée (même compromis déjà accepté pour logo_url/
-- ecusson_url en v10) : le bucket clubplus-media est PUBLIC en lecture
-- (clubplus_media_public_read, v10) — un document d'autorisation
-- importé n'est donc pas réellement privé, seulement non-listable/
-- protégé par le caractère non-devinable des uuid dans son chemin. Si
-- des documents réellement sensibles (pièce d'identité...) devaient
-- être supportés, un bucket privé avec URLs signées serait nécessaire —
-- hors périmètre de cette migration, à revoir avant mise en production
-- si le besoin se confirme.
-- ============================================================

drop policy if exists "clubplus_media_parent_insert" on storage.objects;
create policy "clubplus_media_parent_insert" on storage.objects for insert
  with check (
    bucket_id = 'clubplus-media'
    and (storage.foldername(name))[1] = 'family-docs'
    and is_confirmed_parent_of(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists "clubplus_media_parent_update" on storage.objects;
create policy "clubplus_media_parent_update" on storage.objects for update
  using (
    bucket_id = 'clubplus-media'
    and (storage.foldername(name))[1] = 'family-docs'
    and is_confirmed_parent_of(((storage.foldername(name))[2])::uuid)
  );
