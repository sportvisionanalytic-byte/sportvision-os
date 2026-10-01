-- v383 — LES VENTES ET LE CHIFFRE D'AFFAIRES NE SONT PAS OUVERTS À UN OPÉRATEUR (01/10/2026)
--
-- ═══ LE PROBLÈME, MESURÉ ═══════════════════════════════════════════════════════════════════════
--
-- Trouvé en mesurant les droits avant d'écrire l'onglet « Ventes » de l'application de l'OS.
-- Deux fonctions de la famille `media_stats_*` sont gardées par `is_staff()`, et `is_staff()` est
-- VRAI pour un opérateur terrain : son rôle `photo` est dans la liste
-- ('admin','sec','prod','photo','cm','compta','com','rh').
--
-- Mesuré par le chemin réel, en transaction annulée, avec les claims d'Antoine Blin (rôle photo,
-- 5 missions, 0 galerie visible, 0 ligne dans `media_orders`) :
--
--     select count(*) from media_stats_ventes('2026-01-01','2026-12-31',false,500)  →  12
--     select count(*) from media_performance_galeries(365)                          →  57
--
-- Douze ventes avec le NOM DE L'ACHETEUR, le montant, la formule et la galerie. Et les 57 galeries
-- avec leur chiffre d'affaires, leur panier moyen et leur taux de conversion. Pour quelqu'un à qui
-- la base refuse par ailleurs toute ligne de `media_orders` (policy `mord_prod_select` : rôle prod ;
-- `mord_staff_all` : `media_commerce_staff()` = admin/sec/compta — un `photo` n'est ni l'un ni
-- l'autre, il reçoit ZÉRO ligne).
--
-- Ces deux fonctions sont SECURITY DEFINER et exécutables par `authenticated` : le refus de la
-- table est donc contourné par la porte de service, et par elle seule.
--
-- ═══ POURQUOI LES AUTRES FONCTIONS DE LA FAMILLE NE SONT PAS CONCERNÉES ════════════════════════
--
-- Parce qu'elles ne demandent pas `is_staff()` : leur périmètre passe par `_media_stats_albums()`,
-- qui n'ouvre qu'à admin/prod/sec/compta et au responsable du pôle de la galerie. Mesuré avec les
-- mêmes claims d'Antoine :
--
--     select count(*) from _media_stats_albums(false)                    →  0
--     select ca_cents, commandes, visites from media_stats_resume(…)     →  0, 0, 0
--     select count(*) from media_stats_galeries(…)                       →  0
--     select count(*) from media_album_links_stats(<galerie vendeuse>)   →  0
--
-- `media_album_links_stats` est d'ailleurs le modèle : `where media_pricing_staff()` pour la ligne,
-- et `case when media_revenus_visibles() then … end` pour les deux colonnes d'argent. Deux droits
-- distincts, tenus par la base. Les deux fonctions corrigées ici n'avaient ni l'un ni l'autre.
--
-- ═══ CE QUE CETTE MIGRATION CHANGE, ET RIEN D'AUTRE ════════════════════════════════════════════
--
-- Une ligne dans chacune : `where is_staff()` devient `where media_stats_access()`, la fonction qui
-- garde déjà le reste de l'écran « Statistiques » (admin, prod, sec, compta, et le responsable de
-- pôle actif). Le corps, les colonnes, l'ordre et les bornes ne bougent pas.
--
-- `media_stats_access()` ET PAS `media_revenus_visibles()`, qui serait plus strict : le Secrétariat
-- voit déjà le chiffre d'affaires par `media_stats_resume` (il est dans `_media_stats_albums`). Le
-- fermer ici et pas là aurait fabriqué deux vérités pour la même personne sur le même écran.
--
-- LA SIGNATURE EST RECOPIÉE À L'IDENTIQUE, défauts compris. Leçon du 26/09 : `create or replace`
-- avec un argument par défaut qui change ne REMPLACE pas, il SURCHARGE — et c'est l'ancienne
-- version qui continue de répondre aux appels existants.
--
-- ═══ QUI PERD QUELQUE CHOSE ════════════════════════════════════════════════════════════════════
--
-- Un opérateur terrain, un CM, la communication et les RH : ils voyaient ces deux listes sans les
-- avoir demandées. Aucun écran de l'écosystème ne les leur sert : `media_stats_ventes` n'est appelée
-- que par l'écran « Statistiques » de l'OS (réservé à ces quatre rôles) et par l'onglet « Ventes »
-- de l'application, qui demande `media_revenus_visibles()` avant d'exister.
-- `media_performance_galeries` n'est appelée par AUCUN écran : vérifié sur tout le dossier
-- `livrables/`, elle n'apparaît que dans sa propre migration (v244).

