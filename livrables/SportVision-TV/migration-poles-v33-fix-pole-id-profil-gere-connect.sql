-- ============================================================================
-- migration-poles-v33-fix-pole-id-profil-gere-connect.sql
-- Audit de cohérence global demandé par Fouka (01/09/2026) — agent d'audit
-- dédié à Connect, finding CRITIQUE #1 : connect_resolve_beneficiary_
-- client_id() (migration-poles-v13-connect-sport-coherence.sql) résout déjà
-- le sport → pôle pour les branches 'self' et 'linked' (via
-- connect_profile_settings.sport + resolve_pole_by_sport()), mais PAS pour
-- la branche 'managed' (profil géré : enfant, proche) — celle-ci insère
-- directement dans `clients` sans jamais poser `pole_id`, qui retombe donc
-- silencieusement sur le DEFAULT de la colonne (pole_football_id()), même
-- quand le formulaire "Ajouter un profil géré" (ManagedAthleteForm.tsx)
-- déclare explicitement Basketball/Handball/etc. via managed_athlete_
-- profiles.sport (colonne déjà posée à la création, migration-connect-v51).
--
-- Concrètement : un parent qui déclare un enfant Basketball depuis "Mes
-- sportifs" voit ce sportif rattaché au pôle Football dans l'OS — exactement
-- le bug que v13 prétendait avoir corrigé, sauf que v13 n'a jamais couvert
-- cette 3ᵉ branche (le commit qui l'a suivi ne teste que self/linked).
--
-- Correctif : lit managed_athlete_profiles.sport (déjà en base, rien à
-- ajouter côté frontend) et réutilise resolve_pole_by_sport() (v13), déjà
-- SECURITY DEFINER, déjà la seule fonction de résolution sport→pôle du
-- système — aucune nouvelle fonction, aucun nouveau paramètre, signature et
-- comportement des branches 'self'/'linked' strictement inchangés.
-- ============================================================================

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
  v_sport text;
  v_pole_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  if p_kind = 'managed' then
    if not exists (select 1 from managed_athlete_profiles where id = p_ref_id and owner_user_id = auth.uid()) then
      raise exception 'Profil géré introuvable ou accès refusé.';
    end if;

    select client_id, prenom, nom, sport into v_client_id, v_prenom, v_nom, v_sport
      from managed_athlete_profiles where id = p_ref_id;
    if v_client_id is not null then
      return v_client_id;
    end if;

    -- FIX v33 : sport du profil géré (managed_athlete_profiles.sport, saisi dans
    -- ManagedAthleteForm.tsx) résolu en pôle réel s'il en existe un, même logique que
    -- self/linked ci-dessous (resolve_pole_by_sport, v13) — jamais fait avant cette
    -- migration, la ligne clients retombait silencieusement sur pole_football_id().
    v_pole_id := resolve_pole_by_sport(v_sport);

    -- Pas de rattachement par e-mail ici : un profil géré (enfant, proche) n'a pas
    -- d'adresse e-mail propre, donc rien à retrouver dans clients par ce biais.
    insert into clients (nom, type_client, prenom_contact, nom_contact, pole_id)
      values (v_prenom || ' ' || v_nom, 'particulier', v_prenom, v_nom, coalesce(v_pole_id, pole_football_id()))
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

  select email, raw_user_meta_data->>'first_name', raw_user_meta_data->>'last_name'
    into v_email, v_prenom, v_nom
    from auth.users where id = v_owner;

  -- BUGFIX v13 : sport choisi à l'inscription (state.sport, /signup/sport),
  -- écrit dans connect_profile_settings.sport au premier login (voir
  -- lib/signup/pending-onboarding.ts côté app-connect) — résolu ici en pôle
  -- réel s'il en existe un, sinon reste NULL (capté comme signal de demande,
  -- voir resolve_pole_by_sport ci-dessus).
  select sport into v_sport from connect_profile_settings where user_id = v_owner;
  v_pole_id := resolve_pole_by_sport(v_sport);

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
        v_nom, v_prenom, null, 'connect', null, null, v_pole_id
      );
      v_client_id := (v_client_row->>'id')::uuid;
      v_created := coalesce((v_client_row->>'_created')::boolean, true);
    else
      -- Filet historique : pas d'e-mail résolvable (cas théorique), comportement inchangé
      -- hormis pole_id, désormais posé explicitement comme partout ailleurs dans cette fonction.
      insert into clients (nom, type_client, prenom_contact, nom_contact, pole_id)
        values (coalesce(v_prenom, '') || ' ' || coalesce(v_nom, ''), 'particulier', v_prenom, v_nom, coalesce(v_pole_id, pole_football_id()))
        returning id into v_client_id;
      v_created := true;
    end if;

    update player_profiles set client_id = v_client_id where user_id = v_owner;
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
      v_email, 'prospect', 'particulier', v_label, v_nom, v_prenom, null, 'connect', null, null, v_pole_id
    );
    v_client_id := (v_client_row->>'id')::uuid;
    v_created := coalesce((v_client_row->>'_created')::boolean, true);
  else
    -- Filet historique : pas d'e-mail résolvable (cas théorique), comportement inchangé
    -- hormis pole_id, désormais posé explicitement comme partout ailleurs dans cette fonction.
    insert into clients (nom, type_client, prenom_contact, nom_contact, pole_id)
      values (v_label, 'particulier', v_prenom, v_nom, coalesce(v_pole_id, pole_football_id()))
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

-- ROLLBACK : restaurer le corps exact d'avant (voir migration-poles-v13-connect-sport-
-- coherence.sql pour la version sans résolution sport dans la branche 'managed').
