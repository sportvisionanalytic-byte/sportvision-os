-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v76.2
-- Uniformise le message de bienvenue automatique dans "Messages"
-- entre TOUS les chemins de création d'un client Connect.
--
-- Contexte : audit de finalisation Connect avant lancement (18/08).
-- resolve_player_client_id (migration-connect-v43, message de bienvenue
-- ajouté en v56) insère "Bienvenue sur SportVision Connect..." la
-- première fois qu'un joueur AVEC club ouvre /messages. Mais
-- connect_resolve_beneficiary_client_id (migration-connect-v72), qui
-- gère les 3 autres cas — sportif "managed" (profil géré par un parent/
-- agent), sportif affilié via player_profiles mais résolu pour un autre
-- utilisateur (cas "linked"), et particulier/joueur sans club (repli
-- connect_profile_settings) — ne le faisait dans AUCUNE de ses 3
-- branches de création de ligne `clients`. Un particulier ou un joueur
-- sans club n'avait donc jamais ce premier message, contrairement à un
-- joueur avec club : incohérence d'expérience selon le type de compte.
--
-- Effet : ajoute le même insert `messages_client` (auteur_type='staff',
-- auteur_staff_id=null, même texte que v56) dans les 3 branches de
-- connect_resolve_beneficiary_client_id, juste après la création de
-- chaque nouveau client_id. Idempotent pour les mêmes raisons que v56 :
-- chaque branche ne s'exécute que lors de la toute première résolution
-- (client_id encore nul), jamais rejouée ensuite.
--
-- EXÉCUTÉE le 18/08/2026 via Supabase Management API, vérifiée par
-- relecture de pg_get_functiondef (3 occurrences du message confirmées).
-- Zéro client existant affecté : remplacement de fonction (CREATE OR
-- REPLACE), aucune donnée déjà en base n'est modifiée rétroactivement.
-- ============================================================

CREATE OR REPLACE FUNCTION public.connect_resolve_beneficiary_client_id(p_kind text, p_ref_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_client_id uuid;
  v_prenom text;
  v_nom text;
  v_email text;
  v_label text;
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

  -- Ligne player_profiles existante (sportif affilié à un club) : même
  -- résolution que resolve_player_client_id, mais keyée sur v_owner (pas
  -- forcément auth.uid()) puisque l'autorisation vient d'être vérifiée
  -- ci-dessus pour le cas "linked".
  select client_id, prenom, nom into v_client_id, v_prenom, v_nom
    from player_profiles where user_id = v_owner limit 1;
  if found then
    if v_client_id is not null then
      return v_client_id;
    end if;
    insert into clients (nom, type_client, prenom_contact, nom_contact)
      values (coalesce(v_prenom, '') || ' ' || coalesce(v_nom, ''), 'particulier', v_prenom, v_nom)
      returning id into v_client_id;
    update player_profiles set client_id = v_client_id where user_id = v_owner;
    insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
      values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
    return v_client_id;
  end if;

  -- Pas de player_profiles (particulier, ou joueur/sportif sans club) :
  -- connect_profile_settings.client_id, provisionné à la demande.
  select client_id into v_client_id from connect_profile_settings where user_id = v_owner;
  if v_client_id is not null then
    return v_client_id;
  end if;

  select email, raw_user_meta_data->>'first_name', raw_user_meta_data->>'last_name'
    into v_email, v_prenom, v_nom
    from auth.users where id = v_owner;
  v_label := nullif(trim(coalesce(v_prenom, '') || ' ' || coalesce(v_nom, '')), '');
  if v_label is null then
    v_label := coalesce(split_part(v_email, '@', 1), 'Client Connect');
  end if;

  insert into clients (nom, type_client, prenom_contact, nom_contact)
    values (v_label, 'particulier', v_prenom, v_nom)
    returning id into v_client_id;

  insert into connect_profile_settings (user_id, client_id, account_type)
    values (v_owner, v_client_id, 'particulier')
  on conflict (user_id) do update set client_id = excluded.client_id;

  insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
    values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');

  return v_client_id;
end;
$function$;
