-- RATTRAPAGE REVIEW — fonctions et policy modifiees en PRODUCTION sans passer par une migration
-- Projet Review ffjktzmsezfrwmrtlhzo uniquement, le 12/09/2026.
--
-- Apres avoir rejoue toute la chaine des migrations manquantes, 13 fonctions et 1 policy
-- differaient encore de la production. Aucune migration du depot ne porte ces changements : ils
-- ont ete ecrits directement en base. Neuf ne sont que des messages d erreur reformules (passe
-- "textes" du 12/09), quatre changent le comportement :
--   * enqueue_notification            — p_scheduled_at null retombe sur now() (colonne NOT NULL) ;
--   * ensure_default_pole_affectation — meta.responsable_pole_ids affecte en Responsable ;
--   * media_gallery_quote             — lien sans offre : retour vide au lieu d une erreur serveur ;
--   * protect_client_cm_assignment    — laisse passer le service_role, et reconnait
--                                        cm_niveau_autonomie = responsable en plus de cm_lead.
-- La policy client_affiliations::affil_write suit la meme evolution (Responsable CM autorise).
--
-- Definitions copiees telles quelles depuis la production (lecture seule, API Management).
-- A remonter a Fouka : meme dette que le fichier 03, cote production.

begin;

-- ── check_echeances_documents_rh()
CREATE OR REPLACE FUNCTION public.check_echeances_documents_rh()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_doc record;
begin
  -- Sur le modèle exact de check_contrats_renouvellement_proche /
  -- check_devis_expiration_proche : même structure (boucle + idempotence via
  -- NOT EXISTS + notify_staff_by_role), scope limité à collaborateur_documents
  -- car secretariat_agenda_events.document_id ne référence QUE cette table
  -- (pas client_documents/contrats/recruitment_applications, qui composent
  -- aussi la vue secretariat_documents mais n'ont pas de colonne dédiée dans
  -- l'agenda). Seuil de 30 jours aligné sur le seuil 'expire_bientot' déjà
  -- utilisé par la vue secretariat_documents (statut_affichage).
  for v_doc in
    select id, collaborateur_id, type, nom, date_echeance
    from collaborateur_documents
    where statut = 'valide'
      and date_echeance is not null
      and date_echeance - current_date = 30
  loop
    if not exists (
      select 1 from secretariat_agenda_events
      where document_id = v_doc.id and type = 'echeance_document' and statut != 'termine'
    ) then
      insert into secretariat_agenda_events (
        type, titre, description, date_heure, statut, document_id
      ) values (
        'echeance_document',
        'Document ' || coalesce(v_doc.nom, v_doc.type, '') || ' — échéance dans 30 jours',
        'Pièce collaborateur arrivant à expiration : vérifier et relancer le renouvellement.',
        v_doc.date_echeance::timestamptz,
        'a_faire',
        v_doc.id
      );
    end if;

    perform notify_staff_by_role(
      array['admin','sec'],
      'Document RH — échéance dans 30 jours',
      coalesce(v_doc.nom, v_doc.type, 'Document') || ' expire bientôt. Un rappel a été ajouté à l''Agenda Secrétaire.',
      'normale',
      null,
      null
    );
  end loop;
end;
$function$;

-- ── check_signature_avant_acceptation()
CREATE OR REPLACE FUNCTION public.check_signature_avant_acceptation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.statut = 'accepté' and coalesce(new.signature_statut,'non_demandee') <> 'signee' then
    raise exception 'Ce devis ne peut pas passer à "accepté" sans signature Youtrust confirmée.';
  end if;
  return new;
end; $function$;

-- ── check_signature_avant_activation()
CREATE OR REPLACE FUNCTION public.check_signature_avant_activation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.statut = 'actif' and coalesce(new.signature_statut,'non_demandee') <> 'signee' then
    raise exception 'Ce contrat ne peut pas passer à "actif" sans signature Youtrust confirmée.';
  end if;
  return new;
end; $function$;

-- ── check_team_membership_club()
CREATE OR REPLACE FUNCTION public.check_team_membership_club()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ begin if new.club_id <> (select club_id from club_teams where id = new.team_id) then raise exception 'Cette équipe n''appartient pas à ce club.'; end if; return new; end; $function$;

-- ── club_booking_send_to_production(p_booking_id uuid)
CREATE OR REPLACE FUNCTION public.club_booking_send_to_production(p_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_booking club_bookings%rowtype;
  v_club_client_id uuid;
  v_type_prestation text;
  v_heure time;
  v_prestation_id uuid;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from profiles where id = auth.uid() and role = any(array['admin','com','sec'])
  ) then
    raise exception 'Accès réservé au staff (admin/commercial/secrétariat).';
  end if;

  select * into v_booking from club_bookings where id = p_booking_id;
  if not found then
    raise exception 'Réservation introuvable.';
  end if;
  if v_booking.status <> 'confirmee' then
    raise exception 'Cette réservation doit être au statut "Confirmée" avant d''être envoyée en Production.';
  end if;
  if v_booking.prestation_id is not null then
    -- Idempotent : déjà envoyée (double-clic, ou deux membres du staff en
    -- parallèle) — renvoie la prestation existante plutôt que d'échouer ou
    -- d'en créer une seconde.
    return v_booking.prestation_id;
  end if;

  select portail_client_id into v_club_client_id from clubs where id = v_booking.club_id;
  if v_club_client_id is null then
    raise exception 'Ce club n''a pas encore de fiche client SportVision. Rattachez-le depuis Documents avant de créer la prestation.';
  end if;

  -- Mapping best-effort du libellé de service vers le domaine fixe de
  -- type_prestation déjà utilisé partout ailleurs dans l'OS (même liste que
  -- OFFRE_SLUG_TO_TYPE_PRESTATION côté create-guest-request) — reste sur
  -- 'autre' si aucune correspondance évidente, jamais une valeur inventée.
  v_type_prestation := case
    when v_booking.service_label ilike '%match%' then 'match'
    when v_booking.service_label ilike '%tournoi%' then 'tournoi'
    when v_booking.service_label ilike '%entraînement%' or v_booking.service_label ilike '%entrainement%' or v_booking.service_label ilike '%stage%' then 'entraînement'
    when v_booking.service_label ilike '%portrait%' or v_booking.service_label ilike '%shooting%' then 'portrait'
    when v_booking.service_label ilike '%événement%' or v_booking.service_label ilike '%evenement%' then 'événement'
    else 'autre'
  end;

  -- club_bookings.heure est un text libre (pas garanti au format HH:MM) —
  -- conversion best-effort, jamais bloquante : une valeur non parsable laisse
  -- heure_debut à NULL plutôt que de faire échouer tout l'envoi en Production.
  begin
    v_heure := v_booking.heure::time;
  exception when others then
    v_heure := null;
  end;

  insert into prestations (
    client_id, date_prestation, heure_debut, lieu, adresse_complete, equipes,
    type_prestation, statut, source, notes_internes
  ) values (
    v_club_client_id, v_booking.event_date, v_heure, v_booking.adresse, v_booking.adresse, v_booking.team,
    v_type_prestation, 'confirmée', 'clubplus',
    'Générée automatiquement depuis une réservation Club+ (' || v_booking.service_label || ', réservation ' || v_booking.id || ').'
      || case when v_booking.objectif is not null then E'\nObjectif : ' || v_booking.objectif else '' end
  )
  returning id into v_prestation_id;

  update club_bookings set prestation_id = v_prestation_id where id = p_booking_id;

  return v_prestation_id;
