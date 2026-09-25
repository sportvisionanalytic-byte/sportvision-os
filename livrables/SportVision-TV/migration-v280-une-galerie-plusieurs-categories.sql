-- v280 — 26/09/2026 : une galerie peut couvrir plusieurs catégories
--
-- Demande de Fouka : « quand on crée une galerie, mettre option pour club en Full Communication et
-- là ça propose nos clubs ; après quand on met la catégorie, ça propose les prestations uniquement
-- de la catégorie ; pouvoir aussi sélectionner plusieurs catégories. »
--
-- CE QUI BLOQUAIT, ET QUI N'ÉTAIT PAS VISIBLE
--
-- 1. `media_albums.team_id` est UNE équipe. Un plateau du samedi matin réunit U6, U7 et U8 sur le
--    même terrain, avec le même photographe : trois galeries pour un seul reportage, ou bien une
--    galerie « de club » ouverte à tout le monde, y compris aux Seniors qui n'ont rien à y voir.
--    Aucune des deux ne dit la vérité.
--
-- 2. `galerie_rattachements` rendait `team_id = null` sur TOUTES les prestations. Filtrer les
--    prestations par catégorie était donc impossible, pas difficile : l'information n'existait pas
--    dans le résultat. Elle existe pourtant, `equipes_de_mission` la calcule déjà.
--
-- LES TROIS ENDROITS QUI DÉCIDENT, ET POURQUOI ILS DOIVENT ÊTRE D'ACCORD
--
--   media_album_list    quelles galeries une famille VOIT
--   can_access_media    lesquelles elle peut OUVRIR
--   galerie_rattachements ce que le staff peut rattacher
--
-- Les deux premières doivent s'accorder au mot près. Si la liste montre une galerie que l'accès
-- refuse, la famille voit un cadenas sur une galerie qu'elle a payée ; si l'accès est plus large
-- que la liste, un Pass ouvre des photos qu'on n'avait pas vendues. On modifie donc les deux dans
-- la même migration, jamais l'une sans l'autre.
--
-- LA RÈGLE, ÉNONCÉE UNE FOIS
--
--   team_id null ET team_ids vide  → galerie de CLUB, servie à tout le club (inchangé) ;
--   sinon                          → servie aux familles de team_id ou de l'une de team_ids.
--
-- Le piège évité : si `team_ids` seul était rempli et `team_id` laissé null, l'ancienne condition
-- « team_id is null → tout le club » aurait ouvert la galerie du plateau U6-U8 aux Seniors. La
-- galerie de club se reconnaît désormais à DEUX champs vides, pas à un seul.
--
-- `team_id` est conservé et reste la catégorie principale : tout le code existant qui l'affiche
-- continue de marcher, et une galerie mono-catégorie ne change pas de forme.
--
-- Idempotent.

alter table media_albums add column if not exists team_ids uuid[] not null default '{}';

-- Les catégories SUPPLÉMENTAIRES, sans la principale : la dédoublonner ferait compter deux fois la
-- même équipe dans l'interface.
comment on column media_albums.team_ids is
  'Catégories supplémentaires couvertes, en plus de team_id. Vide sur une galerie mono-catégorie. '
  'team_id null ET team_ids vide = galerie de club.';

