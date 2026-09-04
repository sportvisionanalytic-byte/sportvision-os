-- Fulfillment produit physique (04/09/2026, prompt #8 backlog Club+ V2, décision Fouka : "choisis
-- pour moi") — jusqu'ici media_products.physical_product/type='physique' existaient au schéma et
-- dans l'écran OS (case à cocher) mais rien nulle part ne collectait ni n'exposait une adresse de
-- livraison : un club pouvait créer et vendre un produit physique sans qu'aucune commande ne
-- porte jamais l'adresse nécessaire pour l'expédier. Périmètre choisi (le prompt d'origine ne
-- précisait pas qui gère l'expédition) : SportVision fabrique/expédie elle-même (tirages photo,
-- objets) — pas d'intégration transporteur, juste collecter l'adresse à l'achat et donner à
-- l'équipe SportVision une liste de ce qui reste à expédier.

alter table media_orders add column if not exists shipping_name text;
alter table media_orders add column if not exists shipping_address_line text;
alter table media_orders add column if not exists shipping_postal_code text;
alter table media_orders add column if not exists shipping_city text;
alter table media_orders add column if not exists shipping_status text not null default 'non_requis'
  check (shipping_status in ('non_requis', 'a_preparer', 'expedie'));
alter table media_orders add column if not exists shipped_at timestamptz;

comment on column media_orders.shipping_status is 'non_requis = produit non physique (valeur par défaut, jamais à traiter) ; a_preparer = adresse collectée, en attente d''expédition ; expedie = envoyé par l''équipe SportVision (staff_mark_media_order_shipped).';

-- Le webhook Stripe (branche media_pass) ne touche jamais ces colonnes — elles sont écrites par
-- create-pass-photo-checkout/create-guest-media-checkout AVANT la création de la session Stripe
-- (comme amount_cents/beneficiary_person_id), jamais après coup.

create or replace function public.staff_mark_media_order_shipped(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not media_staff_write() then
    raise exception 'Non autorisé';
  end if;
  update media_orders
  set shipping_status = 'expedie', shipped_at = now()
  where id = p_order_id and shipping_status = 'a_preparer';
end;
$$;
comment on function public.staff_mark_media_order_shipped(uuid) is 'Marque une commande physique comme expédiée — Admin/Secrétaire uniquement (media_staff_write, même garde que la configuration du moteur média). No-op silencieux si la commande n''est pas en attente d''expédition (déjà expédiée, ou pas un produit physique).';

grant execute on function public.staff_mark_media_order_shipped(uuid) to authenticated;

-- Lecture staff des commandes à expédier — patron déjà établi par v_calendar_global
-- (migration-calendrier-global-v1.sql) : une vue Postgres standard N'HÉRITE PAS automatiquement
-- des policies RLS des tables sources quand son propriétaire (rôle migration) bypass RLS — filtre
-- d'autorisation ajouté manuellement dans la vue elle-même, jamais une confiance dans mord_staff_all.
create or replace view public.v_media_orders_a_expedier as
select
  mo.id, mo.club_id, c.nom as club_nom, mp.name as produit_nom,
  mo.shipping_name, mo.shipping_address_line, mo.shipping_postal_code, mo.shipping_city,
  mo.amount_cents, mo.currency, mo.paid_at, mo.created_at
from media_orders mo
join media_products mp on mp.id = mo.product_id
join clubs c on c.id = mo.club_id
where mo.status = 'paid' and mo.shipping_status = 'a_preparer' and is_staff()
order by mo.paid_at asc nulls last, mo.created_at asc;

comment on view public.v_media_orders_a_expedier is 'Commandes de produits physiques payées, en attente d''expédition — écran OS (Admin/Secrétaire). Filtre is_staff() manuel (les vues ne recopient pas la RLS des tables sources), voir v_calendar_global pour le même patron.';

revoke insert, update, delete, truncate on public.v_media_orders_a_expedier from authenticated, anon;
grant select on public.v_media_orders_a_expedier to authenticated;