end;
$function$;

-- ── clubplus_claim_self_service_onboarding(p_user_id uuid, p_club_nom text, p_ville text, p_discipline text, p_plan text, p_engagement text, p_credits integer, p_prenom text, p_nom text, p_telephone text)
CREATE OR REPLACE FUNCTION public.clubplus_claim_self_service_onboarding(p_user_id uuid, p_club_nom text, p_ville text, p_discipline text, p_plan text, p_engagement text, p_credits integer, p_prenom text, p_nom text, p_telephone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing record;
  v_club_id uuid;
begin
  if p_user_id is null then
    raise exception 'Compte utilisateur introuvable. Reconnectez-vous, puis réessayez.';
  end if;
  -- On ne peut reclamer un espace QUE pour soi-meme (faille trouvee a l'audit du 09/09/2026 :
  -- p_user_id etait pris tel quel, jamais compare a l'appelant, sur une fonction SECURITY DEFINER
  -- executable par `anon` — avec la seule cle publique du site, on creait un club et on y
  -- rattachait un compte REEL comme administrateur).
  -- Le service role (edge functions) reste autorise a agir pour un tiers : le role courant n'y
  -- est ni `anon` ni `authenticated`.
  -- current_user ne convient PAS ici : dans une fonction SECURITY DEFINER il vaut le
  -- proprietaire (postgres), jamais l'appelant — un premier correctif ecrit ainsi ne bloquait
  -- rien du tout, ce qu'a montre le test. C'est le role porte par le jeton qui fait foi.
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon')
       <> 'service_role'
     and p_user_id is distinct from auth.uid() then
    raise exception 'Accès refusé : un espace ne peut être réclamé que pour son propre compte.'
      using errcode = '42501';
  end if;

  if p_club_nom is null or btrim(p_club_nom) = '' then
    raise exception 'club_nom requis';
  end if;

  -- Sérialise tous les appels concurrents pour un même utilisateur (double effect React,
  -- double onglet, retry réseau) — verrou relâché automatiquement à la fin de cette transaction.
  perform pg_advisory_xact_lock(hashtext('clubplus-onboarding:' || p_user_id::text));

  select cm.club_id, cm.role into v_existing
  from club_members cm
  where cm.user_id = p_user_id
  limit 1;

  if found then
    return jsonb_build_object('club_id', v_existing.club_id, 'role', v_existing.role, 'already_onboarded', true);
  end if;

  insert into clubs (nom, ville, discipline, plan, engagement, credits_monthly, credits_balance)
  values (btrim(p_club_nom), p_ville, p_discipline, p_plan, coalesce(p_engagement, '12mois'), p_credits, p_credits)
  returning id into v_club_id;

  insert into club_members (user_id, club_id, role, prenom, nom, telephone, status)
  values (p_user_id, v_club_id, 'admin', p_prenom, p_nom, p_telephone, 'actif');

  return jsonb_build_object('club_id', v_club_id, 'role', 'admin', 'already_onboarded', false);
end;
$function$;

-- ── connect_os_accounts_list()
CREATE OR REPLACE FUNCTION public.connect_os_accounts_list()
 RETURNS TABLE(user_id uuid, type text, prenom text, nom text, email text, ville text, club_nom text, agent_tier text, agent_status text, nb_athletes integer, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: reserve au staff';
  end if;

  return query
  select
    pp.user_id,
    'club'::text,
    pp.prenom,
    pp.nom,
    u.email::text,
    null::text,
    c.nom,
    null::text,
    null::text,
    null::int,
    pp.created_at
  from player_profiles pp
  join auth.users u on u.id = pp.user_id
  left join clubs c on c.id = pp.club_id
  where pp.user_id is not null

  union all

  select
    cps.user_id,
    cps.account_type,
    coalesce(u.raw_user_meta_data->>'first_name', ''),
    coalesce(u.raw_user_meta_data->>'last_name', ''),
    u.email::text,
    cps.ville,
    dc.name,
    cas.tier,
    cas.status,
    (select count(*)::int from managed_athlete_profiles map where map.owner_user_id = cps.user_id)
      + (select count(*)::int from connect_access_relationships car
           where car.grantee_user_id = cps.user_id and car.status = 'acceptee'),
    cps.created_at
  from connect_profile_settings cps
  join auth.users u on u.id = cps.user_id
  left join connect_declared_club_players dcp on dcp.user_id = cps.user_id
  left join connect_declared_clubs dc on dc.id = dcp.declared_club_id
  left join connect_agent_subscriptions cas on cas.user_id = cps.user_id
  order by 11 desc;
end;
$function$;

-- ── enqueue_notification(p_event_type text, p_template_key text, p_channel text, p_idempotency_key text, p_recipient_email text, p_recipient_phone text, p_recipient_user_id uuid, p_recipient_client_id uuid, p_entity_type text, p_entity_id uuid, p_payload jsonb, p_scheduled_at timestamp with time zone)
CREATE OR REPLACE FUNCTION public.enqueue_notification(p_event_type text, p_template_key text, p_channel text, p_idempotency_key text, p_recipient_email text DEFAULT NULL::text, p_recipient_phone text DEFAULT NULL::text, p_recipient_user_id uuid DEFAULT NULL::uuid, p_recipient_client_id uuid DEFAULT NULL::uuid, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_scheduled_at timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  -- Un DEFAULT ne couvre pas le cas d'un null passé explicitement. `scheduled_at` étant NOT NULL,
  -- il faut retomber sur now() ici, sinon l'insert échoue pour un appelant qui voulait simplement
  -- dire « tout de suite ».
  v_quand timestamptz := coalesce(p_scheduled_at, now());
begin
  insert into notification_outbox (
    event_type, template_key, channel, idempotency_key,
    recipient_email, recipient_phone_e164, recipient_user_id, recipient_client_id,
    entity_type, entity_id, payload_json, scheduled_at, next_attempt_at
  ) values (
    p_event_type, p_template_key, p_channel, p_idempotency_key,
    p_recipient_email, p_recipient_phone, p_recipient_user_id, p_recipient_client_id,
    p_entity_type, p_entity_id, p_payload, v_quand, v_quand
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id; -- null si déjà existant (comportement voulu, pas une erreur)
end;
$function$;

-- ── ensure_default_pole_affectation(p_user_id uuid, p_meta jsonb)
CREATE OR REPLACE FUNCTION public.ensure_default_pole_affectation(p_user_id uuid, p_meta jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_pole_ids uuid[];
  v_responsable_ids uuid[];
  v_single uuid;
  v_id uuid;
begin
  v_role := p_meta->>'role';
  if v_role = 'rh' then
    return; -- accès global par rôle (is_admin_or_rh()), pas par pole_affectations
  end if;

  v_pole_ids := null;
  if jsonb_typeof(p_meta->'pole_ids') = 'array' then
    begin
      select array_agg((elem)::uuid) into v_pole_ids
        from jsonb_array_elements_text(p_meta->'pole_ids') as elem
        where elem is not null and elem <> '';
    exception when others then
      v_pole_ids := null;
    end;
  end if;

  if v_pole_ids is null or array_length(v_pole_ids, 1) is null then
    -- Compat ascendante : ancien format à pôle unique (migration-poles-v11/v12).
    begin
      v_single := nullif(p_meta->>'pole_id', '')::uuid;
    exception when others then
      v_single := null;
    end;
    if v_single is not null then
      v_pole_ids := array[v_single];
    end if;
  end if;

  -- Filtre les ids invalides (pôle inexistant) plutôt que d'échouer.
  if v_pole_ids is not null then
    select array_agg(x) into v_pole_ids
      from unnest(v_pole_ids) x
      where exists (select 1 from public.poles where id = x);
  end if;

  if v_pole_ids is null or array_length(v_pole_ids, 1) is null then
    v_pole_ids := array[pole_football_id()];
  end if;

  -- Sous-ensemble de v_pole_ids à affecter directement en Responsable (migration-poles-v26,
  -- 31/08/2026) : validé côté edge function invite-collaborateur (admin uniquement, subset de
  -- pole_ids) — filtré ici une seconde fois par prudence (pôle inexistant ou hors pole_ids).
  v_responsable_ids := null;
  if jsonb_typeof(p_meta->'responsable_pole_ids') = 'array' then
    begin
      select array_agg((elem)::uuid) into v_responsable_ids
        from jsonb_array_elements_text(p_meta->'responsable_pole_ids') as elem
        where elem is not null and elem <> '' and (elem)::uuid = any (v_pole_ids);
    exception when others then
      v_responsable_ids := null;
    end;
  end if;

  foreach v_id in array v_pole_ids loop
    insert into public.pole_affectations (pole_id, user_id, role_pole)
    values (v_id, p_user_id, case when v_id = any (coalesce(v_responsable_ids, array[]::uuid[])) then 'responsable' else 'membre' end)
    on conflict (pole_id, user_id) do nothing;
  end loop;
end;
$function$;

-- ── media_gallery_quote(p_slug text, p_token text, p_asset_ids uuid[], p_password text, p_offer_id uuid)
CREATE OR REPLACE FUNCTION public.media_gallery_quote(p_slug text, p_token text, p_asset_ids uuid[] DEFAULT NULL::uuid[], p_password text DEFAULT NULL::text, p_offer_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(album_id uuid, club_id uuid, saison_id uuid, link_id uuid, offer_id uuid, product_id uuid, offer_type text, offer_name text, valid_asset_ids uuid[], photos_allowance integer, total_cents integer, currency text, lines jsonb, whole_album boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  o record;
  v_album media_albums;
  v_valid uuid[];
  v_count integer;
  b record;
  v_currency text;
begin
  select * into r from _media_gallery_resolve(p_slug, p_token, p_password);
  if r.raison is not null then return; end if;
  select * into v_album from media_albums where media_albums.id = r.album_id;

  -- L'offre demandée doit appartenir À CE LIEN. Sans cette jointure, il suffirait d'envoyer
  -- l'identifiant de l'offre à 10 € d'un autre lien pour obtenir la galerie au tarif du voisin.
  if p_offer_id is not null then
    select * into o from media_link_offers(r.link_id) where media_link_offers.offer_id = p_offer_id;
    if not found then return; end if;
  else
    -- Aucune offre demandée : lien à offre unique, ou lien hérité. On prend la seule qu'il y a.
    -- S'il y en a plusieurs, on ne devine pas laquelle il voulait.
    select count(*)::integer into v_count from media_link_offers(r.link_id);
    if v_count = 1 then
      select * into o from media_link_offers(r.link_id);
    elsif v_count > 1 then
      return;
    else
      -- Aucune offre sur ce lien : il n'y a rien a vendre, on ne devine pas un prix.
      --
      -- Corrige le 09/09/2026. Ce cas n'etait pas traite : `o` restait NON ASSIGNE et la
      -- ligne « if o.offer_id is not null » plus bas levait « record "o" is not assigned yet ».
      -- Un visiteur ouvrant un lien dont les offres ont ete retirees recevait donc une erreur
      -- serveur au lieu d'une galerie sans possibilite d'achat. Trois suites de tests le
      -- signalaient deja sans que la cause soit identifiee.
      return;
    end if;
  end if;

  -- ── Modèle « formule » ────────────────────────────────────────────────────────────────
  -- La bascule se fait sur l'EXISTENCE D'UNE OFFRE, plus sur la présence d'un produit de
  -- catalogue. Depuis la v31, une offre peut se suffire à elle-même : elle porte son nom, son
  -- quota et son prix, et une galerie sans club n'a aucun produit à lui associer. Tester
  -- product_id faisait retomber ces offres sur le modèle historique par photo, qui exige un
  -- club — et rendait donc toute galerie autonome invendable, silencieusement.
  -- o.offer_id porte une vraie offre ; o.product_id seul désigne un lien d'avant les offres.
  if o.offer_id is not null or o.product_id is not null then
    if o.offer_type = 'album_complet' then
      -- Toutes les photos publiables AU MOMENT DE L'ACHAT. Une photo ajoutée après coup n'entre
      -- pas dans une commande déjà payée : sinon un album complété pendant des mois
      -- transformerait un achat de 50 € en abonnement à vie, que personne n'a vendu.
      select coalesce(array_agg(m.id), '{}') into v_valid
      from media_assets m where m.album_id = r.album_id and m.status = 'ready';
    else
      -- Pack : la sélection vient du visiteur, mais on ne garde que des photos réellement
      -- publiables de CET album. Une liste envoyée par le navigateur ne prouve rien.
      select coalesce(array_agg(m.id), '{}') into v_valid
      from media_assets m
      where m.album_id = r.album_id and m.status = 'ready'
        and m.id = any (coalesce(p_asset_ids, '{}'));

      v_count := coalesce(array_length(v_valid, 1), 0);
      -- Au-delà du quota, on ne rogne pas la sélection en silence : le visiteur croirait avoir
      -- acheté 20 photos et n'en recevrait que 15. On refuse, et l'écran le dit.
      if o.photos_allowance is not null and v_count > o.photos_allowance then return; end if;
      -- En dessous du quota, c'est permis : un parent qui ne trouve que 11 photos de son enfant
      -- sur un pack de 15 doit pouvoir acheter quand même. Le prix ne change pas.
      if v_count = 0 then return; end if;
    end if;

    return query select r.album_id, v_album.club_id, v_album.saison_id, r.link_id,
                        o.offer_id, o.product_id, o.offer_type, o.offer_name,
                        v_valid, o.photos_allowance, o.price_cents, coalesce(o.currency,'eur'),
                        jsonb_build_array(jsonb_build_object(
                          'product_id', o.product_id, 'name', o.offer_name, 'type', o.offer_type,
                          'quantity', 1, 'unit_price_cents', o.price_cents,
                          'covers_photos', coalesce(array_length(v_valid, 1), 0))),
                        (o.offer_type = 'album_complet');
    return;
  end if;

  -- ── Modèle historique : prix par combinaison sur une sélection ─────────────────────────
  -- Conservé tel quel pour les liens qui ne vendent aucune formule : ils existent encore.
  select coalesce(array_agg(m.id), '{}') into v_valid
  from media_assets m
  where m.album_id = r.album_id and m.status = 'ready' and m.id = any (coalesce(p_asset_ids, '{}'));

  v_count := coalesce(array_length(v_valid, 1), 0);
  if v_count = 0 then return; end if;

  select * into b from _media_gallery_best_price(r.album_id, v_count);
  if b.total_cents is null then return; end if;

  select p.currency into v_currency from media_products p
  where p.club_id = v_album.club_id and p.status = 'active' limit 1;

  return query select r.album_id, v_album.club_id, v_album.saison_id, r.link_id, null::uuid,
                      null::uuid, null::text, null::text, v_valid, null::integer, b.total_cents,
                      coalesce(v_currency, 'eur'), b.lines, b.whole_album;
end;
$function$;

-- ── protect_client_cm_assignment()
CREATE OR REPLACE FUNCTION public.protect_client_cm_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_privileged boolean;
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.cm_id is distinct from old.cm_id then
    select exists(
      select 1 from profiles where id = auth.uid()
      and (role = 'admin' or (role = 'cm' and (niveau_cm = 'cm_lead' or cm_niveau_autonomie = 'responsable')))
    ) into is_privileged;
    if not is_privileged then
      raise exception 'Modification non autorisee : l affectation du CM est reservee a l administrateur ou au Responsable CM.';
    end if;
  end if;
  return new;
end;
$function$;

-- ── protect_sensitive_client_user_fields()
CREATE OR REPLACE FUNCTION public.protect_sensitive_client_user_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_os_staff boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'com', 'compta')
  ) into is_os_staff;

  if not is_os_staff then
    if new.client_id is distinct from old.client_id then
      raise exception 'Modification non autorisée : le rattachement client est réservé au staff SportVision.';
    end if;
  end if;

  return new;
end;
$function$;

-- ── protect_sensitive_club_member_fields()
CREATE OR REPLACE FUNCTION public.protect_sensitive_club_member_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  is_os_staff boolean;
  is_this_club_admin boolean;
  is_proprietaire boolean;
  is_self_accepting_own_invitation boolean;
  a_une_invitation_ouverte boolean;
  accepte_une_invitation boolean;
  v_club uuid;
  v_role_privilegie boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  v_club := new.club_id;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into is_os_staff;

  select is_club_admin(v_club) into is_this_club_admin;
  -- `role = 'admin'` strictement : ni le président, ni le CM délégué, ni le super-accès.
  select is_real_club_admin(v_club) into is_proprietaire;

  -- (comptes-clubplus-v1) La personne met à jour SA ligne en acceptant une invitation ouverte qui
  -- lui est adressée sur ce club : le rôle obtenu est le sien (conservé) ou celui de l'invitation.
  accepte_une_invitation := tg_op = 'UPDATE'
    and old.user_id = auth.uid()
    and new.user_id = auth.uid()
    and exists (
      select 1
        from club_invitations ci
        join auth.users u on u.id = auth.uid()
       where ci.club_id = old.club_id
         and lower(ci.email) = lower(u.email)
         and ci.statut in ('preparee', 'envoyee')
         and ci.expire_at > now()
         and (ci.role = new.role or new.role = old.role)
    );

  v_role_privilegie := new.role in ('admin', 'president', 'cm_externe')
                    or (tg_op = 'UPDATE' and old.role in ('admin', 'president', 'cm_externe'));

  if v_role_privilegie and not (is_os_staff or is_proprietaire or accepte_une_invitation) then
    if not (
      tg_op = 'INSERT'
      and new.user_id = auth.uid()
      and exists (
        select 1 from club_invitations ci
        join auth.users u on u.id = auth.uid()
        where ci.club_id = v_club
          and lower(ci.email) = lower(u.email)
          and ci.role = new.role
          and ci.statut in ('preparee', 'envoyee', 'acceptee')
          and ci.expire_at > now() - interval '1 day'
      )
    ) then
      raise exception 'Ce rôle relève de la propriété du club : seul son administrateur peut l''attribuer, le retirer, ou modifier la ligne de qui le porte.';
    end if;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : une adhésion ne se transfère pas d''un club à un autre. Retirez la personne, puis ajoutez-la dans l''autre club.';
  end if;

  if is_this_club_admin and not is_os_staff and old.user_id = auth.uid()
     and (new.status is distinct from 'actif' or new.role is distinct from old.role)
  then
    raise exception 'Un administrateur ne peut pas se retirer ses propres droits d''administration.';
  end if;

  select exists (
    select 1
      from club_invitations ci
      join auth.users u on u.id = auth.uid()
     where ci.club_id = old.club_id
       and lower(ci.email) = lower(u.email)
       and ci.statut in ('preparee', 'envoyee')
       and ci.expire_at > now()
  ) into a_une_invitation_ouverte;

  if not is_os_staff and not is_this_club_admin and not peut_operer_club(old.club_id)
     and new.teams is distinct from old.teams
     and not (old.user_id = auth.uid() and a_une_invitation_ouverte)
  then
    raise exception 'Modification non autorisée : le périmètre d''équipes est fixé par l''administrateur du club.';
  end if;

  is_self_accepting_own_invitation :=
    (auth.uid() = old.user_id
     and old.status = 'invitation'
     and new.status = 'actif'
     and new.role = old.role)
    -- (comptes-clubplus-v1) ou l'acceptation d'une invitation ouverte, statut ramené à « actif ».
    or (accepte_une_invitation and new.status = 'actif');

  if not is_os_staff and not is_this_club_admin and not peut_operer_club(old.club_id)
     and not is_self_accepting_own_invitation then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
    then
      raise exception 'Modification non autorisée : rôle et statut sont réservés à l''administrateur du club ou au staff SportVision.';
    end if;
  end if;

  return new;
end;
$function$;

-- ── client_affiliations :: affil_write (Responsable CM autorise, comme en production)
drop policy if exists affil_write on public.client_affiliations;
create policy affil_write on public.client_affiliations for all
  using (exists (select 1 from profiles p
                  where p.id = auth.uid()
                    and (p.role = 'admin'
                         or (p.role = 'cm' and (p.niveau_cm = 'cm_lead'
                                                or p.cm_niveau_autonomie = 'responsable')))))
  with check (exists (select 1 from profiles p
                  where p.id = auth.uid()
                    and (p.role = 'admin'
                         or (p.role = 'cm' and (p.niveau_cm = 'cm_lead'
                                                or p.cm_niveau_autonomie = 'responsable')))));

commit;
