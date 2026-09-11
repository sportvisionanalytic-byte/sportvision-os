-- ============================================================================================
-- migration-blocages-review-4-client-joueur.sql
-- Blocage n°4 de l'audit Review du 11/09/2026 (« Mes commandes » et « Factures & paiements »
-- inutilisables dans Connect), vérifié en PRODUCTION le 11/09/2026 : ce n'est PAS un défaut CORS.
-- ============================================================================================
--
-- LE CONSTAT, PAR LE CHEMIN RÉEL (connect.sportvision-an.fr, vrai compte joueur de test rattaché à
-- Villeneuve 340 SC) :
--   - le préflight de connect-player-prestations répond 200 avec les bons en-têtes ; la réponse
--     porte Access-Control-Allow-Origin ; aucune erreur CORS dans la console ;
--   - mais la fonction répond 404 { error: "Le rattachement client d'une fiche joueur ne se
--     modifie pas depuis cet espace." } et l'écran affiche « Impossible de charger vos commandes /
--     vos factures pour le moment ». Un parent (espace particulier) n'est pas touché.
--
-- LA CAUSE. À la première visite, connect-player-prestations fait créer le client du joueur
-- (connect_resolve_beneficiary_client_id), puis l'inscrit sur sa fiche :
--   update player_profiles set client_id = … where user_id = <le joueur>;
-- Depuis la v109 (10/09/2026), le déclencheur proteger_identite_joueur refuse tout changement de
-- player_profiles.client_id qui ne vient ni du service_role ni du staff de l'OS. La fonction est
-- SECURITY DEFINER, mais auth.role() y reste « authenticated » : le rattachement est refusé, la
-- transaction entière est annulée, et TOUT joueur rattaché à un club dont la fiche n'a pas encore
-- de client est bloqué — Mes commandes, Factures & paiements, Réserver (create_request passe par
-- la même résolution), et Messages (resolve_player_client_id, même mise à jour). Au 11/09/2026,
-- aucun compte joueur réel n'existe encore en production : personne n'a été touché, tous les
-- prochains le seraient.
--
-- LE CORRECTIF, AU PLUS ÉTROIT. Le déclencheur garde sa règle (un écran ne déplace pas ce lien :
-- c'est ce qui empêche de s'attribuer le client d'un autre). Il laisse passer UN SEUL cas : le
-- PREMIER rattachement (client_id NULL → valeur) posé par les deux fonctions de résolution, qui
-- le signalent par le marqueur transactionnel déjà en usage pour les écritures système
-- (sv.ecriture_systeme, v133/v135). Ce marqueur ne peut pas être posé depuis l'API : PostgREST ne
-- règle que des paramètres request.*, et set_config n'est pas exposé. Les deux fonctions le posent
-- juste avant leur mise à jour et le retirent juste après.
--   - Remplacer un client déjà rattaché reste refusé à tous, marqueur ou non.
--   - Une mise à jour directe de client_id par un joueur, un parent, un coach, le Président ou un
--     CM reste refusée (testé).
--   - Rien d'autre ne change dans les trois fonctions : leurs définitions de production du
--     11/09/2026 sont reprises à l'identique, aux lignes du marqueur près.
--
-- GARDE-FOU. Les trois fonctions sont recréées à partir de leur définition de production du
-- 11/09/2026. Si l'une a changé depuis (d'autres sessions migrent en parallèle), la migration
-- s'arrête AVANT toute modification. Rejouable : un second passage reconnaît ses définitions.
--
-- Testée en transaction annulée : tests/blocages-review-client-joueur.test.sql (rouge sans elle).
-- Vérification par le chemin réel après exécution : tests/blocages-review.test.mjs (point 4).
-- ============================================================================================

begin;

set lock_timeout = '5s';

-- ── 0. Garde-fou ─────────────────────────────────────────────────────────────────────────────
do $garde$
declare
  f_trigger text := md5(pg_get_functiondef('public.proteger_identite_joueur()'::regprocedure));
  f_benef   text := md5(pg_get_functiondef('public.connect_resolve_beneficiary_client_id(text, uuid)'::regprocedure));
  f_joueur  text := md5(pg_get_functiondef('public.resolve_player_client_id(uuid)'::regprocedure));
begin
  if f_trigger not in ('7bc2652946aadc2745001de75be43824', 'fd496589725216aa256cd7dc3b17e05c') then
    raise exception 'blocages-review-4 : proteger_identite_joueur a changé depuis le 11/09/2026 (md5 %). Rien n''a été modifié.', f_trigger;
  end if;
  if f_benef not in ('878aab32e516adf7ff991dd0afc894ed', '0cf034654f89bf1e9a1cac589ee88cc0') then
    raise exception 'blocages-review-4 : connect_resolve_beneficiary_client_id a changé depuis le 11/09/2026 (md5 %). Rien n''a été modifié.', f_benef;
  end if;
  if f_joueur not in ('3c17784ff457fa64097e8d099970010b', '1dafc92a139411b145007bd5a6497a30') then
    raise exception 'blocages-review-4 : resolve_player_client_id a changé depuis le 11/09/2026 (md5 %). Rien n''a été modifié.', f_joueur;
  end if;
end $garde$;

-- ── 1. Le déclencheur : le premier rattachement système passe, rien d'autre ────────────────
CREATE OR REPLACE FUNCTION public.proteger_identite_joueur()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_is_os_staff boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into v_is_os_staff;
  if v_is_os_staff then
    return new;
  end if;

  -- Le rattachement à un compte ne se déplace pas à la main. C'est ce lien qui décide de tout le
  -- reste : le confier à un écran, c'est permettre de s'attribuer la fiche d'un autre.
  if new.user_id is distinct from old.user_id then
    raise exception 'Le compte rattaché à une fiche joueur ne se modifie pas depuis cet espace.';
  end if;
  if new.client_id is distinct from old.client_id then
    -- 11/09/2026 (blocages-review-4) : seule exception, le PREMIER rattachement (NULL → client)
    -- posé par connect_resolve_beneficiary_client_id ou resolve_player_client_id, qui le signalent
    -- par ce marqueur transactionnel (non réglable depuis l'API). Sans elle, aucun joueur rattaché
    -- à un club ne pouvait ouvrir Mes commandes, Factures & paiements, Réserver ni Messages.
    -- Remplacer un client déjà rattaché reste refusé à tous.
    if not (old.client_id is null and new.client_id is not null
            and current_setting('sv.ecriture_systeme', true) = 'client_joueur') then
      raise exception 'Le rattachement client d''une fiche joueur ne se modifie pas depuis cet espace.';
    end if;
  end if;

  -- Fiche revendiquée : l'identité appartient à la personne. Elle seule peut la corriger, via
  -- `pp_self_update`. Le club garde la main sur tout ce qui est sportif.
  if old.user_id is not null and old.user_id is distinct from auth.uid() then
    if new.prenom is distinct from old.prenom
       or new.nom is distinct from old.nom
       or new.date_naissance is distinct from old.date_naissance
    then
      raise exception 'Cette fiche appartient désormais à son titulaire : son identité ne se modifie plus depuis l''espace du club.';
    end if;
  end if;

  return new;
end;
$function$;

-- ── 2. Les deux fonctions de résolution : le marqueur autour de leur seule mise à jour ─────
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

    -- Premier rattachement de la fiche à son client : marqueur reconnu par proteger_identite_joueur
    -- (blocages-review-4, 11/09/2026), retiré aussitôt la mise à jour faite.
    perform set_config('sv.ecriture_systeme', 'client_joueur', true);
    update player_profiles set client_id = v_client_id where user_id = v_owner;
    perform set_config('sv.ecriture_systeme', '', true);
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
$function$;

CREATE OR REPLACE FUNCTION public.resolve_player_client_id(p_player_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
  v_prenom text;
  v_nom text;
begin
  select client_id, prenom, nom into v_client_id, v_prenom, v_nom
  from player_profiles
  where id = p_player_id and user_id = auth.uid();

  if not found then
    raise exception 'Joueur introuvable ou accès refusé.';
  end if;

  if v_client_id is not null then
    return v_client_id;
  end if;

  insert into clients (nom, type_client, prenom_contact, nom_contact)
  values (v_prenom || ' ' || v_nom, 'particulier', v_prenom, v_nom)
  returning id into v_client_id;

  -- Premier rattachement de la fiche à son client : marqueur reconnu par proteger_identite_joueur
  -- (blocages-review-4, 11/09/2026), retiré aussitôt la mise à jour faite.
  perform set_config('sv.ecriture_systeme', 'client_joueur', true);
  update player_profiles set client_id = v_client_id where id = p_player_id;
  perform set_config('sv.ecriture_systeme', '', true);

  insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
    values (
      v_client_id, 'staff', null,
      'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.'
    );

  return v_client_id;
end;
$function$;

commit;
