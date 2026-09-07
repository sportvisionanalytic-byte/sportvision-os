-- Migration : Galeries — pôle explicite, espace Connect, et lecture Club+
-- À exécuter APRÈS migration-galeries-v17-constructeur-offres.sql.
--
-- Trois sujets, un seul lot parce qu'ils partagent les mêmes tables.

begin;

-- ── 1. Le pôle d'un album, explicitement ───────────────────────────────────────────────────
-- La v17 déduisait le pôle de la mission. Un album de tournoi peut être créé sans mission : il
-- n'avait alors aucun pôle, et le responsable de pôle en était écarté. Fouka veut pouvoir le
-- rattacher à la main. On ajoute donc la colonne, et la déduction par la mission devient un repli.
--
-- Ce qu'on ne fait SURTOUT pas : traiter `pole_id is null` comme « tous les responsables ». Un
-- album sans pôle reste réservé à admin / production / secrétariat.
alter table media_albums
  add column if not exists pole_id uuid references poles(id) on delete set null;

comment on column media_albums.pole_id is
  'Pôle responsable de cet album. Renseigné à la main dans l''OS, ou hérité de la mission. null = aucun responsable de pôle n''y a accès (jamais « tous »).';

-- Rattrapage : les albums qui ont une mission héritent du pôle de cette mission.
update media_albums a
set pole_id = pr.pole_id
from prestations pr
where a.mission_id = pr.id and a.pole_id is null and pr.pole_id is not null;

create or replace function media_pricing_staff_album(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin','prod','sec')
  )
  or exists (
    -- Le pôle de l'album d'abord, celui de sa mission ensuite. `coalesce` et non `or` : un album
    -- explicitement rattaché à Basket ne doit pas rester accessible au responsable Football parce
    -- que sa mission était encore rangée là.
    select 1
    from media_albums a
    left join prestations pr on pr.id = a.mission_id
    join pole_affectations pa on pa.pole_id = coalesce(a.pole_id, pr.pole_id)
    where a.id = p_album_id
      and coalesce(a.pole_id, pr.pole_id) is not null
      and pa.user_id = auth.uid()
      and pa.role_pole = 'responsable'
      and pa.actif
  );
$$;

-- ── 2. Ce que le club voit de ses liens ────────────────────────────────────────────────────
-- Tous les liens d'un album ne regardent pas le club : le lien « équipe adverse » à 30 € et le
-- lien de promotion interne restent chez SportVision. C'est une décision par lien, pas une
-- déduction depuis l'audience — on peut vouloir confier au club un lien qui n'est pas celui de
-- ses parents.
alter table media_album_links
  add column if not exists visible_in_clubplus boolean not null default false;

comment on column media_album_links.visible_in_clubplus is
  'Ce lien est-il mis à disposition du club dans Club+ ? false par défaut : un lien est interne à SportVision tant qu''on ne décide pas de le confier.';

-- ── 3. L'espace Connect de l'acheteur ──────────────────────────────────────────────────────
-- « Mes galeries » : UNE ligne par album, même si le compte a acheté deux fois dessus. Un parent
-- qui prend un pack 10 puis un pack 20 sur le même match ne doit pas voir sa galerie en double —
-- il en a une, avec plus de photos dedans.
create or replace function media_my_galleries()
returns table (
  album_id uuid,
  titre text,
  club_nom text,
  equipe text,
  event_date date,
  cover_url text,
  photos_acquises integer,
  album_photos integer,
  acces_complet boolean,
  acces_permanent boolean,
  expires_at timestamptz,
  commandes integer,
  derniere_commande timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
    max(mes.paid_at)
  from mes
  join media_albums a on a.id = mes.album_id
  left join clubs c on c.id = a.club_id
  left join club_teams t on t.id = a.team_id
  group by a.id, a.title, c.nom, t.name, a.event_date, a.cover_preview_url
  order by max(mes.paid_at) desc nulls last;
$$;

grant execute on function media_my_galleries() to authenticated;

-- Les photos d'une galerie que CE compte possède réellement. Un pack de 17 dont l'acheteur n'a
-- retenu que 13 photos en rend 13 : le quota est une limite commerciale, pas un nombre de médias
-- possédés.
create or replace function media_my_gallery_photos(p_album_id uuid)
returns table (
  id uuid,
  thumb_path text,
  preview_path text,
  filename text,
  width integer,
  height integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct m.id, m.thumb_path, m.preview_path, m.original_filename, m.width, m.height
  from media_order_items i
  join media_orders o on o.id = i.order_id
  join media_assets m on m.id = i.asset_id
  where o.purchased_by_user_id = auth.uid()
    and o.status = 'paid'
    and i.album_id = p_album_id
  order by m.id;
$$;

comment on function media_my_gallery_photos is
  'Photos d''une galerie réellement acquises par le compte connecté, union de toutes ses commandes sans doublon. Ne renvoie JAMAIS de chemin d''original : le téléchargement reste signé au clic par gallery-download.';

grant execute on function media_my_gallery_photos(uuid) to authenticated;

-- ── 4. Les galeries d'un club, pour Club+ ──────────────────────────────────────────────────
-- Club+ lit les MÊMES albums et les MÊMES liens. Aucune copie, aucune table dédiée.
create or replace function media_club_galleries(p_club_id uuid)
returns table (
  album_id uuid,
  titre text,
  equipe text,
  event_date date,
  cover_url text,
  photos integer,
  publie boolean,
  liens jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- La sécurité tient à cette ligne : on ne répond que pour un club dont l'appelant est membre.
  -- is_club_member existe déjà et sert partout ailleurs dans Club+ — on ne réécrit pas la règle.
  if not is_club_member(p_club_id) then return; end if;

  return query
  select a.id, a.title, t.name, a.event_date, a.cover_preview_url,
         (select count(*)::integer from media_assets m where m.album_id = a.id and m.status = 'ready'),
         (a.status = 'published'),
         -- Uniquement les liens explicitement confiés au club. Le lien « équipe adverse » et les
         -- liens internes restent chez SportVision.
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'label', l.label, 'audience', l.audience, 'slug', l.slug, 'token', l.token,
             'is_enabled', l.is_enabled
           ) order by l.created_at)
           from media_album_links l
           where l.album_id = a.id and l.visible_in_clubplus
         ), '[]'::jsonb)
  from media_albums a
  left join club_teams t on t.id = a.team_id
  where a.club_id = p_club_id and a.status = 'published'
  order by a.event_date desc nulls last, a.created_at desc;
end;
$$;

comment on function media_club_galleries is
  'Galeries publiées d''un club, avec les seuls liens que SportVision lui a explicitement confiés. Le club lit les mêmes albums et les mêmes liens : aucune copie côté Club+. Il ne voit aucun tarif et ne peut rien modifier.';

grant execute on function media_club_galleries(uuid) to authenticated;

commit;
