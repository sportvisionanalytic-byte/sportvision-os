-- Un panier abandonné n'est pas une anomalie (v239, 21/09/2026).
--
-- SIGNALÉ PAR FOUKA. L'écran de santé annonçait « Paiement resté en attente depuis plus de 24 h ·
-- 3 cas » avec trois adresses de vrais clients. Il a cru que trois personnes avaient payé sans
-- recevoir leurs photos. Vérification faite : les deux personnes concernées avaient ouvert la page
-- de paiement, l'avaient fermée, puis étaient revenues quelques minutes plus tard prendre une
-- formule moins chère. Toutes deux ont payé et reçu leur e-mail. Personne n'était lésé.
--
-- POURQUOI CE TEST EXISTE. Une alerte qu'on apprend à ignorer ne sert plus à rien le jour où elle
-- a raison. Le vrai cas — payé chez Stripe, commande restée bloquée — se noierait dans le bruit.
--
-- CE QU'ON MESURE :
--   1. Une commande payée sans accès reste CRITIQUE.
--   2. Un paiement engagé chez Stripe et resté en attente : signalé.
--   3. Un panier abandonné (aucune session de paiement) de moins de 7 jours : silence.
--   4. Le même au-delà de 7 jours : information, jamais alerte.

begin;

do $$
declare
  v_admin uuid; v_club uuid; v_client uuid; v_album uuid; v_asset uuid;
  n int; e text[] := '{}';
  function_result record;
begin
  perform set_config('request.jwt.claims','{"role":"service_role"}', true);
  select id into v_admin from profiles where role='admin' and actif order by created_at limit 1;
  insert into clients (nom, statut) values ('ZZ Client Sante','client') returning id into v_client;
  insert into clubs (nom, plan, portail_client_id) values ('ZZ Club Sante','performance', v_client) returning id into v_club;
  insert into media_albums (title, club_id, status, event_date, published_at)
    values ('ZZ Galerie Sante', v_club, 'published', current_date, now()) returning id into v_album;

  -- 1. Panier abandonné récent : aucune session Stripe, 2 jours.
  insert into media_orders (album_id, club_id, guest_email, amount_cents, currency, status, created_at)
    values (v_album, v_club, 'zz-abandon-recent@example.invalid', 500, 'eur', 'pending', now() - interval '2 days');
  -- 2. Panier abandonné ancien : aucune session, 10 jours.
  insert into media_orders (album_id, club_id, guest_email, amount_cents, currency, status, created_at)
    values (v_album, v_club, 'zz-abandon-ancien@example.invalid', 500, 'eur', 'pending', now() - interval '10 days');
  -- 3. Paiement ENGAGÉ chez Stripe, resté en attente : celui qui doit alerter.
  insert into media_orders (album_id, club_id, guest_email, amount_cents, currency, status, created_at, stripe_checkout_session_id)
    values (v_album, v_club, 'zz-engage@example.invalid', 500, 'eur', 'pending', now() - interval '3 days', 'cs_test_zz_sante');

  -- L'écran de santé est réservé au staff : on le lit avec les droits d'un administrateur.
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',v_admin::text,'role','authenticated')::text, true);

  select count(*) into n from media_sante()
   where probleme ilike '%engagé chez Stripe%' and detail::text like '%zz-engage@example.invalid%';
  if n <> 1 then e := e || 'un paiement engage chez Stripe et bloque n est plus signale'::text; end if;

  select count(*) into n from media_sante() where detail::text like '%zz-abandon-recent@example.invalid%';
  if n <> 0 then e := e || 'un panier abandonne recent declenche encore une alerte'::text; end if;

  select count(*) into n from media_sante()
   where gravite = 'info' and detail::text like '%zz-abandon-ancien@example.invalid%';
  if n <> 1 then e := e || 'un panier abandonne ancien n est pas remonte en information'::text; end if;

  select count(*) into n from media_sante()
   where gravite <> 'info' and detail::text like '%zz-abandon-ancien@example.invalid%';
  if n <> 0 then e := e || 'un panier abandonne remonte en alerte au lieu d une information'::text; end if;

  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}', true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — un panier abandonné ne déclenche plus d''alerte : il remonte en information au bout de 7 jours. Seul un paiement réellement engagé chez Stripe et resté en attente est signalé.' as verdict;

rollback;
