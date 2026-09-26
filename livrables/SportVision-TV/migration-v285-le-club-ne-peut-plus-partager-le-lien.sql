-- v285 — 26/09/2026 : le club voit ses photos, il ne peut plus diffuser le lien
--
-- Demande de Fouka : « il faut que ce lien ne soit pas envoyable. Il ne faudrait pas qu'eux puissent
-- envoyer leur propre lien aux joueurs. Le but, c'est que les joueurs ou les parents paient. Ils
-- peuvent voir les photos uniquement via leur compte à eux. »
--
-- CE QUI NE SUFFISAIT PAS : RETIRER LES BOUTONS
--
-- Club+ recevait `slug` ET `token` de chaque lien, et s'en servait pour « Copier », « QR Code » et
-- « Ouvrir ». Enlever les trois boutons n'aurait rien protégé : le jeton reste dans la réponse, donc
-- dans la page, lisible par quiconque ouvre l'inspecteur du navigateur. Un lien qu'on ne veut pas
-- voir partir ne doit pas être envoyé.
--
-- Le `token` ne sort donc plus. Le club continue de voir QUELS liens existent (leur libellé, leur
-- audience, s'ils sont actifs) — c'est une information légitime, il sait ce que SportVision diffuse
-- pour lui — mais il ne peut plus s'en servir. Diffuser un lien redevient une action de SportVision,
-- depuis l'OS.
--
-- Vérifié avant de retirer : le seul autre appelant (app-next/src/lib/data/club/content.ts) reçoit
-- `liens` en `unknown` et ne lit jamais le jeton.
--
-- ET POUR VOIR LES PHOTOS, ALORS ?
--
-- `media_club_gallery_photos` ci-dessous, par identifiant de galerie, sans aucun jeton. Elle ne
-- redéfinit PAS qui a le droit de voir : elle demande à `media_club_galleries`, qui porte déjà cette
-- règle (membre du club ou CM affecté, coach limité à ses équipes depuis la v155). Recopier la règle
-- ici aurait créé une seconde vérité, et c'est comme ça qu'un coach finit par voir une catégorie que
-- Club+ lui cache.
--
-- Idempotent.

drop function if exists public.media_club_galleries(uuid);

create or replace function public.media_club_galleries(p_club_id uuid)
returns table (
  album_id uuid, titre text, equipe text, event_date date, cover_url text,
  photos integer, publie boolean, liens jsonb
)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Membre reel OU staff SportVision autorise sur ce club (cm_clubs_autorises(), le meme
  -- referentiel que le badge "Gestion SportVision" affiche cote Club+).
  if not (is_club_member(p_club_id) or p_club_id in (select cm_clubs_autorises())) then
    return;
  end if;

  return query
  select a.id, a.title, t.name, a.event_date, a.cover_preview_url,
         (select count(*)::integer from media_assets m where m.album_id = a.id and m.status = 'ready'),
         (a.status = 'published'),
         -- Uniquement les liens explicitement confies au club. Le lien « equipe adverse » et les
         -- liens internes restent chez SportVision.
         --
         -- 26/09/2026 : le `token` ne sort PLUS (v285). Le club sait quels liens existent, il ne
         -- peut plus les diffuser — sans quoi il suffirait de les transmettre aux familles pour
         -- qu'elles voient les photos sans prendre le Pass.
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
    -- v155 : un coach (ou responsable d'équipe, ou directeur sportif) ne voit que SES équipes,
    -- plus les galeries du club qui n'appartiennent à aucune équipe. Les autres rôles du club,
    -- le CM affecté et l'agence voient tout, comme avant.
    and (a.team_id is null
         or is_team_educateur(a.team_id)
         or not exists (select 1 from club_members cm
                         where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
                           and cm.role in ('coach', 'resp_equipe', 'directeur_sportif')))
  order by a.event_date desc nulls last, a.created_at desc;
end;
$function$;

-- ── Les photos d'une galerie, pour le staff du club, sans jeton ───────────────────────────────
create or replace function public.media_club_gallery_photos(
  p_album_id uuid,
  p_limit integer default 200,
  p_offset integer default 0
) returns table (
  id uuid, thumb_path text, preview_path text, preview_clair_path text,
  width integer, height integer, total bigint
)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_club uuid;
  v_net boolean;
begin
  -- `al.` n'est pas cosmetique : la colonne de sortie `id` de cette fonction masque la colonne
  -- `id` de media_albums, et Postgres refuse la requete pour ambiguite. Qualifier leve le doute.
  select al.club_id into v_club from media_albums al where al.id = p_album_id;
  if v_club is null then return; end if;

  -- LA RÈGLE N'EST PAS RECOPIÉE : on demande à media_club_galleries si cette personne voit cette
  -- galerie. Une seule vérité sur « qui voit quoi », donc aucune divergence possible avec l'écran
  -- qui a servi à la choisir.
  if not exists (
    select 1 from media_club_galleries(v_club) g where g.album_id = p_album_id
  ) then
    return;
  end if;

  v_net := media_voit_sans_filigrane(p_album_id);

  return query
  select m.id, m.thumb_path, m.preview_path,
         case when v_net then m.preview_clair_path else null end,
         m.width, m.height,
         count(*) over () as total
  from media_assets m
  where m.album_id = p_album_id
    and m.status = 'ready'
    and m.thumb_path is not null
  order by m.position, m.created_at, m.id
  limit greatest(1, least(coalesce(p_limit, 200), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke all on function public.media_club_gallery_photos(uuid, integer, integer) from public;
grant execute on function public.media_club_gallery_photos(uuid, integer, integer) to authenticated;
