-- Migration : Galeries — statistiques commerciales
-- À exécuter APRÈS migration-galeries-v20-album-id-commande.sql.
--
-- ── Le principe ──
-- AUCUN compteur métier n'est créé. Tout est agrégé depuis les commandes et les vues réelles, à la
-- lecture. Un chiffre d'affaires stocké dans une table d'analytics finit toujours par diverger de
-- la caisse — et c'est le genre d'écart qu'on ne découvre qu'en préparant un bilan.
--
-- ── Ce que les données permettent vraiment de dire ──
-- L'audit a montré trois limites, et on les nomme au lieu de les masquer :
--
--   1. REMBOURSEMENTS. `media_orders.status` accepte 'refunded' et la colonne `refunded_at`
--      existe, mais le webhook `charge.refunded` ne touchait QUE `paiements`/`prestations` :
--      aucune commande galerie n'a jamais été marquée remboursée. C'est corrigé dans ce lot
--      (webhook), donc la donnée devient fiable À PARTIR de maintenant. Les remboursements
--      antérieurs, s'il y en avait, sont invisibles — mais il n'y a eu qu'une commande payée.
--
--   2. VISITEURS. `media_album_views.visitor_hash` est un hachage de l'identifiant de SESSION du
--      navigateur. La même personne depuis son téléphone puis son ordinateur compte deux fois ;
--      celle qui vide son stockage aussi. On parle donc de VISITES, jamais de « visiteurs
--      uniques » — le mot serait faux, et un taux de conversion bâti dessus le serait aussi.
--
--   3. DONNÉES DE TEST. Rien ne distingue une galerie de test d'une vraie. On n'invente pas
--      d'heuristique sur le mot « test » : tout est compté, et c'est dit.
--
-- ── Le chiffre d'affaires ──
-- Uniquement des commandes `paid`. Une session Stripe créée mais jamais payée reste `pending` et
-- ne compte pas. Une offre gratuite compte comme une COMMANDE mais pour 0 € de CA : mélanger les
-- deux ferait chuter le panier moyen à chaque campagne offerte, et donnerait l'impression que les
-- ventes s'effondrent.

begin;

-- ── Index pour les agrégations par période ─────────────────────────────────────────────────
-- Partiel sur `paid` : c'est le seul statut que les statistiques lisent, et l'index reste petit.
create index if not exists idx_mord_paid_at on media_orders (paid_at desc) where status = 'paid';
create index if not exists idx_mord_offer on media_orders (offer_id) where offer_id is not null;
create index if not exists idx_maviews_link_date on media_album_views (link_id, viewed_at desc);
create index if not exists idx_maviews_album_date on media_album_views (album_id, viewed_at desc);

-- ── Qui a le droit de voir du chiffre d'affaires ───────────────────────────────────────────
-- On ne réécrit pas les règles financières : media_commerce_staff (admin, secrétariat,
-- comptabilité) et is_pole_responsable existent et servent déjà ailleurs. On les combine.
--
-- Un responsable de pôle ne voit QUE son pôle. Un album sans pôle n'est visible d'aucun
-- responsable de pôle — jamais de tous, ce serait l'inverse de l'intention.
create or replace function media_stats_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin','prod','sec','compta')
  )
  or exists (
    select 1 from pole_affectations pa
    where pa.user_id = auth.uid() and pa.role_pole = 'responsable' and pa.actif
  );
$$;

comment on function media_stats_access is
  'Peut consulter les statistiques commerciales des galeries. Un responsable de pôle y a accès mais ne verra que SES albums : le filtrage par pôle est fait dans chaque fonction, pas ici.';

grant execute on function media_stats_access() to authenticated;

