-- migration-media-v4-fix-album-list-leak-plus-dedup.sql (02/09/2026)
--
-- 2 correctifs trouvés lors de l'audit backend du moteur média du 02/09 (voir aussi
-- migration-media-v3 pour le trou critique de suppression de club, corrigé séparément) :
--
-- 1. FUITE FAIBLE : media_album_list(p_club_id) ne vérifiait jamais que l'appelant a une relation
--    réelle avec p_club_id avant de renvoyer les lignes — can_access_media() protège bien
--    secure_collection_ref par album, mais rien ne protégeait titre/nombre de photos/date/aperçu
--    au niveau de la liste elle-même. Un compte authentifié quelconque connaissant/devinant un
--    club_id pouvait lister les métadonnées de ses albums. Corrigé par une garde en tête de
--    fonction (is_staff() ou is_club_member() ou is_family_of_club()), même doctrine que le reste
--    du moteur.
--
-- 2. TOCTOU MOYEN : aucune contrainte n'empêchait deux media_entitlements actifs pour le même
--    (bénéficiaire, produit, portée) en cas de double achat concurrent (double-clic, double
--    onglet) — le check "déjà accès" de create-pass-photo-checkout est un SELECT avant INSERT, pas
--    atomique. N'entraîne pas de fuite d'accès (canAccessMedia reste correct même avec des
--    doublons) mais peut entraîner un double encaissement Stripe. Filet de sécurité ajouté : index
--    unique partiel sur (beneficiary_person_id, product_id, scope_type, scope_id) where
--    status='active' — le webhook (déjà sans vérification d'erreur sur cet insert, donc déjà
--    tolérant à un échec silencieux) refusera désormais silencieusement la création d'un second
--    entitlement actif identique plutôt que de le dupliquer.

create or replace function public.media_album_list(p_club_id uuid, p_team_id uuid default null, p_saison_id uuid default null)
returns table(id uuid, title text, event_date date, cover_preview_url text, photo_count integer, published_at timestamptz, unlocked boolean, secure_collection_ref text)
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
    can_access_media(a.id),
    case when can_access_media(a.id) then a.secure_collection_ref else null end
  from media_albums a
  where a.club_id = p_club_id
    and a.status = 'published'
    and (p_team_id is null or a.team_id = p_team_id)
    and (p_saison_id is null or a.saison_id = p_saison_id)
  order by coalesce(a.event_date, a.published_at::date) desc nulls last, a.published_at desc nulls last;
end;
$function$;
comment on function public.media_album_list(uuid, uuid, uuid) is 'Remplace photo_album_list() (portée club/équipe/saison figée) — p_team_id/p_saison_id optionnels pour lister au niveau club entier. Garde d''accès en tête de fonction (is_staff/is_club_member/is_family_of_club) depuis le correctif v4 du 02/09 — chaque ligne revérifie ensuite can_access_media() pour le lien protégé, jamais de court-circuit.';

create unique index if not exists media_entitlements_unique_active_scope
  on public.media_entitlements (beneficiary_person_id, product_id, scope_type, scope_id)
  where status = 'active';
