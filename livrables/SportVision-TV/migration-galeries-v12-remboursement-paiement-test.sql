-- Le paiement de test du 07/09/2026 est rembourse. Rien n'est supprime.
--
-- DECISION DE FOUKA, 10/09/2026 : « rembourse-les via Stripe. On garde evidemment les commandes et
-- le remboursement dans l'historique, on ne supprime rien en base. Ca permet de repartir avec une
-- comptabilite propre sans effacer la trace technique. »
--
-- CE QUI A ETE FAIT COTE STRIPE, avant ce fichier :
--   payment_intent  pi_3UD89xCWWD3TQ2oU0MHkCjLT   livemode: true, 4,00 EUR, succeeded
--   remboursement   pyr_1UE4wgCWWD3TQ2oUwvOD2ZvE  4,00 EUR, succeeded, 10/09/2026 10:11 UTC
--
-- Les trois autres commandes « payees » sont a 0,00 EUR : elles validaient l'offre gratuite et ne
-- representent aucun mouvement d'argent. Il n'y a rien a leur rembourser, et elles restent en
-- l'etat — les marquer « refunded » serait faux.
--
-- La ligne passe donc de 'paid' a 'refunded' avec sa date, et l'identifiant du remboursement est
-- conserve dans la trace ci-dessous : media_orders n'a pas de colonne pour lui, et en ajouter une
-- pour un cas unique encombrerait le modele.

begin;

create table if not exists public.media_orders_remboursements (
  order_id          uuid primary key references public.media_orders(id),
  stripe_refund_id  text not null,
  montant_cents     integer not null,
  motif             text,
  rembourse_le      timestamptz not null default now()
);

comment on table public.media_orders_remboursements is
  'Trace des remboursements Stripe rattaches a une commande. La commande n''est jamais supprimee : '
  'elle passe en statut « refunded » et garde toutes ses lignes.';

insert into public.media_orders_remboursements (order_id, stripe_refund_id, montant_cents, motif, rembourse_le)
select o.id, 'pyr_1UE4wgCWWD3TQ2oUwvOD2ZvE', 400,
       'Paiement de test du 07/09/2026 (galerie « Test paiement — U18 »), rembourse sur decision de Fouka pour repartir sur une comptabilite propre.',
       '2026-09-10 10:11:06+00'
  from public.media_orders o
 where o.stripe_payment_intent_id = 'pi_3UD89xCWWD3TQ2oU0MHkCjLT'
on conflict (order_id) do nothing;

update public.media_orders
   set status = 'refunded', refunded_at = '2026-09-10 10:11:06+00'
 where stripe_payment_intent_id = 'pi_3UD89xCWWD3TQ2oU0MHkCjLT'
   and status = 'paid';

commit;

-- ── Verification : la trace technique est intacte, l'argent est rendu ────────
select 'commandes conservees' as controle, count(*)::text as valeur from media_orders
union all
select 'lignes de commande conservees', count(*)::text from media_order_items
union all
select 'droits de telechargement conserves', count(*)::text from media_download_grants
union all
select 'commandes remboursees', count(*)::text from media_orders where status = 'refunded'
union all
select 'montant encore encaisse', to_char(coalesce(sum(amount_cents),0)/100.0,'FM999999990.00')
  from media_orders where status = 'paid';