-- ── 1. La liste des ventes ────────────────────────────────────────────────────────────────────
create or replace function public.media_stats_ventes(
  p_debut date,
  p_fin date,
  p_inclure_exclus boolean default false,
  p_limit integer default 100
)
returns table(
  commande_id uuid, paye_le timestamp with time zone, album_id uuid, galerie text, club text,
  formule text, montant_cents integer, photos_incluses integer, acheteur text, rembourse boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select o.id,
         o.paid_at,
         o.album_id,
         coalesce(a.title, 'Galerie supprimée'),
         coalesce(c.nom, nullif(btrim(coalesce(a.structure_externe, '')), ''), 'Sans club'),
         -- Ce qui a été acheté : l'intitulé de la formule du lien s'il y en a une, sinon le nom
         -- du produit (Pass Photo, pack), sinon le nombre de photos. Dans cet ordre, parce que
         -- c'est celui que l'acheteur a vu au moment de payer.
         coalesce(
           nullif(btrim(coalesce(f.label, '')), ''),
           nullif(btrim(coalesce(pr.name, '')), ''),
           case when o.photos_allowance is not null
                then o.photos_allowance || ' photo' || case when o.photos_allowance > 1 then 's' else '' end
                else 'Galerie complète' end
         ),
         o.amount_cents,
         o.photos_allowance,
         -- L'acheteur, au minimum utile. Un compte supprimé ne laisse rien derrière lui.
         case
           when o.acheteur_supprime_le is not null then 'Compte supprimé'
           when o.guest_name is not null and btrim(o.guest_name) <> '' then btrim(o.guest_name)
           when o.guest_email is not null and btrim(o.guest_email) <> '' then btrim(o.guest_email)
           when o.purchased_by_user_id is not null then
             coalesce(nullif(btrim(coalesce(pp.prenom, '') || ' ' || coalesce(left(pp.nom, 1), '')), ''), 'Compte Connect')
           else '—'
         end,
         o.refunded_at is not null
    from media_orders o
    left join media_albums a on a.id = o.album_id
    left join clubs c on c.id = a.club_id
    left join media_album_link_offers f on f.id = o.offer_id
    left join media_products pr on pr.id = o.product_id
    left join player_profiles pp on pp.user_id = o.purchased_by_user_id
   -- v383 : `is_staff()` ouvrait cette liste à un opérateur terrain, à un CM, à la communication et
   -- aux RH. Le nom de l'acheteur et le montant payé ne sont pas des données de terrain.
   where media_stats_access()
     and o.status = 'paid'
     and o.paid_at is not null
     -- Les bornes se comparent en heure de Paris : lues en UTC, « aujourd'hui » montre la veille
     -- tant qu'il est moins de 2 h. Même règle que partout ailleurs dans cet écran.
     and (o.paid_at at time zone 'Europe/Paris')::date between p_debut and p_fin
     and (coalesce(p_inclure_exclus, false)
          or coalesce(a.analytics_excluded, false) = false)
   order by o.paid_at desc
   limit greatest(coalesce(p_limit, 100), 1);
$function$;

-- ── 2. La performance des galeries ────────────────────────────────────────────────────────────
create or replace function public.media_performance_galeries(p_jours integer default 180)
returns table(
  album_id uuid, titre text, club_id uuid, club text, date_evenement date,
  publiee_le timestamp with time zone, photos integer, vues integer, visiteurs integer,
  commandes integer, ca_cents bigint, panier_moyen_cents bigint, conversion numeric,
  acces_offerts integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
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
   -- v383 : même correction que `media_stats_ventes`. Cette fonction n'est appelée par aucun écran
   -- aujourd'hui ; elle rendait pourtant le chiffre d'affaires des 57 galeries à qui le demandait.
   where media_stats_access()
   order by coalesce(s.ca, 0) desc, coalesce(v.visiteurs, 0) desc;
$function$;
