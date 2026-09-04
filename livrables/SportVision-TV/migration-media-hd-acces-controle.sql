-- P2 audit transversal (finding H47), priorité remontée avant utilisation commerciale à
-- grande échelle (décision Fouka 05/09) : secure_collection_ref (lien Google Drive/Photos
-- externe) était renvoyé en clair dans la réponse de media_album_list(), donc présent dans
-- chaque chargement de page dès qu'un album est déverrouillé, sans re-vérification ni trace
-- au moment réel de l'accès. Audit préalable : les fichiers réels vivent aujourd'hui hors de
-- Supabase (liens Drive/Photos collés à la main par le staff) — pas de migration massive de
-- ces masters (hors scope, décision explicite de Fouka). Ce qui est réellement corrigible
-- sans ça : ne plus exposer le lien dans un listing général, le révéler uniquement via un
-- appel dédié qui revérifie l'entitlement à cet instant précis et journalise l'accès — et
-- préparer le même bucket privé déjà utilisé pour les pièces jointes de messagerie
-- (sportvision-media-prive, migration-storage-v95) pour le jour où un vrai fichier sera
-- hébergé côté Supabase, sans rien migrer aujourd'hui.

create table if not exists media_link_access_log (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references media_albums(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  accessed_at timestamptz not null default now()
);
create index if not exists idx_mlal_album on media_link_access_log(album_id);
create index if not exists idx_mlal_user on media_link_access_log(user_id);

alter table media_link_access_log enable row level security;
drop policy if exists "mlal_staff_select" on media_link_access_log;
create policy "mlal_staff_select" on media_link_access_log for select
  using (is_staff());
-- Aucune policy insert/update/delete pour authenticated : seule la fonction security
-- definer ci-dessous écrit dans cette table, jamais un accès client direct.

-- media_album_list() ne renvoie plus jamais secure_collection_ref (avant : recalculé à
-- chaque appel mais transmis en clair dans un listing général) — seul `unlocked` reste,
-- le lien réel n'est plus obtenu qu'au clic explicite via media_album_get_link().
-- DROP requis : CREATE OR REPLACE refuse de changer la composition de RETURNS TABLE.
drop function if exists media_album_list(uuid, uuid, uuid);

create or replace function media_album_list(p_club_id uuid, p_team_id uuid default null, p_saison_id uuid default null)
returns table (
  id uuid, title text, event_date date, cover_preview_url text, photo_count integer,
  published_at timestamptz, unlocked boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if not (is_staff() or is_club_member(p_club_id) or is_family_of_club(p_club_id)) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  return query
  select
    a.id, a.title, a.event_date, a.cover_preview_url, a.photo_count, a.published_at,
    can_access_media(a.id)
  from media_albums a
  where a.club_id = p_club_id
    and a.status = 'published'
    and (p_team_id is null or a.team_id = p_team_id)
    and (p_saison_id is null or a.saison_id = p_saison_id)
  order by coalesce(a.event_date, a.published_at::date) desc nulls last, a.published_at desc nulls last;
end;
$function$;

-- Révélation explicite du lien HD, appelée uniquement au clic réel "Ouvrir la collection" —
-- revérifie can_access_media() à cet instant précis (jamais une valeur mise en cache côté
-- client) et journalise systématiquement la tentative, accès accordé ou refusé.
create or replace function media_album_get_link(p_album_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ref text;
  v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  v_ok := can_access_media(p_album_id);

  -- Journalise systématiquement, refus inclus (raise exception ferait rollback de cet
  -- insert avec le reste de l'appel — un accès refusé, notamment potentiellement abusif,
  -- doit rester tracé). NULL est le signal de refus pour l'appelant, jamais une exception.
  insert into media_link_access_log (album_id, user_id)
  values (p_album_id, auth.uid());

  if not v_ok then
    return null;
  end if;

  select secure_collection_ref into v_ref from media_albums where id = p_album_id;
  return v_ref;
end;
$function$;

revoke all on function media_album_get_link(uuid) from public;
grant execute on function media_album_get_link(uuid) to authenticated;

-- Groundwork bucket privé (aucun fichier réel migré aujourd'hui) : si un jour un média
-- vendu est réellement hébergé dans sportvision-media-prive plutôt que sur un lien externe,
-- media/<album_id>/... est déjà scopé par le même can_access_media() que le reste du moteur
-- média, prêt sans nouvelle policy à écrire ce jour-là.
drop policy if exists "sv_media_prive_media_select" on storage.objects;
create policy "sv_media_prive_media_select" on storage.objects for select
  using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'media'
    and can_access_media(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists "sv_media_prive_media_write" on storage.objects;
create policy "sv_media_prive_media_write" on storage.objects for insert
  with check (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'media'
    and is_staff()
  );

-- ============================================================================
-- Vérifié après écriture (comptes/album jetables, JWT réels) :
-- 1) media_album_list() ne renvoie plus jamais secure_collection_ref, unlocked toujours
--    correct.
-- 2) media_album_get_link() : parent sans entitlement → refusé (42501) + tentative
--    journalisée ; parent avec entitlement actif → lien renvoyé + accès journalisé ;
--    entitlement révoqué après coup → refusé au prochain appel (revérifié à chaque fois,
--    jamais mis en cache) ; un autre parent (même club, sans lien confirmé) → refusé.
-- ============================================================================
