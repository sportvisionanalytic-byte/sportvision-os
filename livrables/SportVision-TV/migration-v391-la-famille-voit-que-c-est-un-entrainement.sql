-- v391 — LA FAMILLE VOIT QUE C'EST UN ENTRAÎNEMENT (01/10/2026)
--
-- Fouka : « comme ça les parents voient que c'est un entraînement, il n'y a pas de numéro à
-- renseigner, avec la reconnaissance par visage toujours. »
--
-- La v390 pose le type sur la galerie. Il ne sort nulle part : `media_albums` n'est lisible que par
-- `media_upload_staff()`, donc ni une famille ni un club ne peut lire la colonne. Tout passe par
-- des fonctions, et ce sont ces quatre-là qu'une famille, un club ou un visiteur de lien
-- rencontrent :
--
--     media_gallery_open()     la page d'une galerie ouverte par un lien, SANS COMPTE (anon)
--     media_my_galleries()     « mes galeries » dans Connect, après achat
--     media_album_list()       la liste des galeries d'un club, côté famille et côté club
--     media_club_galleries()   les galeries d'un club dans Club+
--
-- CHACUNE GAGNE DEUX COLONNES, ET RIEN D'AUTRE :
--
--     type_evenement   le code brut ('entrainement'…), NULL si non précisé
--     numero_utile     faut-il demander un numéro de maillot ? La réponse de galerie_numero_utile()
--
-- POURQUOI LES DEUX. Le code sert à écrire le mot sur l'écran ; le booléen sert à décider si on pose
-- la question du numéro. Si on ne rendait que le code, les trois applications réécriraient chacune
-- la liste des types sans numéro, et la quatrième l'oublierait. La règle reste dans la base, elles
-- lisent un oui ou un non.
--
-- ON AJOUTE, ON NE DÉPLACE PAS. Les colonnes sont mises EN FIN de chaque table de retour. Un client
-- JavaScript lit par nom et ignore ce qu'il ne connaît pas : les applications d'aujourd'hui, qui ne
-- demandent rien de tout cela, continuent exactement comme avant. Changer un type de retour oblige
-- à un `drop` puis un `create` — les deux sont ici dans UNE transaction, donc aucune requête de
-- production ne peut tomber sur la fonction absente.
--
-- LES CORPS SONT RECOPIÉS À L'IDENTIQUE, commentaires compris, depuis la définition en production
-- lue le 01/10/2026. Seules les lignes marquées « v391 » sont nouvelles. Une réécriture « propre »
-- au passage serait le meilleur moyen de perdre une règle de cloisonnement sans s'en apercevoir.

begin;

-- ── 1. LA PAGE D'UNE GALERIE, OUVERTE PAR UN LIEN ──────────────────────────────────────────────
drop function if exists public.media_gallery_open(text, text, text);

create function public.media_gallery_open(p_slug text, p_token text, p_password text default null::text)
returns table(valide boolean, raison text, album_id uuid, titre text, event_date date, club_nom text,
              equipe text, structure text, cover_url text, photo_count integer,
              mot_de_passe_requis boolean, livraison_externe boolean, watermark boolean,
              offres jsonb, apercu_limite integer,
              type_evenement text, numero_utile boolean)   -- v391
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
  v_offres jsonb;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);

  if r.raison is not null then
    return query select false, r.raison, null::uuid, null::text, null::date, null::text, null::text, null::text,
                        null::text, null::integer, (r.raison = 'mot_de_passe'), null::boolean,
                        null::boolean, null::jsonb, null::integer,
                        null::text, null::boolean;   -- v391
    return;
  end if;

  -- Un tableau, éventuellement vide : la page distingue « ce lien ne vend rien » (galerie de
  -- consultation) de « ce lien vend trois formules », sans second appel.
  select coalesce(jsonb_agg(jsonb_build_object(
           'offer_id', x.offer_id,
           'product_id', x.product_id,
           'type', x.offer_type,
           'name', x.offer_name,
           'price_cents', x.price_cents,
           'currency', x.currency,
           'photos_allowance', x.photos_allowance,
           'featured', x.is_featured
         ) order by x.display_order, x.price_cents), '[]'::jsonb)
  into v_offres
  from media_link_offers(r.link_id) x;

  return query
  select true, null::text, a.id, a.title, a.event_date, c.nom, t.name, a.structure_externe, a.cover_preview_url,
         -- v312 : on n'annonce que ce qu'on sert. Une photo dont le filigrane a echoue est
         -- retiree de la galerie publique ; l'annoncer quand meme afficherait « 15 photos » au-dessus
         -- d'une page vide, et le client croirait a une panne au lieu de voir une galerie plus courte.
         (select count(*)::integer from media_assets m
           where m.album_id = a.id and m.status = 'ready' and m.preview_watermarked is true),
         false,
         (a.secure_collection_ref is not null
          and not exists (select 1 from media_assets m where m.album_id = a.id and m.status = 'ready')),
         a.watermark_previews,
         v_offres,
         _media_gallery_preview_limit(r.link_id),
         a.type_evenement,                          -- v391
         public.galerie_numero_utile(a.id)          -- v391
  from media_albums a
  left join clubs c on c.id = a.club_id
  left join club_teams t on t.id = a.team_id
  where a.id = r.album_id;
