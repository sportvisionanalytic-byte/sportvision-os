-- v319 — 28/09/2026 : deux surveillances que le tableau de santé annonçait et n'avait pas
--
-- COMMENT ON EST TOMBÉ DESSUS. Le test `audit-sante` plante trois anomalies et vérifie que
-- `media_sante()` les voit. Deux des trois ne sont détectées par AUCUNE fonction de la base — ni
-- `media_sante`, ni `club_sante`, vérifié par recherche dans le code de toutes les fonctions :
--
--   un e-mail définitivement échoué   nulle part
--   une photo prête sans aperçu       nulle part
--
-- Le test était rouge depuis, et invisible : le lanceur comptait vert tout test qui renvoyait un
-- tableau sans lire ses verdicts. On ne saura pas si ces contrôles ont existé puis disparu ou n'ont
-- jamais été écrits, et ça ne change rien à ce qu'il faut faire.
--
-- POURQUOI CES DEUX-LÀ MÉRITENT UNE ALERTE, et ce ne sont pas des contrôles de confort :
--
--   UN E-MAIL DÉFINITIVEMENT ÉCHOUÉ, c'est une famille qui a payé et qui n'a jamais reçu son lien.
--   Elle ne réclamera pas forcément : elle pensera que SportVision ne livre pas. Rien d'autre dans
--   le système ne le signale — `notification_outbox` garde le `FAILED` et personne ne le lit.
--
--   UNE PHOTO PRÊTE SANS APERÇU est devenue INVENDABLE CE SOIR MÊME. La v312 a fermé l'aperçu
--   public aux photos dont l'aperçu ne porte pas le filigrane, ce qui était la bonne décision — une
--   photo sans filigrane servie en clair, c'est le travail donné. Mais la conséquence est qu'une
--   photo sans aperçu, ou avec un aperçu non filigrané, disparaît de la boutique SANS ERREUR, SANS
--   TRACE et sans que personne ne s'en aperçoive. Exactement le mode de panne qu'il faut surveiller.
--
-- MESURÉ AVANT D'ÉCRIRE, pour ne pas fabriquer une alarme qui hurle en permanence :
--   notification_outbox           87 SENT, 6 SUPPRESSED, 0 FAILED
--   media_assets status='ready'   6 288, dont 0 sans aperçu et 0 sans filigrane
-- Les deux contrôles sont donc muets aujourd'hui. Ils ne coûtent rien et parleront le jour où ça
-- casse, ce qui est précisément le contrat d'une surveillance.
--
-- LA FENÊTRE DE 30 JOURS sur les e-mails n'est pas de la prudence : sans elle, un échec de l'an
-- dernier alerterait pour toujours, et une alerte permanente ne se lit plus. Il n'existe aucun
-- drapeau « traité » sur `notification_outbox` — le jour où il en faudra un, ce sera une décision à
-- part.
--
-- Le reste de la fonction n'est pas touché, y compris sa garde `media_pricing_staff()`.
--
-- Idempotent.

create or replace function public.media_sante()
returns table(gravite text, domaine text, probleme text, nombre integer, detail jsonb)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
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
$function$;
