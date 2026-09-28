-- v320 — 28/09/2026 : la reconnaissance fait apparaître la galerie chez la famille
--
-- DEUX PORTES SUR LA MÊME PIÈCE, UNE SEULE OUVERTE. Le CONTENU d'une galerie s'ouvrait déjà à une
-- famille dès qu'un marquage existait pour son enfant, humain ou machine : c'est la règle de la
-- v309, posée pour l'enfant surclassé. Mais la LISTE restait bornée à l'équipe de l'enfant. La
-- famille pouvait donc entrer si on lui donnait l'adresse, et jamais trouver seule.
--
-- MESURE QUI DONNE SON POIDS AU DÉFAUT. Sur les 45 galeries publiées : 35 n'ont AUCUNE équipe, et
-- 31 aucun club. Ce sont exactement celles que SportVision vend par lien à l'équipe adverse
-- (« Villemomble Cup U10 - Courbevoie », « Amiens U10 VS RCP Fontainebleau »). Comme la liste filtre
-- sur `club_id = p_club_id`, AUCUNE ne pouvait remonter chez une famille. Les deux tiers du stock
-- étaient invisibles de ceux qui l'achètent.
--
-- DEMANDE DE FOUKA, 28/09 : « une galerie de club en Full Communication reste, mais elle est
-- forcément rattachée à une équipe ou à une journée d'entraînement ; donc là il faudra utiliser la
-- reconnaissance pour que les familles voient aussi les galeries pas en Full Communication qu'on
-- crée. »
--
-- ON N'ÉCRIT PAS UNE SIXIÈME FOIS LA RÈGLE. `media_galerie_concerne_le_joueur` dit déjà exactement
-- ce qu'il faut — un marquage existant, OU l'équipe de l'enfant — et c'est elle que le contenu
-- consulte. La liste l'appelle maintenant aussi. Quatre défauts d'hier venaient d'une règle
-- recopiée : celle-ci restera à un seul endroit.
--
-- LA BORNE, qui compte autant que l'ouverture : on ne peut demander la liste qu'au nom d'un enfant
-- dont on est le sportif ou le parent CONFIRMÉ. Sans ce contrôle, passer un identifiant au hasard
-- permettrait d'énumérer les galeries des autres enfants. Un identifiant non autorisé est ignoré en
-- silence plutôt que refusé : l'appelant n'apprend rien, pas même que l'enfant existe.
--
-- LA SIGNATURE CHANGE, DONC ON SUPPRIME AVANT DE CRÉER. `create or replace` avec un argument par
-- défaut en plus SURCHARGE au lieu de remplacer, et l'ancien appel à trois arguments devient
-- ambigu (42725). Ça a coûté une panne silencieuse le 26/09 sur `cm_definir_couverture`, où le CM
-- ne pouvait plus accepter la demande d'un club. Vérifié avant d'écrire : aucune fonction et aucune
-- policy n'appelle `media_album_list`, seules les applications le font.
--
-- Idempotent.

drop function if exists public.media_album_list(uuid, uuid, uuid);
drop function if exists public.media_album_list(uuid, uuid, uuid, uuid);

create function public.media_album_list(
  p_club_id uuid,
  p_team_id uuid default null,
  p_saison_id uuid default null,
  p_player_id uuid default null
)
returns table(id uuid, title text, event_date date, cover_preview_url text, cover_path text,
              photo_count integer, published_at timestamptz, unlocked boolean)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
declare
  v_tout_le_club boolean;
  v_joueur uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if not (is_staff() or is_club_member(p_club_id) or is_family_of_club(p_club_id)) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  -- v302, 27/09/2026 — QUI A LE DROIT DE VOIR TOUT LE CLUB, ET QUI N'A QUE SON ÉQUIPE.
  -- Le staff SportVision et les membres du club voient l'ensemble des galeries : c'est leur travail.
  -- Une famille ne voit que celles de l'équipe de son enfant.
  v_tout_le_club := is_staff() or is_club_member(p_club_id);

  -- v320 — L'enfant n'est retenu que si l'appelant a le droit d'agir pour lui. Ignoré en silence
  -- sinon : un identifiant au hasard ne doit rien apprendre, pas même que l'enfant existe.
  v_joueur := case
                when p_player_id is not null
                     and (is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id))
                then p_player_id
              end;

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
  where a.status = 'published'
    and (
      -- ── LE PÉRIMÈTRE DU CLUB, inchangé ────────────────────────────────────────────────────────
      (
        a.club_id = p_club_id
        and (
          (v_tout_le_club and p_team_id is null)
          -- GALERIE DE CLUB — les DEUX champs vides (v280) — POUR LE CLUB ET LE STAFF SEULEMENT.
          --
          -- Fouka, 27/09/2026 : « tout le monde voit les galeries de tout le monde. Alors que les
          -- joueurs doivent voir uniquement leur propre galerie à eux. » Une galerie sans équipe
          -- reste vendable par son lien et visible du club ; elle n'apparaît pas dans l'espace
          -- d'une famille parce qu'elle s'y trouve, mais parce que son enfant y est reconnu — et
          -- c'est la branche ci-dessous qui s'en charge.
          or (v_tout_le_club and a.team_id is null and cardinality(a.team_ids) = 0)
          or a.team_id = p_team_id
          or p_team_id = any(a.team_ids)
        )
        -- v303 : le cloisonnement du coach s'applique ICI AUSSI. Mesure du 27/09 : le coach de
        -- demonstration voyait 5 galeries dans Club+ et 23 par cette fonction. Deux portes sur la
        -- meme piece, une seule fermee.
        and (is_staff() or not is_club_member(p_club_id) or public.media_club_voit_la_galerie(a.id))
      )
      -- ── OU : SON ENFANT Y EST RECONNU, quel que soit le club, et même sans club ────────────────
      -- C'est ce qui rend visibles les galeries vendues par lien. La règle n'est pas réécrite ici :
      -- `media_galerie_concerne_le_joueur` est la même que celle qui ouvre le contenu.
      or (v_joueur is not null and public.media_galerie_concerne_le_joueur(a.id, v_joueur))
    )
    and (p_saison_id is null or a.saison_id is null or a.saison_id = p_saison_id)
  order by coalesce(a.event_date, a.published_at::date) desc nulls last, a.published_at desc nulls last;
end;
$function$;

revoke all on function public.media_album_list(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.media_album_list(uuid, uuid, uuid, uuid) to authenticated;
