-- Voir quelles galeries marchent, et lesquelles ne marchent pas (21/09/2026)
--
-- DEMANDE DE FOUKA : « au niveau des galeries photo, améliore l'interface, parce que je ne vois
-- pas bien les galeries les plus performantes, les galeries payées. Je n'ai pas un bon visuel
-- dessus. »
--
-- CE QUI EXISTAIT. Le rapport CA médias donnait le chiffre d'affaires par club et par opération
-- commerciale. Deux niveaux au-dessus de ce qui se décide réellement : on ne vend pas « un club »,
-- on vend UNE galerie, celle d'un match précis, publiée un jour précis, à un prix précis. Sans ce
-- niveau, impossible de répondre aux seules questions qui comptent : laquelle rapporte, laquelle
-- est vue sans être achetée, et combien de photos il faut mettre pour que ça marche.
--
-- CE QUE CETTE FONCTION AJOUTE. Une ligne par galerie, avec de quoi comparer :
--   • ce qu'elle a rapporté, et combien de personnes ont acheté ;
--   • combien l'ont vue, et combien de visiteurs différents ;
--   • le taux de conversion, c'est-à-dire la part des visiteurs qui achètent — c'est LUI qui
--     distingue une galerie que personne ne regarde d'une galerie regardée que personne n'achète.
--     Les deux sont des échecs, mais on n'y répond pas de la même façon.
--
-- Réservée au staff SportVision : c'est une vue commerciale sur l'ensemble des clubs.

begin;

create or replace function public.media_performance_galeries(p_jours int default 180)
returns table (
  album_id uuid, titre text, club_id uuid, club text,
  date_evenement date, publiee_le timestamptz, photos int,
  vues int, visiteurs int, commandes int, ca_cents bigint,
  panier_moyen_cents bigint, conversion numeric, acces_offerts int
)
language sql
stable security definer
set search_path to 'public'
as $$
  with bornes as (
    select (now() at time zone 'Europe/Paris')::date - greatest(coalesce(p_jours, 180), 1) as depuis
  ),
  -- Les galeries de la période. `analytics_excluded` écarte les albums témoins des tests : les
  -- compter fausserait chaque moyenne de ce tableau.
  albums as (
    select a.* from media_albums a, bornes b
     where coalesce(a.analytics_excluded, false) = false
       and coalesce(a.published_at::date, a.event_date, a.created_at::date) >= b.depuis
  ),
  vues as (
    select v.album_id,
           count(*)::int as vues,
           count(distinct coalesce(v.user_id::text, v.visitor_hash))::int as visiteurs
      from media_album_views v join albums a on a.id = v.album_id
     group by v.album_id
  ),
  ventes as (
    select o.album_id,
           count(*)::int as commandes,
           coalesce(sum(o.amount_cents), 0)::bigint as ca
      from media_orders o join albums a on a.id = o.album_id
     where o.status = 'paid'
     group by o.album_id
  ),
  -- Un accès accordé sans passer par une commande payée : Pass Photo de saison, galerie offerte,
  -- droit donné à la main. Sans cette colonne, une galerie très consultée par des familles qui y
  -- ont droit passerait pour un échec commercial.
  -- `scope_type`/`scope_id` : un droit porte soit sur un album precis, soit sur toute une saison
  -- (Pass Photo). Seul le premier cas se rattache a une galerie.
  offerts as (
    select e.scope_id as album_id, count(*)::int as n
      from media_entitlements e join albums a on a.id = e.scope_id
     where e.scope_type = 'album' and e.status = 'active'
     group by e.scope_id
  )
  select a.id, a.title, a.club_id,
         -- Une galerie de tournoi n'appartient a aucun club : elle porte le nom de la structure
         -- organisatrice. Sans ce repli, la moitie du tableau s'intitulait « — ».
         coalesce(c.nom, nullif(btrim(coalesce(a.structure_externe, '')), ''), 'Sans club'),
         a.event_date, a.published_at, coalesce(a.photo_count, 0),
         coalesce(v.vues, 0), coalesce(v.visiteurs, 0),
         coalesce(s.commandes, 0), coalesce(s.ca, 0),
         case when coalesce(s.commandes, 0) > 0 then (s.ca / s.commandes)::bigint else 0 end,
         -- En pourcentage, deux décimales. Nul plutôt que zéro quand personne n'a vu la galerie :
         -- « 0 % » sur zéro visiteur ferait croire à un échec commercial là où il n'y a eu aucune
         -- occasion de vendre.
         case when coalesce(v.visiteurs, 0) > 0
              then round(coalesce(s.commandes, 0)::numeric * 100 / v.visiteurs, 2)
              else null end,
         coalesce(o.n, 0)
    from albums a
    left join clubs c on c.id = a.club_id
    left join vues v on v.album_id = a.id
    left join ventes s on s.album_id = a.id
    left join offerts o on o.album_id = a.id
   where is_staff()
   order by coalesce(s.ca, 0) desc, coalesce(v.visiteurs, 0) desc;
$$;

revoke all on function public.media_performance_galeries(int) from public;
grant execute on function public.media_performance_galeries(int) to authenticated;

comment on function public.media_performance_galeries(int) is
  'Une ligne par galerie : ventes, vues, visiteurs uniques, conversion. Staff SportVision '
  'uniquement. Les albums marqués analytics_excluded (témoins de test) sont écartés.';

commit;
