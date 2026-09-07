-- Migration : les statistiques respectent le drapeau d'exclusion
-- À exécuter APRÈS migration-galeries-v24-exclusion-tests.sql.
--
-- Chaque fonction de statistiques reçoit un paramètre `p_inclure_exclus`, faux par défaut : les
-- galeries et les liens marqués comme essais sortent des chiffres, et on peut les réintégrer
-- quand on veut vérifier qu'un essai a produit ce qu'on attendait.
--
-- Le filtre est appliqué à DEUX endroits parce que les deux cas existent : le périmètre des
-- albums, et chaque lien pris individuellement — on peut tester un tarif sur une vraie galerie
-- sans perdre les chiffres des liens envoyés aux familles.
--
-- Les anciennes signatures sont supprimées : en laisser une traîner ferait que la moitié de
-- l'écran compterait les essais et l'autre non, sans que rien ne le signale.

begin;

drop function if exists media_stats_resume(date, date);
drop function if exists media_stats_galeries(date, date, integer);
drop function if exists media_stats_liens(uuid, date, date);
drop function if exists media_stats_offres(uuid, date, date);
drop function if exists media_stats_audiences(date, date);
drop function if exists media_stats_connect(date, date);
drop function if exists media_stats_evolution(date, date);

create or replace function media_stats_resume(p_debut date, p_fin date,
  p_inclure_exclus boolean default false)