-- ── 1. Ce qu'une famille voit ────────────────────────────────────────────────────────────────
create or replace function public.media_album_list(
  p_club_id uuid, p_team_id uuid default null::uuid, p_saison_id uuid default null::uuid
) returns table (
  id uuid, title text, event_date date, cover_preview_url text,
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
    a.id, a.title, a.event_date, a.cover_preview_url, a.photo_count, a.published_at,
    can_access_media(a.id)
  from media_albums a
  where a.club_id = p_club_id
    and a.status = 'published'
    and (
      p_team_id is null
      -- Galerie de club : les DEUX champs vides. Tester le seul team_id aurait servi une galerie
      -- de plateau U6-U8 aux Seniors (v280).
      or (a.team_id is null and cardinality(a.team_ids) = 0)
      or a.team_id = p_team_id
      or p_team_id = any(a.team_ids)
    )
    and (p_saison_id is null or a.saison_id is null or a.saison_id = p_saison_id)
  order by coalesce(a.event_date, a.published_at::date) desc nulls last, a.published_at desc nulls last;
end;
$function$;

-- ── 2. Ce qu'une famille peut ouvrir ─────────────────────────────────────────────────────────
create or replace function public.can_access_media(p_album_id uuid)
returns boolean
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare
  v_album record;
  v_policy text;
  v_family boolean;
  v_equipes uuid[];
begin
  if auth.uid() is null then
    return false;
  end if;
  if is_staff() then
    -- 09/09/2026 : un opérateur terrain n'est staff que pour SES prestations. Sans cette nuance il
    -- récupérait le lien de partage de n'importe quelle galerie par son identifiant.
    return not est_operateur_terrain() or photographe_voit_album(p_album_id);
  end if;

  select * into v_album from media_albums where id = p_album_id;
  if not found then
    return false;
  end if;

  -- Toutes les catégories de la galerie, la principale comprise, sans doublon ni null.
  v_equipes := array(
    select distinct e from unnest(
      coalesce(v_album.team_ids, '{}'::uuid[]) || case when v_album.team_id is null then '{}'::uuid[] else array[v_album.team_id] end
    ) as e where e is not null
  );

  -- 12/09/2026 — Le droit payé d'abord, et il se suffit. `purchased_by_user_id` est celui qui a
  -- réglé : il garde son accès même si l'enfant a quitté le club.
  if exists (
    select 1 from media_entitlements me
    where me.status = 'active'
      and (me.valid_until is null or me.valid_until > now())
      -- Borne de saison (04/09) : un Pass Saison ne vaut pas pour les saisons suivantes.
      and (me.saison_id is null or me.saison_id = v_album.saison_id)
      and (
        (me.scope_type = 'club' and me.club_id = v_album.club_id)
        -- v280 : un Pass d'équipe ouvre la galerie dès que SON équipe est couverte, principale ou
        -- supplémentaire. Sans le `any`, la famille d'un U7 paierait un Pass et resterait devant
        -- un cadenas sur le plateau où son enfant a joué.
        or (me.scope_type = 'team' and me.scope_id = any(v_equipes))
        or (me.scope_type = 'album' and me.scope_id = v_album.id)
        or (me.scope_type = 'event' and v_album.event_id is not null and me.scope_id = v_album.event_id)
      )
      and (
        me.purchased_by_user_id = auth.uid()
        or is_own_player(me.beneficiary_person_id)
        or is_confirmed_parent_of(me.beneficiary_person_id)
      )
  ) then
    return true;
  end if;

  if cardinality(v_equipes) > 0 then
    -- Famille de N'IMPORTE LAQUELLE des catégories couvertes. La même règle que la liste, sinon un
    -- cadenas s'afficherait sur une galerie visible.
    select bool_or(is_family_of_team(e)) into v_family from unnest(v_equipes) as e;
    v_family := coalesce(v_family, false);
  else
    v_family := is_family_of_club(v_album.club_id);
  end if;
  if not v_family then
    return false;
  end if;

  v_policy := resolve_media_policy(p_album_id);

  if v_policy in ('free_members','public') then
    return true;
  end if;

  return false;
end;
$function$;

-- ── 3. Ce que le staff peut rattacher, filtré par catégorie ──────────────────────────────────
-- Le résultat gagne une colonne `team_ids` : une prestation couvre souvent plusieurs équipes, et
-- `team_id` seul ne pouvait pas le dire. Il reste rempli avec la première, pour tout le code qui
-- le lit déjà.
drop function if exists public.galerie_rattachements(uuid, integer);

create or replace function public.galerie_rattachements(
  p_club_id uuid,
  p_jours integer default 60,
  p_team_ids uuid[] default null
) returns table (
  genre text, ref_id uuid, libelle text, date_evenement date,
  team_id uuid, team_ids uuid[], equipe text, detail text
)
language sql stable security definer
set search_path to 'public'
as $function$
  with fenetre as (
    select (now() at time zone 'Europe/Paris')::date - greatest(coalesce(p_jours, 60), 1) as depuis,
           (now() at time zone 'Europe/Paris')::date + 7 as jusqua
  ), tout as (
    select 'match'::text as genre, m.id as ref_id,
           coalesce(t.name, m.team, 'Équipe') || ' — ' || coalesce(m.opponent, 'adversaire') as libelle,
           m.match_date as date_evenement,
           m.team_id,
           case when m.team_id is null then '{}'::uuid[] else array[m.team_id] end as team_ids,
           coalesce(t.name, m.team) as equipe,
           nullif(btrim(coalesce(m.competition, '')), '') as detail
      from club_matches m
      left join club_teams t on t.id = m.team_id
     cross join fenetre f
     where m.club_id = p_club_id and m.match_date between f.depuis and f.jusqua

    union all

    select case when lower(coalesce(e.type, '')) like '%entra%' then 'entrainement' else 'evenement' end,
           e.id, e.title, e.event_date, e.team_id,
           case when e.team_id is null then '{}'::uuid[] else array[e.team_id] end,
           e.team,
           nullif(btrim(coalesce(e.location, '')), '')
      from club_calendar_events e
     cross join fenetre f
     where e.club_id = p_club_id and e.event_date between f.depuis and f.jusqua

    union all

    -- v280 : les équipes de la prestation, enfin. Avant, cette branche rendait team_id = null et
    -- rendait tout filtrage par catégorie impossible — l'information n'était pas absente de la
    -- base, seulement absente du résultat.
    select 'prestation'::text, p.id,
           coalesce(p.reference, 'Prestation') || ' — ' || coalesce(p.type_prestation, 'prestation'),
           p.date_prestation,
           (select em.team_id from equipes_de_mission(p.id) em limit 1),
           coalesce((select array_agg(em.team_id) from equipes_de_mission(p.id) em), '{}'::uuid[]),
           (select string_agg(em.team_name, ', ') from equipes_de_mission(p.id) em),
           nullif(btrim(coalesce(p.lieu, '')), '')
      from prestations p
      join clubs c on c.portail_client_id = p.client_id
     cross join fenetre f
     where c.id = p_club_id and p.date_prestation between f.depuis and f.jusqua
  )
  select genre, ref_id, libelle, date_evenement, team_id, team_ids, equipe, detail
    from tout
   where p_team_ids is null
      or cardinality(p_team_ids) = 0
      -- Un rattachement SANS équipe reste proposé : une prestation dont les équipes ne sont pas
      -- encore résolues est précisément celle qu'on veut pouvoir rattacher à la main.
      or cardinality(team_ids) = 0
      or team_ids && p_team_ids
   order by date_evenement desc nulls last, libelle;
$function$;

revoke all on function public.galerie_rattachements(uuid, integer, uuid[]) from public;
grant execute on function public.galerie_rattachements(uuid, integer, uuid[]) to authenticated;
