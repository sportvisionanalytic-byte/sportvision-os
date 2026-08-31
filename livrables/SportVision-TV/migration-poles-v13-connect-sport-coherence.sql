-- ============================================================================
-- migration-poles-v13-connect-sport-coherence.sql
-- Cohérence sport/pôle entre l'OS (migration multi-pôles Football+Basket, cette
-- nuit) et SportVision Connect — demandé par Fouka le 31/08/2026 : "il faut
-- rendre coherent avec l'os et connect que les utilisateurs indiquent leur
-- sport etc".
--
-- CONSTAT : le tunnel d'inscription joueur/sportif de Connect a déjà une étape
-- /signup/sport (9 sports : Football, Futsal, Basketball, Handball, Rugby,
-- Volleyball, Athlétisme, Tennis, Autre), mais le choix n'était jamais transmis
-- à la base — tout compte Connect retombait silencieusement sur le pôle
-- Football (DEFAULT pole_football_id() de clients.pole_id), joueur de Basket
-- inclus. Décision produit validée par Fouka : garder les 9 sports au
-- sélecteur, rattacher automatiquement au pôle réel quand il existe
-- (Football/Basket), sinon enregistrer quand même le sport choisi (signal de
-- demande future, connect_profile_settings.sport) et laisser le compte sur
-- Football par défaut.
--
-- CHEMIN RÉEL (vérifié en lisant le code, pas supposé) : la ligne `clients`
-- d'un compte Connect n'est PAS créée pendant l'onboarding (edge function
-- connect-player-onboarding) — elle est créée PARESSEUSEMENT, la première fois
-- que connect_resolve_beneficiary_client_id() est appelée (ex. "Réserver"/"Mes
-- commandes"). Le sport, lui, est connu bien avant : le front-end (partie 2 de
-- cette tranche, hors SQL) écrit désormais state.sport dans
-- connect_profile_settings.sport au moment du rejeu de l'onboarding (premier
-- login), donc largement avant tout premier appel à
-- connect_resolve_beneficiary_client_id(). La résolution sport → pôle se fait
-- donc ICI, en lisant connect_profile_settings.sport, pas dans l'edge
-- function — pas besoin de faire voyager pole_id à travers une couche
-- supplémentaire.
--
-- Un utilisateur Connect n'a pas de ligne `profiles` (réservé au staff), donc
-- ne peut pas lire la table `poles` en direct (RLS poles_select_staff l'exige)
-- — la résolution doit rester côté fonction SECURITY DEFINER, jamais côté
-- client.
-- ============================================================================

-- 1) Résolution sport (texte libre du sélecteur Connect) → pôle actif.
--    ilike : insensible à la casse. Retourne NULL sans erreur si aucun pôle
--    actif ne correspond (Handball, Rugby, Volleyball, Athlétisme, Tennis,
--    Futsal, Autre à ce jour) — c'est le comportement "capter la demande"
--    voulu, jamais un pôle inventé.
create or replace function public.resolve_pole_by_sport(p_sport text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select id from poles where p_sport is not null and sport ilike p_sport limit 1;
$function$;

comment on function public.resolve_pole_by_sport(text) is
  'Sport choisi (texte libre du sélecteur Connect, ex. connect_profile_settings.sport) -> id du pôle actif correspondant, ou NULL si aucun pôle ne couvre ce sport (signal de demande hors pôle actif).';

-- 2) find_or_create_client_by_email : ajoute p_pole_id en dernière position,
--    default null, donc AUCUN appelant existant (create-guest-request,
--    create-guest-rdv, portal-onboarding, clubplus-onboarding, tous en appel
--    positionnel à 10 args) n'a besoin d'être modifié.
--    - Création : pose explicitement pole_id = coalesce(p_pole_id,
--      pole_football_id()) — valeur strictement identique à ce que produisait
--      déjà la colonne DEFAULT quand pole_id était omis de l'insert.
--    - Ligne déjà existante (ex. créée par une demande invité AVANT
--      inscription Connect) : si elle est encore sur le pôle par défaut
--      (Football) ET qu'un pôle différent est resté résolu pour ce compte, on
--      la corrige — sans jamais écraser un pole_id déjà posé manuellement par
--      le staff ou par une affectation réelle à un autre pôle.
drop function if exists public.find_or_create_client_by_email(text,text,text,text,text,text,text,text,text,boolean);

create or replace function public.find_or_create_client_by_email(
  p_email text,
  p_statut text default 'prospect',
  p_type_client text default 'particulier',
  p_nom text default null,
  p_nom_contact text default null,
  p_prenom_contact text default null,
  p_telephone text default null,
  p_origine_prospect text default null,
  p_ville text default null,
  p_promo_bienvenue_disponible boolean default null,
  p_pole_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row clients;
  v_created boolean := false;
begin
  if p_email is null or btrim(p_email) = '' then
    raise exception 'email requis';
  end if;

  perform pg_advisory_xact_lock(hashtext(lower(p_email)));

  select * into v_row from clients where lower(email) = lower(p_email) order by created_at asc limit 1;
  if not found then
    insert into clients (
      statut, type_client, nom, nom_contact, prenom_contact, email, telephone,
      origine_prospect, ville, promo_bienvenue_disponible, pole_id
    ) values (
      coalesce(p_statut, 'prospect')::statut_client, coalesce(p_type_client, 'particulier'), p_nom, p_nom_contact, p_prenom_contact,
      p_email, p_telephone, p_origine_prospect, p_ville, coalesce(p_promo_bienvenue_disponible, false),
      coalesce(p_pole_id, pole_football_id())
    )
    returning * into v_row;
    v_created := true;
  elsif p_pole_id is not null and v_row.pole_id = pole_football_id() and p_pole_id <> pole_football_id() then
    update clients set pole_id = p_pole_id, updated_at = now() where id = v_row.id
      returning * into v_row;
  end if;

  return to_jsonb(v_row) || jsonb_build_object('_created', v_created);
end;
$function$;

-- 3) connect_resolve_beneficiary_client_id : signature INCHANGÉE (aucun
--    appelant à modifier). Résout le sport depuis
--    connect_profile_settings.sport (v_owner) juste avant chaque création de
--    ligne clients, dans les deux branches qui en créent une (player_profiles
--    sans client_id encore rattaché ; connect_profile_settings sans client_id
--    encore provisionné) et dans leurs filets historiques respectifs (compte
--    sans e-mail résolvable, cas théorique déjà présent avant cette
--    migration).
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

-- ============================================================================
-- ROLLBACK (documenté, non exécuté) :
--   - restaurer find_or_create_client_by_email à 10 paramètres (voir
--     migration-audit-final-find-or-create-client.sql pour le corps exact) ;
--   - restaurer connect_resolve_beneficiary_client_id (voir migration-
--     connect-v87-fix-rattachement-client-guest-vers-connect.sql pour le corps
--     exact) ;
--   - drop function public.resolve_pole_by_sport(text);
-- Aucune donnée existante modifiée par cette migration elle-même (elle ne
-- fait qu'ajouter du code) : aucun rollback de données nécessaire.
-- ============================================================================
