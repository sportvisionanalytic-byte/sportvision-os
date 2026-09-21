-- v239 — « Paiement resté en attente » alertait sur des paniers abandonnés.
--
-- SIGNALÉ PAR FOUKA, 21/09/2026 : l'écran de santé annonçait « Paiement resté en attente depuis
-- plus de 24 h · 3 cas », avec trois adresses de vrais clients. Fouka a cru que trois personnes
-- avaient payé sans recevoir leurs photos.
--
-- CE QU'ÉTAIENT CES TROIS CAS. Deux personnes qui ont ouvert la page de paiement, l'ont fermée,
-- et sont revenues quelques minutes plus tard prendre une formule moins chère :
--   · mikejojo52 — 16 h 35 abandon de 5 €, 16 h 39 PAYÉ 5 €, 16 h 40 e-mail parti ;
--   · maherghzayel0 — 8 h 18 abandon de 5 €, 8 h 19 abandon de 20 €, 8 h 21 PAYÉ 5 €.
-- Aucun des deux n'a été lésé. Les lignes « en attente » sont leurs paniers abandonnés : Stripe
-- ne les a jamais encaissées, et aucune session de paiement n'a même été créée pour elles.
--
-- POURQUOI C'EST GRAVE QU'UNE ALERTE CRIE POUR RIEN. Une alerte qu'on apprend à ignorer ne sert
-- plus à rien le jour où elle a raison. Le VRAI cas — quelqu'un qui a payé chez Stripe et dont
-- la commande est restée bloquée — se noierait dans le bruit des paniers abandonnés, alors que
-- c'est précisément celui qui doit réveiller quelqu'un la nuit.
--
-- LA DISTINCTION, et elle est nette : une commande en attente SANS session de paiement Stripe
-- n'a jamais été payée. C'est un panier abandonné, le lot commun de toute vente en ligne. Une
-- commande en attente AVEC une session de paiement est la seule qui mérite un regard : soit le
-- client a payé et le webhook n'a pas fait son travail, soit il a abandonné en cours de route.
--
-- Deux lignes distinctes, donc, avec deux niveaux différents — et les paniers abandonnés ne
-- remontent qu'au bout de 7 jours, en information, jamais en alerte.
--
-- Idempotent : seule la fonction de santé change, aucune donnée n'est touchée.

create or replace function media_sante()
returns table(gravite text, domaine text, probleme text, nombre integer, detail jsonb)
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not media_pricing_staff() then
    return;
  end if;

  return query
  select 'critique', 'Livraison', 'Commande payée sans accès ouvert',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('commande', o.id, 'email', o.guest_email, 'payee_le', o.paid_at)), '[]'::jsonb)
  from media_orders o
  where o.status = 'paid'
    and not exists (select 1 from media_download_grants g where g.order_id = o.id)
  having count(*) > 0;

  return query
  select 'critique', 'Cohérence', 'Commande remboursée dont l''accès est encore ouvert',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('commande', o.id, 'expire_le', g.expires_at)), '[]'::jsonb)
  from media_orders o
  join media_download_grants g on g.order_id = o.id
  where o.status = 'refunded' and g.expires_at > now()
  having count(*) > 0;

  -- Le seul cas qui mérite un regard : une session de paiement a bien été ouverte, et la commande
  -- n'a jamais basculé. Soit le client a payé et le webhook n'a pas suivi, soit il s'est arrêté au
  -- milieu. Dans le doute, on regarde — c'est de l'argent.
  return query
  select 'attention', 'Paiement', 'Paiement engagé chez Stripe et resté en attente (plus de 24 h)',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('commande', o.id, 'email', o.guest_email,
                                               'depuis', o.created_at, 'session', o.stripe_checkout_session_id)), '[]'::jsonb)
  from media_orders o
  where o.status = 'pending'
    and o.stripe_checkout_session_id is not null
    and o.created_at < now() - interval '24 hours'
  having count(*) > 0;

  -- Paniers abandonnés : personne n'a rien payé, personne n'attend rien. En information, au bout
  -- d'une semaine, et jamais en alerte : c'est le lot commun de toute vente en ligne.
  return query
  select 'info', 'Paiement', 'Paniers abandonnés avant paiement (plus de 7 jours)',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('commande', o.id, 'email', o.guest_email, 'depuis', o.created_at)), '[]'::jsonb)
  from media_orders o
  where o.status = 'pending'
    and o.stripe_checkout_session_id is null
    and o.created_at < now() - interval '7 days'
  having count(*) > 0;
end;
$$;

comment on function media_sante is
  'Anomalies à vérifier, lues en direct depuis les données réelles. Ne corrige RIEN : une correction automatique sur des données d''argent fait plus de dégâts qu''un défaut visible. « critique » = un client a payé et n''a pas ce qu''il a acheté. Un panier abandonné n''est pas une anomalie (v239).';
