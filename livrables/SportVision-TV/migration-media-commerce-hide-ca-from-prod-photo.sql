-- Finding P1 sécurité (audit transversal, confirmé en Phase 3 + G42/H) : `is_staff()` inclut
-- 'prod' ET 'photo' (pas seulement 'admin'), et les policies mord_staff_all/ment_staff_all sur
-- media_orders/media_entitlements donnaient un accès FOR ALL total à quiconque passe is_staff() —
-- un compte prod/photo pouvait donc lire amount_cents/purchased_by_user_id de N'IMPORTE QUELLE
-- commande. Décision de Fouka (04/09/2026, suite au rapport intermédiaire) : fermer cet accès.
--
-- Vérifié avant de coder : media_staff_write() (garde de staff_mark_media_order_shipped, le seul
-- vrai chemin d'écriture opérationnel pour l'expédition physique) restreint DÉJÀ l'écriture à
-- role in ('admin','sec') — prod/photo n'ont jamais eu besoin d'un accès table direct pour cette
-- fonctionnalité, la RPC SECURITY DEFINER suffit. v_media_orders_a_expedier (la vue staff pour la
-- file d'expédition) exposait elle aussi amount_cents en clair à tout is_staff() — corrigée pour
-- ne garder que ce qui sert réellement à préparer un colis (nom/adresse/produit), jamais le CA.

create or replace function media_commerce_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'compta'));
$function$;

comment on function media_commerce_staff() is 'Rôles autorisés à voir le CA/l''identité acheteur des commandes médias (amount_cents, purchased_by_user_id) — délibérément plus étroit que is_staff() : prod/photo/cm en sont exclus (finding P1 audit transversal 04/09/2026), ils n''ont jamais eu besoin de cet accès pour leurs missions réelles.';

drop policy if exists "mord_staff_all" on media_orders;
create policy "mord_staff_all" on media_orders for all using (media_commerce_staff()) with check (media_commerce_staff());

drop policy if exists "ment_staff_all" on media_entitlements;
create policy "ment_staff_all" on media_entitlements for all using (media_commerce_staff()) with check (media_commerce_staff());

-- v_media_orders_a_expedier : garde is_staff() (prod/photo doivent toujours voir la file
-- d'expédition pour préparer/envoyer les colis), retire uniquement amount_cents — jamais utile
-- pour emballer un colis, c'est exactement la donnée à cacher. DROP requis : CREATE OR REPLACE ne
-- permet pas de retirer une colonne existante.
drop view if exists v_media_orders_a_expedier;
create view v_media_orders_a_expedier as
select
  mo.id,
  mo.club_id,
  c.nom as club_nom,
  mp.name as produit_nom,
  mo.shipping_name,
  mo.shipping_address_line,
  mo.shipping_postal_code,
  mo.shipping_city,
  mo.paid_at,
  mo.created_at
from media_orders mo
join media_products mp on mp.id = mo.product_id
join clubs c on c.id = mo.club_id
where mo.status = 'paid' and mo.shipping_status = 'a_preparer' and is_staff()
order by mo.paid_at, mo.created_at;
