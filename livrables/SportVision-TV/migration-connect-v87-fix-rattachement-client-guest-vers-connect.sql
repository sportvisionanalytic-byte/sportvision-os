-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v87
-- Corrige un bug CRITIQUE trouvé par la campagne QA fonctionnelle du 30/08/2026 sur le parcours
-- réservation → création de compte : le rattachement compte↔prestation, promis explicitement
-- par la FAQ du site vitrine (a-propos.html : "Non. Les prestations ponctuelles se demandent
-- directement, sans créer de compte au préalable. Un espace SportVision Connect vous est
-- ensuite proposé pour créer votre accès et récupérer vos contenus."), NE FONCTIONNAIT PAS pour
-- un compte Connect personnel (Espace particulier / Espace joueur).
--
-- ────────────────────────────────────────────────────────────────────────
-- CAUSE EXACTE (reproduite en réel avant d'écrire une seule ligne ci-dessous — voir le rapport
-- QA_RESERVATION_COMPTE_ACHAT.md pour le détail avant/après avec vrais id de test)
-- ────────────────────────────────────────────────────────────────────────
--
-- connect_resolve_beneficiary_client_id(p_kind, p_ref_id) (migration-connect-v51-espace-
-- particulier.sql) résout le client_id d'un compte Connect personnel. Pour un compte SANS
-- player_profiles (particulier), ou avec player_profiles mais sans client_id encore rattaché
-- (joueur/sportif sans club), elle allait chercher `v_email` depuis auth.users UNIQUEMENT pour
-- construire un libellé d'affichage — puis créait TOUJOURS une ligne `clients` neuve à l'aveugle
-- (`insert into clients (nom, type_client, prenom_contact, nom_contact) values (...)`), sans
-- jamais chercher si une ligne `clients` existait déjà pour cet e-mail.
--
-- Résultat reproduit en réel le 30/08/2026 :
--   1. Une demande envoyée sans compte depuis reserver.html/demande-de-devis.html crée une ligne
--      `clients` via find_or_create_client_by_email (create-guest-request), correctement
--      indexée par e-mail.
--   2. Le même visiteur crée ensuite un compte Connect personnel avec le MÊME e-mail (parcours
--      normal proposé par l'écran de confirmation de reserver.html).
--   3. Dès que ce compte accède à "Mes commandes"/"Réserver" (list_orders / create_request, tous
--      deux appellent connect_resolve_beneficiary_client_id(kind:"self")), une DEUXIÈME ligne
--      `clients` était créée pour la même personne — ET SANS MÊME COPIER L'E-MAIL DESSUS
--      (l'insert ne renseignait pas la colonne `email` du tout : la nouvelle fiche se retrouvait
--      avec `email = NULL`, la rendant irrécupérable par tout futur rapprochement par e-mail).
--   4. La demande initiale restait invisible depuis le nouveau compte (rattachée à la 1ère
--      fiche `clients`, jamais à la 2e), contredisant frontalement la FAQ.
--
-- ────────────────────────────────────────────────────────────────────────
-- CORRECTIF
-- ────────────────────────────────────────────────────────────────────────
--
-- Remplace les deux `insert into clients (...)` à l'aveugle (branche player_profiles sans
-- client_id, et branche connect_profile_settings sans client_id) par un appel à
-- find_or_create_client_by_email(v_email, ...) — la même fonction déjà utilisée par
-- create-guest-request/create-guest-rdv/portal-onboarding/clubplus-onboarding, qui cherche par
-- e-mail (verrou pg_advisory_xact_lock anti-course inclus) AVANT de créer, et renseigne
-- correctement la colonne `email`. Le message de bienvenue automatique (messages_client) n'est
-- désormais inséré que si la ligne est réellement neuve (`_created`), pour ne pas polluer le fil
-- de discussion d'un client déjà existant rattaché par e-mail.
--
-- La branche "managed" (profil géré : enfant/proche sans e-mail propre) est volontairement
-- inchangée — rien à rapprocher par e-mail pour un profil qui n'en a pas.
--
-- Idempotente (create or replace function). Fonction SECURITY DEFINER, comportement pour
-- l'appelant strictement identique (même signature, même valeur de retour) — aucun changement
-- côté edge functions/app-connect nécessaire.
--
-- EXÉCUTÉE ET VÉRIFIÉE EN RÉEL le 30/08/2026 (campagne QA réservation/compte) : reproduit le bug
-- avec un vrai compte de test (client A créé par create-guest-request, compte Connect B créé
-- avec le même e-mail via l'API Admin Supabase, RPC appelée avec le JWT réel de B → une 2e
-- fiche `clients` avec email NULL était bien créée). Fonction corrigée et redéployée en direct
-- (API Management Supabase), puis même scénario rejoué avec un 2e couple client/compte de test :
-- la RPC renvoie désormais exactement le même client_id que celui créé par create-guest-request,
-- et connect-player-prestations (action "list_orders") renvoie bien la prestation d'origine dans
-- le tableau de bord du nouveau compte. Toutes les données de test nettoyées après vérification.
-- ============================================================

create or replace function public.connect_resolve_beneficiary_client_id(p_kind text, p_ref_id uuid)
returns uuid
language plpgsql security definer set search_path = 'public' as $$
declare
  v_owner uuid;
  v_client_id uuid;
  v_prenom text;
  v_nom text;
  v_email text;
  v_label text;
  v_client_row jsonb;
  v_created boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  if p_kind = 'managed' then
    if not exists (select 1 from managed_athlete_profiles where id = p_ref_id and owner_user_id = auth.uid()) then
      raise exception 'Profil géré introuvable ou accès refusé.';
    end if;

    select client_id, prenom, nom into v_client_id, v_prenom, v_nom
      from managed_athlete_profiles where id = p_ref_id;
    if v_client_id is not null then
      return v_client_id;
    end if;

    -- Pas de rattachement par e-mail ici : un profil géré (enfant, proche) n'a pas
    -- d'adresse e-mail propre, donc rien à retrouver dans clients par ce biais.
    insert into clients (nom, type_client, prenom_contact, nom_contact)
      values (v_prenom || ' ' || v_nom, 'particulier', v_prenom, v_nom)
      returning id into v_client_id;
    update managed_athlete_profiles set client_id = v_client_id, updated_at = now() where id = p_ref_id;
    insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
      values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
    return v_client_id;
  end if;

  if p_kind = 'self' then
    v_owner := auth.uid();
  elsif p_kind = 'linked' then
    if p_ref_id is null then
      raise exception 'Sportif requis.';
    end if;
    if p_ref_id = auth.uid() then
      v_owner := auth.uid(); -- garde-fou : "linked" vers soi-même équivaut à "self"
    elsif not exists (
      select 1 from connect_access_relationships
      where owner_user_id = p_ref_id and grantee_user_id = auth.uid()
        and status = 'acceptee' and right_reserver
    ) then
      raise exception 'Autorisation de réservation manquante pour ce sportif.';
    else
      v_owner := p_ref_id;
    end if;
  else
    raise exception 'Type de bénéficiaire invalide.';
  end if;

  -- BUGFIX v87 : récupéré une seule fois ici, réutilisé par les deux branches ci-dessous
  -- (player_profiles ET connect_profile_settings) — voir l'en-tête de ce fichier.
  select email, raw_user_meta_data->>'first_name', raw_user_meta_data->>'last_name'
    into v_email, v_prenom, v_nom
    from auth.users where id = v_owner;

  -- Ligne player_profiles existante (sportif affilié à un club) : même
  -- résolution que resolve_player_client_id, mais keyée sur v_owner (pas
  -- forcément auth.uid()) puisque l'autorisation vient d'être vérifiée
  -- ci-dessus pour le cas "linked".
  select client_id into v_client_id
    from player_profiles where user_id = v_owner limit 1;
  if found then
    if v_client_id is not null then
      return v_client_id;
    end if;

    if v_email is not null then
      v_client_row := find_or_create_client_by_email(
        v_email, 'prospect', 'particulier',
        nullif(trim(coalesce(v_prenom, '') || ' ' || coalesce(v_nom, '')), ''),
        v_nom, v_prenom, null, 'connect'
      );
      v_client_id := (v_client_row->>'id')::uuid;
      v_created := coalesce((v_client_row->>'_created')::boolean, true);
    else
      -- Filet historique : pas d'e-mail résolvable (cas théorique), comportement inchangé.
      insert into clients (nom, type_client, prenom_contact, nom_contact)
        values (coalesce(v_prenom, '') || ' ' || coalesce(v_nom, ''), 'particulier', v_prenom, v_nom)
        returning id into v_client_id;
      v_created := true;
    end if;

    update player_profiles set client_id = v_client_id where user_id = v_owner;
    -- Message de bienvenue uniquement pour une fiche réellement neuve : un client déjà
    -- existant (rattaché par e-mail) a potentiellement déjà un fil de discussion.
    if v_created then
      insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
        values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
    end if;
    return v_client_id;
  end if;

  -- Pas de player_profiles (particulier, ou joueur/sportif sans club) :
  -- connect_profile_settings.client_id, provisionné à la demande.
  select client_id into v_client_id from connect_profile_settings where user_id = v_owner;
  if v_client_id is not null then
    return v_client_id;
  end if;

  v_label := nullif(trim(coalesce(v_prenom, '') || ' ' || coalesce(v_nom, '')), '');
  if v_label is null then
    v_label := coalesce(split_part(v_email, '@', 1), 'Client Connect');
  end if;

  if v_email is not null then
    v_client_row := find_or_create_client_by_email(
      v_email, 'prospect', 'particulier', v_label, v_nom, v_prenom, null, 'connect'
    );
    v_client_id := (v_client_row->>'id')::uuid;
    v_created := coalesce((v_client_row->>'_created')::boolean, true);
  else
    -- Filet historique : pas d'e-mail résolvable (cas théorique), comportement inchangé.
    insert into clients (nom, type_client, prenom_contact, nom_contact)
      values (v_label, 'particulier', v_prenom, v_nom)
      returning id into v_client_id;
    v_created := true;
  end if;

  insert into connect_profile_settings (user_id, client_id, account_type)
    values (v_owner, v_client_id, 'particulier')
  on conflict (user_id) do update set client_id = excluded.client_id;

  if v_created then
    insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
      values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
  end if;

  return v_client_id;
end;
$$;