end;
$function$;

grant execute on function public.media_gallery_open(text, text, text) to anon, authenticated, service_role;

-- ── 2. « MES GALERIES » DANS CONNECT ───────────────────────────────────────────────────────────
drop function if exists public.media_my_galleries();

create function public.media_my_galleries()
returns table(album_id uuid, titre text, club_nom text, equipe text, event_date date, cover_url text,
              photos_acquises integer, album_photos integer, acces_complet boolean,
              acces_permanent boolean, expires_at timestamp with time zone, commandes integer,
              derniere_commande timestamp with time zone,
              type_evenement text, numero_utile boolean)   -- v391
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with mes as (
    select o.id as order_id, o.album_id, o.paid_at, g.claimed_by_user_id, g.expires_at
    from media_orders o
    join media_download_grants g on g.order_id = o.id
    where o.purchased_by_user_id = auth.uid() and o.status = 'paid'
  ),
  -- L'UNION des photos réellement acquises, sans doublon : deux commandes qui se recouvrent ne
  -- comptent la même photo qu'une fois. C'est ce nombre qui s'affiche, jamais le quota vendu.
  photos as (
    select distinct i.album_id, i.asset_id
    from media_order_items i
    where i.order_id in (select order_id from mes)
  )
  select
    a.id, a.title, c.nom, t.name, a.event_date, a.cover_preview_url,
    (select count(*)::integer from photos p where p.album_id = a.id),
    (select count(*)::integer from media_assets m where m.album_id = a.id and m.status = 'ready'),
    (select count(*) from photos p where p.album_id = a.id)
      >= (select count(*) from media_assets m where m.album_id = a.id and m.status = 'ready'),
    bool_or(mes.claimed_by_user_id is not null),
    max(mes.expires_at),
    count(distinct mes.order_id)::integer,
    max(mes.paid_at),
    a.type_evenement,                        -- v391
    public.galerie_numero_utile(a.id)        -- v391
  from mes
  join media_albums a on a.id = mes.album_id
  left join clubs c on c.id = a.club_id
  left join club_teams t on t.id = a.team_id
  group by a.id, a.title, c.nom, t.name, a.event_date, a.cover_preview_url, a.type_evenement
  order by max(mes.paid_at) desc nulls last;
$function$;

grant execute on function public.media_my_galleries() to anon, authenticated, service_role;

-- ── 3. LA LISTE DES GALERIES D'UN CLUB (famille, club, staff) ──────────────────────────────────
drop function if exists public.media_album_list(uuid, uuid, uuid, uuid);

create function public.media_album_list(p_club_id uuid, p_team_id uuid default null::uuid,
                                        p_saison_id uuid default null::uuid,
                                        p_player_id uuid default null::uuid)
returns table(id uuid, title text, event_date date, cover_preview_url text, cover_path text,
              photo_count integer, published_at timestamp with time zone, unlocked boolean,
              type_evenement text, numero_utile boolean)   -- v391
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    can_access_media(a.id),
    a.type_evenement,                      -- v391
    public.galerie_numero_utile(a.id)      -- v391
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

grant execute on function public.media_album_list(uuid, uuid, uuid, uuid) to authenticated, service_role;

-- ── 4. LES GALERIES D'UN CLUB DANS CLUB+ ───────────────────────────────────────────────────────
drop function if exists public.media_club_galleries(uuid);

create function public.media_club_galleries(p_club_id uuid)
returns table(album_id uuid, titre text, equipe text, event_date date, cover_url text,
              cover_path text, photos integer, publie boolean, liens jsonb,
              type_evenement text, numero_utile boolean)   -- v391
language plpgsql
stable security definer
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
         ), '[]'::jsonb),
         a.type_evenement,                      -- v391
         public.galerie_numero_utile(a.id)      -- v391
  from media_albums a
  left join club_teams t on t.id = a.team_id
  where a.club_id = p_club_id and a.status = 'published'
    -- v303 : la regle de cloisonnement vit dans media_club_voit_la_galerie(), et nulle part ailleurs.
    and public.media_club_voit_la_galerie(a.id)
  order by a.event_date desc nulls last, a.created_at desc;
end;
$function$;

grant execute on function public.media_club_galleries(uuid) to anon, authenticated, service_role;

commit;
