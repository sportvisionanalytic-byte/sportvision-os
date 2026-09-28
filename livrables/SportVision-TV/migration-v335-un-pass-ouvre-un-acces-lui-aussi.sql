-- v335 — Une commande de Pass n'est pas une commande sans accès (28/09/2026).
--
-- `media_sante` ne cherchait qu'un droit de TÉLÉCHARGEMENT pour juger qu'une commande payée avait
-- bien ouvert un accès. Un Pass, lui, ouvre un droit (`media_entitlements`) : il n'a jamais de
-- droit de téléchargement, et tous les Pass vendus étaient donc signalés « payée sans accès
-- ouvert », en gravité critique.
--
-- La liste des anomalies est celle que le staff regarde pour savoir si un client a payé sans rien
-- recevoir. Une liste qui se trompe à chaque vente cesse d'être lue.

CREATE OR REPLACE FUNCTION public.media_sante()
 RETURNS TABLE(gravite text, domaine text, probleme text, nombre integer, detail jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- DEUX FACONS D'OUVRIR UN ACCES, ET IL FAUT REGARDER LES DEUX (v335, 28/09/2026).
    --
    -- Cette regle ne cherchait qu'un droit de TELECHARGEMENT. C'est la bonne question pour un
    -- achat de photos a l'unite : on paie, on telecharge. Mais un PASS n'ouvre pas de
    -- telechargement — il ouvre un droit, qui donne acces a ses photos dans la galerie. Aucun
    -- Pass n'a donc jamais de `media_download_grants`, et TOUS etaient signales comme anomalie
    -- critique, « payee sans acces ouvert ».
    --
    -- Ce n'est pas un defaut d'affichage. C'est la liste que le staff regarde pour savoir si un
    -- client a paye sans rien recevoir : une liste qui crie au loup a chaque vente de Pass finit
    -- par ne plus etre lue, et le jour ou une vraie commande orpheline s'y glisse, personne ne la
    -- voit. Fouka, le soir du premier Pass vendu : « je vois 2 commandes ouvertes, paye sans acces
    -- ouvert, on peut meme pas traiter le probleme ».
    and not exists (select 1 from media_download_grants g where g.order_id = o.id)
    and not exists (select 1 from media_entitlements e where e.order_id = o.id)
  having count(*) > 0;

  return query
  select 'critique', 'Cohérence', 'Commande remboursée dont l''accès est encore ouvert',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('commande', o.id, 'expire_le', g.expires_at)), '[]'::jsonb)
  from media_orders o
  join media_download_grants g on g.order_id = o.id
  where o.status = 'refunded' and g.expires_at > now()
  having count(*) > 0;

  -- AJOUT v319 — Une famille qui a payé et dont le lien n'est jamais parti. Le `FAILED` reste dans
  -- la file et personne ne le lit.
  return query
  select 'critique', 'Livraison', 'E-mail définitivement échoué (30 derniers jours)',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('destinataire', n.recipient_email, 'quoi', n.event_type,
                                               'erreur', n.last_error, 'le', n.created_at)), '[]'::jsonb)
  from notification_outbox n
  where n.status = 'FAILED'
    and n.channel = 'EMAIL'
    and n.created_at > now() - interval '30 days'
  having count(*) > 0;

  -- AJOUT v319 — Depuis la v312, une photo dont l'aperçu n'est pas filigrané n'apparaît PAS dans la
  -- boutique. Sans ce contrôle, elle est invendable en silence : aucune erreur, aucune trace.
  -- Restreint aux galeries PUBLIÉES : dans un brouillon, un aperçu manquant est normal, le travail
  -- n'est pas fini.
  return query
  select 'critique', 'Livraison', 'Photo publiée mais invisible dans la boutique (aperçu manquant ou sans filigrane)',
         count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('galerie', al.title, 'album', al.id, 'photo', a.id,
                                               'fichier', a.original_filename,
                                               'cause', case when coalesce(a.preview_path,'') = '' then 'aucun aperçu'
                                                             else 'aperçu sans filigrane' end)), '[]'::jsonb)
  from media_assets a
  join media_albums al on al.id = a.album_id
  where a.status = 'ready'
    and al.status = 'published'
    and (coalesce(a.preview_path, '') = '' or a.preview_watermarked is not true)
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
$function$
;
