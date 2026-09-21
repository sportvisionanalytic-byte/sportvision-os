-- « Je ne sais même pas quelle galerie a été payée » (21/09/2026)
--
-- RETOUR DE FOUKA, écran Statistiques des galeries : « le tableau, la galerie la plus performante,
-- je vois mal. Je ne sais même pas quelle prestation a été payée, quelle galerie a été payée. »
--
-- L'écran donnait des AGRÉGATS : chiffre d'affaires, commandes, conversion, et un classement des
-- galeries. Tout était juste, et il manquait pourtant la seule chose qu'on cherche en ouvrant des
-- statistiques de vente : la liste des ventes. Un total de 70 € ne dit pas qui a payé quoi, ni
-- quand, ni pour quelle galerie — et c'est précisément ce qu'on veut vérifier quand on doute d'un
-- chiffre. Aucune fonction ne la renvoyait, aucun écran ne pouvait donc l'afficher.
--
-- Une ligne par commande payée : la date, la galerie, la formule achetée, le montant, et qui.
-- « Qui » se limite au strict nécessaire : le prénom du compte Connect, ou l'adresse d'un achat
-- sans compte. Un écran de statistiques n'a pas à devenir un annuaire des acheteurs.

begin;

create or replace function public.media_stats_ventes(
  p_debut date,
  p_fin date,
  p_inclure_exclus boolean default false,
  p_limit int default 100
)
returns table (
  commande_id uuid, paye_le timestamptz, album_id uuid, galerie text,
  club text, formule text, montant_cents int, photos_incluses int,
  acheteur text, rembourse boolean
)
language sql
stable security definer
set search_path to 'public'
as $$
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
   where is_staff()
     and o.status = 'paid'
     and o.paid_at is not null
     -- Les bornes se comparent en heure de Paris : lues en UTC, « aujourd'hui » montre la veille
     -- tant qu'il est moins de 2 h. Même règle que partout ailleurs dans cet écran.
     and (o.paid_at at time zone 'Europe/Paris')::date between p_debut and p_fin
     and (coalesce(p_inclure_exclus, false)
          or coalesce(a.analytics_excluded, false) = false)
   order by o.paid_at desc
   limit greatest(coalesce(p_limit, 100), 1);
$$;

revoke all on function public.media_stats_ventes(date, date, boolean, int) from public;
grant execute on function public.media_stats_ventes(date, date, boolean, int) to authenticated;

comment on function public.media_stats_ventes(date, date, boolean, int) is
  'La liste des ventes de galeries, une ligne par commande payée. Staff SportVision uniquement.';

commit;