returns table (
  ca_cents bigint,
  rembourse_cents bigint,
  commandes integer,
  commandes_payantes integer,
  commandes_gratuites integer,
  galeries_vendeuses integer,
  visites integer,
  panier_moyen_cents integer,
  taux_conversion numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with perimetre as (select album_id from _media_stats_albums(p_inclure_exclus)),
  cmd as (
    select o.* from media_orders o
    join perimetre p on p.album_id = o.album_id
    where _media_stats_lien_compte(o.link_id, p_inclure_exclus)
      and o.status = 'paid'
      and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
  ),
  remb as (
    select o.amount_cents from media_orders o
    join perimetre p on p.album_id = o.album_id
    where _media_stats_lien_compte(o.link_id, p_inclure_exclus)
      and o.status = 'refunded'
      and o.refunded_at >= p_debut and o.refunded_at < (p_fin + 1)
  ),
  vues as (
    select count(*)::integer as n from media_album_views v
    join perimetre p on p.album_id = v.album_id
    where _media_stats_lien_compte(v.link_id, p_inclure_exclus)
      and v.viewed_at >= p_debut and v.viewed_at < (p_fin + 1)
  )
  select
    coalesce(sum(c.amount_cents), 0)::bigint,
    coalesce((select sum(amount_cents) from remb), 0)::bigint,
    count(*)::integer,
    count(*) filter (where c.amount_cents > 0)::integer,
    count(*) filter (where c.amount_cents = 0)::integer,
    count(distinct c.album_id)::integer,
    (select n from vues),
    -- Panier moyen sur les commandes PAYANTES seulement : une campagne offerte ferait
    -- mécaniquement chuter la moyenne et laisserait croire à un effondrement des ventes.
    case when count(*) filter (where c.amount_cents > 0) > 0
         then (sum(c.amount_cents) filter (where c.amount_cents > 0)
               / count(*) filter (where c.amount_cents > 0))::integer
    end,
    -- Commandes pour 100 visites. Le dénominateur est un nombre de VISITES, pas de personnes :
    -- voir l'en-tête. Null plutôt que 0 quand il n'y a aucune visite — un taux calculé sur rien
    -- n'est pas 0 %, il n'existe pas.
    case when (select n from vues) > 0
         then round(count(*)::numeric * 100 / (select n from vues), 2)
    end
  from cmd c;
$$;

create or replace function media_stats_galeries(p_debut date, p_fin date, p_limit integer default 20,
  p_inclure_exclus boolean default false)
returns table (
  album_id uuid,
  titre text,
  club_nom text,
  event_date date,
  visites integer,
  commandes integer,
  ca_cents bigint,
  panier_moyen_cents integer,
  taux_conversion numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with perimetre as (select album_id from _media_stats_albums(p_inclure_exclus)),
  cmd as (
    select o.album_id, count(*)::integer as n, coalesce(sum(o.amount_cents),0)::bigint as ca,
           count(*) filter (where o.amount_cents > 0)::integer as n_payantes,
           coalesce(sum(o.amount_cents) filter (where o.amount_cents > 0),0)::bigint as ca_payant
    from media_orders o join perimetre p on p.album_id = o.album_id
    where _media_stats_lien_compte(o.link_id, p_inclure_exclus)
      and o.status = 'paid' and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
    group by o.album_id
  ),
  vues as (
    select v.album_id, count(*)::integer as n
    from media_album_views v join perimetre p on p.album_id = v.album_id
    where _media_stats_lien_compte(v.link_id, p_inclure_exclus)
      and v.viewed_at >= p_debut and v.viewed_at < (p_fin + 1)
    group by v.album_id
  )
  select a.id, a.title, c.nom, a.event_date,
         coalesce(vues.n, 0), coalesce(cmd.n, 0), coalesce(cmd.ca, 0),
         case when cmd.n_payantes > 0 then (cmd.ca_payant / cmd.n_payantes)::integer end,
         case when coalesce(vues.n,0) > 0 then round(coalesce(cmd.n,0)::numeric * 100 / vues.n, 2) end
  from media_albums a
  join perimetre p on p.album_id = a.id
  left join cmd on cmd.album_id = a.id
  left join vues on vues.album_id = a.id
  left join clubs c on c.id = a.club_id
  -- Une galerie sans aucune vue NI commande sur la période n'apprend rien : on ne la liste pas.
  where coalesce(cmd.n, 0) > 0 or coalesce(vues.n, 0) > 0
  order by coalesce(cmd.ca, 0) desc, coalesce(vues.n, 0) desc
  limit greatest(1, least(coalesce(p_limit, 20), 200));
$$;

create or replace function media_stats_liens(p_album_id uuid, p_debut date, p_fin date,
  p_inclure_exclus boolean default false)
returns table (
  link_id uuid,
  label text,
  audience text,
  is_enabled boolean,
  visites integer,
  commandes integer,
  ca_cents bigint,
  taux_conversion numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with autorise as (select 1 from _media_stats_albums(p_inclure_exclus) where album_id = p_album_id),
  cmd as (
    select o.link_id, count(*)::integer as n, coalesce(sum(o.amount_cents),0)::bigint as ca
    from media_orders o
    where o.album_id = p_album_id and o.status = 'paid'
      and _media_stats_lien_compte(o.link_id, p_inclure_exclus)
      and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
    group by o.link_id
  ),
  vues as (
    select v.link_id, count(*)::integer as n from media_album_views v
    where v.album_id = p_album_id and _media_stats_lien_compte(v.link_id, p_inclure_exclus)
      and v.viewed_at >= p_debut and v.viewed_at < (p_fin + 1)
    group by v.link_id
  )
  select l.id, l.label, l.audience, l.is_enabled,
         coalesce(vues.n, 0), coalesce(cmd.n, 0), coalesce(cmd.ca, 0),
         case when coalesce(vues.n,0) > 0 then round(coalesce(cmd.n,0)::numeric * 100 / vues.n, 2) end
  from media_album_links l
  left join cmd on cmd.link_id = l.id
  left join vues on vues.link_id = l.id
  where l.album_id = p_album_id and exists (select 1 from autorise)
    and (coalesce(p_inclure_exclus, false) or not l.analytics_excluded)
  order by coalesce(cmd.ca, 0) desc, coalesce(vues.n, 0) desc;
$$;

create or replace function media_stats_offres(p_album_id uuid, p_debut date, p_fin date,
  p_inclure_exclus boolean default false)
returns table (
  offer_id uuid,
  nom text,
  type_offre text,
  photos_allowance integer,
  prix_actuel_cents integer,
  encore_proposee boolean,
  ventes integer,
  ca_cents bigint,
  part_des_commandes numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with autorise as (select 1 from _media_stats_albums(p_inclure_exclus) where album_id = p_album_id),
  cmd as (
    select o.offer_id, count(*)::integer as n, coalesce(sum(o.amount_cents),0)::bigint as ca
    from media_orders o
    where o.album_id = p_album_id and o.status = 'paid'
      and _media_stats_lien_compte(o.link_id, p_inclure_exclus)
      and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
    group by o.offer_id
  ),
  total as (select coalesce(sum(n),0)::integer as n from cmd)
  select
    cmd.offer_id,
    -- Le nom au catalogue si l'offre existe encore ; sinon on ne perd pas la ligne pour autant :
    -- une offre supprimée a quand même rapporté, et l'effacer des statistiques ferait disparaître
    -- du chiffre d'affaires réellement encaissé.
    coalesce(o.label, p.name, 'Offre supprimée'),
    p.type,
    o.photos_allowance,
    coalesce(o.price_override_cents, p.price_cents),
    (o.id is not null and o.is_enabled and p.status = 'active'),
    cmd.n, cmd.ca,
    case when (select n from total) > 0
         then round(cmd.n::numeric * 100 / (select n from total), 1) end
  from cmd
  left join media_album_link_offers o on o.id = cmd.offer_id
  left join media_products p on p.id = o.product_id
  where exists (select 1 from autorise)
  order by cmd.ca desc, cmd.n desc;
$$;

create or replace function media_stats_audiences(p_debut date, p_fin date,
  p_inclure_exclus boolean default false)
returns table (
  audience text,
  visites integer,
  commandes integer,
  ca_cents bigint,
  taux_conversion numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with perimetre as (select album_id from _media_stats_albums(p_inclure_exclus)),
  cmd as (
    select coalesce(l.audience, 'non_precise') as aud, count(*)::integer as n,
           coalesce(sum(o.amount_cents),0)::bigint as ca
    from media_orders o
    join perimetre p on p.album_id = o.album_id
    left join media_album_links l on l.id = o.link_id
    where _media_stats_lien_compte(o.link_id, p_inclure_exclus)
      and o.status = 'paid' and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
    group by 1
  ),
  vues as (
    select coalesce(l.audience, 'non_precise') as aud, count(*)::integer as n
    from media_album_views v
    join perimetre p on p.album_id = v.album_id
    left join media_album_links l on l.id = v.link_id
    where _media_stats_lien_compte(v.link_id, p_inclure_exclus)
      and v.viewed_at >= p_debut and v.viewed_at < (p_fin + 1)
    group by 1
  )
  select coalesce(cmd.aud, vues.aud),
         coalesce(vues.n, 0), coalesce(cmd.n, 0), coalesce(cmd.ca, 0),
         case when coalesce(vues.n,0) > 0 then round(coalesce(cmd.n,0)::numeric * 100 / vues.n, 2) end
  from cmd full outer join vues on vues.aud = cmd.aud
  order by coalesce(cmd.ca, 0) desc;
$$;

create or replace function media_stats_connect(p_debut date, p_fin date,
  p_inclure_exclus boolean default false)
returns table (
  acheteurs integer,
  acheteurs_connect integer,
  acheteurs_invites integer,
  taux_connect numeric,
  commandes_connect integer,
  commandes_invitees integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with perimetre as (select album_id from _media_stats_albums(p_inclure_exclus)),
  cmd as (
    select o.id, lower(coalesce(o.guest_email, '')) as mail, o.purchased_by_user_id
    from media_orders o
    join perimetre p on p.album_id = o.album_id
    where _media_stats_lien_compte(o.link_id, p_inclure_exclus)
      and o.status = 'paid' and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
  ),
  personnes as (
    select mail, bool_or(purchased_by_user_id is not null) as sur_connect
    from cmd where mail <> '' group by mail
  )
  select
    (select count(*)::integer from personnes),
    (select count(*)::integer from personnes where sur_connect),
    (select count(*)::integer from personnes where not sur_connect),
    case when (select count(*) from personnes) > 0
         then round((select count(*) from personnes where sur_connect)::numeric * 100
                    / (select count(*) from personnes), 1) end,
    (select count(*)::integer from cmd where purchased_by_user_id is not null),
    (select count(*)::integer from cmd where purchased_by_user_id is null);
$$;

create or replace function media_stats_evolution(p_debut date, p_fin date,
  p_inclure_exclus boolean default false)
returns table (jour date, ca_cents bigint, commandes integer, visites integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with perimetre as (select album_id from _media_stats_albums(p_inclure_exclus)),
  jours as (select generate_series(p_debut, p_fin, interval '1 day')::date as j),
  cmd as (
    select o.paid_at::date as j, count(*)::integer as n, coalesce(sum(o.amount_cents),0)::bigint as ca
    from media_orders o join perimetre p on p.album_id = o.album_id
    where _media_stats_lien_compte(o.link_id, p_inclure_exclus)
      and o.status = 'paid' and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
    group by 1
  ),
  vues as (
    select v.viewed_at::date as j, count(*)::integer as n
    from media_album_views v join perimetre p on p.album_id = v.album_id
    where _media_stats_lien_compte(v.link_id, p_inclure_exclus)
      and v.viewed_at >= p_debut and v.viewed_at < (p_fin + 1)
    group by 1
  )
  -- Les jours sans vente sont rendus a zero et non omis : une courbe qui saute les jours creux
  -- laisse croire a une activite continue.
  select jours.j, coalesce(cmd.ca, 0), coalesce(cmd.n, 0), coalesce(vues.n, 0)
  from jours
  left join cmd on cmd.j = jours.j
  left join vues on vues.j = jours.j
  order by jours.j;
$$;

grant execute on function media_stats_resume(date, date, boolean) to authenticated;
grant execute on function media_stats_galeries(date, date, integer, boolean) to authenticated;
grant execute on function media_stats_liens(uuid, date, date, boolean) to authenticated;
grant execute on function media_stats_offres(uuid, date, date, boolean) to authenticated;
grant execute on function media_stats_audiences(date, date, boolean) to authenticated;
grant execute on function media_stats_connect(date, date, boolean) to authenticated;
grant execute on function media_stats_evolution(date, date, boolean) to authenticated;

commit;