-- ── Le périmètre visible par l'appelant ────────────────────────────────────────────────────
-- Une seule définition du « quels albums ai-je le droit de compter », relue par toutes les
-- fonctions de statistiques. Deux définitions donneraient deux totaux différents sur le même
-- écran, et c'est exactement le genre d'incohérence qui décrédibilise un tableau de bord.
create or replace function _media_stats_albums()
returns table (album_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id
  from media_albums a
  where
    -- Transversal : direction, production, secrétariat, comptabilité.
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','prod','sec','compta'))
    -- Responsable de pôle : uniquement les albums de SON pôle. `pole_id` d'abord, celui de la
    -- mission en repli — et un album sans pôle ne remonte pour personne.
    or (
      coalesce(a.pole_id, (select pr.pole_id from prestations pr where pr.id = a.mission_id)) is not null
      and exists (
        select 1 from pole_affectations pa
        where pa.user_id = auth.uid()
          and pa.role_pole = 'responsable'
          and pa.actif
          and pa.pole_id = coalesce(a.pole_id, (select pr.pole_id from prestations pr where pr.id = a.mission_id))
      )
    );
$$;

-- ── 1. Les grands nombres, sur une période ─────────────────────────────────────────────────
create or replace function media_stats_resume(p_debut date, p_fin date)
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
  with perimetre as (select album_id from _media_stats_albums()),
  cmd as (
    select o.* from media_orders o
    join perimetre p on p.album_id = o.album_id
    where o.status = 'paid'
      and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
  ),
  remb as (
    select o.amount_cents from media_orders o
    join perimetre p on p.album_id = o.album_id
    where o.status = 'refunded'
      and o.refunded_at >= p_debut and o.refunded_at < (p_fin + 1)
  ),
  vues as (
    select count(*)::integer as n from media_album_views v
    join perimetre p on p.album_id = v.album_id
    where v.viewed_at >= p_debut and v.viewed_at < (p_fin + 1)
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

comment on function media_stats_resume is
  'Grands nombres des galeries sur une période. CA = commandes payées uniquement ; une offre gratuite compte comme commande mais pour 0 €. Le taux de conversion se lit « commandes pour 100 VISITES » : le dénominateur compte des sessions, pas des personnes.';

grant execute on function media_stats_resume(date, date) to authenticated;

-- ── 2. Classement des galeries ─────────────────────────────────────────────────────────────
create or replace function media_stats_galeries(p_debut date, p_fin date, p_limit integer default 20)
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
  with perimetre as (select album_id from _media_stats_albums()),
  cmd as (
    select o.album_id, count(*)::integer as n, coalesce(sum(o.amount_cents),0)::bigint as ca,
           count(*) filter (where o.amount_cents > 0)::integer as n_payantes,
           coalesce(sum(o.amount_cents) filter (where o.amount_cents > 0),0)::bigint as ca_payant
    from media_orders o join perimetre p on p.album_id = o.album_id
    where o.status = 'paid' and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
    group by o.album_id
  ),
  vues as (
    select v.album_id, count(*)::integer as n
    from media_album_views v join perimetre p on p.album_id = v.album_id
    where v.viewed_at >= p_debut and v.viewed_at < (p_fin + 1)
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

grant execute on function media_stats_galeries(date, date, integer) to authenticated;

-- ── 3. Performance des liens d'un album ────────────────────────────────────────────────────
create or replace function media_stats_liens(p_album_id uuid, p_debut date, p_fin date)
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
  with autorise as (select 1 from _media_stats_albums() where album_id = p_album_id),
  cmd as (
    select o.link_id, count(*)::integer as n, coalesce(sum(o.amount_cents),0)::bigint as ca
    from media_orders o
    where o.album_id = p_album_id and o.status = 'paid'
      and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
    group by o.link_id
  ),
  vues as (
    select v.link_id, count(*)::integer as n from media_album_views v
    where v.album_id = p_album_id and v.viewed_at >= p_debut and v.viewed_at < (p_fin + 1)
    group by v.link_id
  )
  select l.id, l.label, l.audience, l.is_enabled,
         coalesce(vues.n, 0), coalesce(cmd.n, 0), coalesce(cmd.ca, 0),
         case when coalesce(vues.n,0) > 0 then round(coalesce(cmd.n,0)::numeric * 100 / vues.n, 2) end
  from media_album_links l
  left join cmd on cmd.link_id = l.id
  left join vues on vues.link_id = l.id
  where l.album_id = p_album_id and exists (select 1 from autorise)
  order by coalesce(cmd.ca, 0) desc, coalesce(vues.n, 0) desc;
$$;

comment on function media_stats_liens is
  'Performance de chaque lien d''un album. L''attribution vient de media_orders.link_id, c''est-à-dire le lien qui a réellement créé le paiement — pas le dernier lien consulté.';

grant execute on function media_stats_liens(uuid, date, date) to authenticated;

-- ── 4. Performance des offres d'un album ───────────────────────────────────────────────────
-- LE point délicat : une offre change de prix dans le temps. Le CA est donc TOUJOURS la somme des
-- montants réellement encaissés (media_orders.amount_cents), jamais « ventes × prix actuel ».
-- Le prix courant est renvoyé à part, pour information, et n'entre dans aucun calcul.
create or replace function media_stats_offres(p_album_id uuid, p_debut date, p_fin date)
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
  with autorise as (select 1 from _media_stats_albums() where album_id = p_album_id),
  cmd as (
    select o.offer_id, count(*)::integer as n, coalesce(sum(o.amount_cents),0)::bigint as ca
    from media_orders o
    where o.album_id = p_album_id and o.status = 'paid'
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

comment on function media_stats_offres is
  'Ventes par offre. Le CA est la somme des montants RÉELLEMENT encaissés : une offre passée de 10 à 12 € garde ses anciennes ventes à 10 €. `prix_actuel_cents` est indicatif et n''entre dans aucun calcul.';

grant execute on function media_stats_offres(uuid, date, date) to authenticated;

-- ── 5. Par audience, sur tout le périmètre ─────────────────────────────────────────────────
-- Les audiences sont lues depuis les données : aucune colonne codée pour « club partenaire » et
-- « équipe adverse ». Une nouvelle audience apparaît toute seule le jour où elle est utilisée.
create or replace function media_stats_audiences(p_debut date, p_fin date)
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
  with perimetre as (select album_id from _media_stats_albums()),
  cmd as (
    select coalesce(l.audience, 'non_precise') as aud, count(*)::integer as n,
           coalesce(sum(o.amount_cents),0)::bigint as ca
    from media_orders o
    join perimetre p on p.album_id = o.album_id
    left join media_album_links l on l.id = o.link_id
    where o.status = 'paid' and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
    group by 1
  ),
  vues as (
    select coalesce(l.audience, 'non_precise') as aud, count(*)::integer as n
    from media_album_views v
    join perimetre p on p.album_id = v.album_id
    left join media_album_links l on l.id = v.link_id
    where v.viewed_at >= p_debut and v.viewed_at < (p_fin + 1)
    group by 1
  )
  select coalesce(cmd.aud, vues.aud),
         coalesce(vues.n, 0), coalesce(cmd.n, 0), coalesce(cmd.ca, 0),
         case when coalesce(vues.n,0) > 0 then round(coalesce(cmd.n,0)::numeric * 100 / vues.n, 2) end
  from cmd full outer join vues on vues.aud = cmd.aud
  order by coalesce(cmd.ca, 0) desc;
$$;

grant execute on function media_stats_audiences(date, date) to authenticated;

-- ── 6. Invité contre Connect ───────────────────────────────────────────────────────────────
-- On compte des ACHETEURS, pas des commandes : quelqu'un qui achète trois fois ne doit pas peser
-- trois fois dans un taux de conversion vers Connect. L'adresse sert de clé, faute de mieux —
-- c'est aussi elle qui sert au rattachement.
create or replace function media_stats_connect(p_debut date, p_fin date)
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
  with perimetre as (select album_id from _media_stats_albums()),
  cmd as (
    select o.id, lower(coalesce(o.guest_email, '')) as mail, o.purchased_by_user_id
    from media_orders o
    join perimetre p on p.album_id = o.album_id
    where o.status = 'paid' and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
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

comment on function media_stats_connect is
  'Part des acheteurs qui ont un compte Connect. Compte des PERSONNES (par adresse) et non des commandes : quelqu''un qui achète trois fois ne doit pas peser trois fois dans le taux.';

grant execute on function media_stats_connect(date, date) to authenticated;

-- ── 7. Évolution, pour le graphique ────────────────────────────────────────────────────────
create or replace function media_stats_evolution(p_debut date, p_fin date)
returns table (jour date, ca_cents bigint, commandes integer, visites integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with perimetre as (select album_id from _media_stats_albums()),
  jours as (select generate_series(p_debut, p_fin, interval '1 day')::date as j),
  cmd as (
    select o.paid_at::date as j, count(*)::integer as n, coalesce(sum(o.amount_cents),0)::bigint as ca
    from media_orders o join perimetre p on p.album_id = o.album_id
    where o.status = 'paid' and o.paid_at >= p_debut and o.paid_at < (p_fin + 1)
    group by 1
  ),
  vues as (
    select v.viewed_at::date as j, count(*)::integer as n
    from media_album_views v join perimetre p on p.album_id = v.album_id
    where v.viewed_at >= p_debut and v.viewed_at < (p_fin + 1)
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

grant execute on function media_stats_evolution(date, date) to authenticated;

commit;
