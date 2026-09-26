-- v288 — 26/09/2026 : une galerie a toujours une couverture
--
-- Constaté sur une capture d'écran de Fouka : la carte « RCPF VS PSG U16 · 110 photos » s'affiche
-- avec un rectangle vide. Mesure derrière : les 24 galeries publiées ont `cover_preview_url` à NULL.
-- Toutes. La carte est donc vide partout — dans l'app, dans Connect, dans Club+.
--
-- POURQUOI AUCUNE N'EN AVAIT
--
-- La couverture ne se pose QUE si quelqu'un désigne une photo à la main depuis l'OS. Il n'existe
-- aucun choix automatique. Et le déclencheur `media_album_sync_cover`, qui devait construire
-- l'adresse, ne pouvait rien faire : il lit `app.settings.storage_public_base`, un réglage qui n'est
-- pas configuré sur ce projet. Il rendait donc toujours NULL, sans bruit.
--
-- LE CHOIX : RÉPARER À LA LECTURE, PAS EN ÉCRIVANT
--
-- On pourrait écrire une couverture sur les 24 galeries. On ne le fait pas : une couverture écrite
-- en base devient fausse dès qu'on supprime la photo choisie, et il faudrait alors un second
-- mécanisme pour la rattraper. Les fonctions de lecture rendent désormais un `cover_path` calculé —
-- la photo désignée si elle existe, sinon la première de la galerie. Rien à entretenir.
--
-- C'est un CHEMIN de stockage et non une adresse complète, volontairement : la base ne connaît pas
-- l'URL publique du projet (c'est tout le problème du déclencheur ci-dessus), les clients si. Chacun
-- construit l'adresse comme il le fait déjà pour les autres aperçus.
--
-- Idempotent.

-- ── Ce que voit une famille ──────────────────────────────────────────────────────────────────
-- La colonne ajoutee change le type de retour : Postgres exige un DROP prealable.
drop function if exists public.media_album_list(uuid, uuid, uuid);

create or replace function public.media_album_list(
  p_club_id uuid, p_team_id uuid default null::uuid, p_saison_id uuid default null::uuid
) returns table (
  id uuid, title text, event_date date, cover_preview_url text, cover_path text,
  photo_count integer, published_at timestamp with time zone, unlocked boolean
)
language plpgsql stable security definer
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
    a.id, a.title, a.event_date, a.cover_preview_url,
    -- La photo désignée, sinon la première de la galerie. Jamais la vignette : la carte est large,
    -- une vignette de 480 px y serait floue.
    coalesce(
      (select s.preview_path from media_assets s
        where s.id = a.cover_asset_id and s.album_id = a.id and s.status = 'ready'),
      (select s.preview_path from media_assets s
        where s.album_id = a.id and s.status = 'ready' and s.preview_path is not null
        order by s.position, s.created_at, s.id limit 1)
    ) as cover_path,
    a.photo_count, a.published_at,
    can_access_media(a.id)
  from media_albums a
  where a.club_id = p_club_id
    and a.status = 'published'
    and (
      p_team_id is null
      -- Galerie de club : les DEUX champs vides (v280).
      or (a.team_id is null and cardinality(a.team_ids) = 0)
      or a.team_id = p_team_id
      or p_team_id = any(a.team_ids)
    )
    and (p_saison_id is null or a.saison_id is null or a.saison_id = p_saison_id)
  order by coalesce(a.event_date, a.published_at::date) desc nulls last, a.published_at desc nulls last;
end;
$function$;

-- ── Ce que voit le club ──────────────────────────────────────────────────────────────────────
drop function if exists public.media_club_galleries(uuid);

create or replace function public.media_club_galleries(p_club_id uuid)
returns table (
  album_id uuid, titre text, equipe text, event_date date, cover_url text, cover_path text,
  photos integer, publie boolean, liens jsonb
)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not (is_club_member(p_club_id) or p_club_id in (select cm_clubs_autorises())) then
    return;
  end if;

  return query
  select a.id, a.title, t.name, a.event_date, a.cover_preview_url,
         coalesce(
           (select s.preview_path from media_assets s
             where s.id = a.cover_asset_id and s.album_id = a.id and s.status = 'ready'),
           (select s.preview_path from media_assets s
             where s.album_id = a.id and s.status = 'ready' and s.preview_path is not null
             order by s.position, s.created_at, s.id limit 1)
         ),
         (select count(*)::integer from media_assets m where m.album_id = a.id and m.status = 'ready'),
         (a.status = 'published'),
         -- Le `token` ne sort PAS (v285) : le club sait quels liens existent, il ne peut pas les
         -- diffuser.
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'label', l.label, 'audience', l.audience, 'slug', l.slug,
             'is_enabled', l.is_enabled
           ) order by l.created_at)
           from media_album_links l
           where l.album_id = a.id and l.visible_in_clubplus
         ), '[]'::jsonb)
  from media_albums a
  left join club_teams t on t.id = a.team_id
  where a.club_id = p_club_id and a.status = 'published'
    -- v155 : un coach ne voit que SES équipes, plus les galeries sans équipe.
    and (a.team_id is null
         or is_team_educateur(a.team_id)
         or not exists (select 1 from club_members cm
                         where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
                           and cm.role in ('coach', 'resp_equipe', 'directeur_sportif')))
  order by a.event_date desc nulls last, a.created_at desc;
end;
$function$;
