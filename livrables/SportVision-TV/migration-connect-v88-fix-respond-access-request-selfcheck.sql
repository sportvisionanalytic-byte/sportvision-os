-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v88
-- Corrige un bug CRITIQUE trouvé par l'audit fonctionnel de l'Espace joueur du 30-31/08/2026 sur
-- l'écran "Accès à mon profil" (/acces) : accepter (ou refuser) une demande d'accès envoyée par
-- un parent/proche/agent échouait SYSTÉMATIQUEMENT avec "Accès refusé.", pour TOUT compte, sans
-- exception — le bouton "Accepter" ne fonctionnait jamais en production.
--
-- ────────────────────────────────────────────────────────────────────────
-- CAUSE EXACTE (reproduite en réel avant d'écrire une seule ligne ci-dessous — compte de test
-- joueur + compte de test "parent" créés via l'API Admin Supabase, vraie demande d'accès insérée,
-- vrai clic Playwright sur "Accepter", RPC rejouée en direct par curl avec le JWT réel du joueur
-- pour confirmer le message d'erreur exact)
-- ────────────────────────────────────────────────────────────────────────
--
-- connect_respond_profile_access_request(p_id, p_accept) (migration-connect-personnel-accueil-
-- profil-acces.sql §2) vérifie correctement que l'appelant est bien owner_user_id (le titulaire du
-- profil qui répond), puis — pour calculer si le DEMANDEUR (grantee_user_id) a atteint sa limite
-- de sportifs suivis avant d'accepter — appelle :
--   connect_particulier_total_sportifs_count(v_row.grantee_user_id)
--   connect_particulier_limit(v_row.grantee_user_id)
--
-- Ces deux fonctions (et connect_agent_effective_tier, appelée en cascade par la deuxième) ont
-- toutes le même garde-fou : `if auth.uid() is null or (auth.uid() <> p_user_id and not
-- is_staff()) then raise exception 'Accès refusé.'`. Elles sont conçues pour qu'un compte ne
-- puisse lire QUE son propre compteur/plafond (ou qu'un membre staff le lise pour n'importe qui).
--
-- Mais dans connect_respond_profile_access_request, l'appelant (auth.uid()) est le PROPRIÉTAIRE
-- DU PROFIL (le joueur qui répond), pas le demandeur (grantee_user_id) — ce sont structurellement
-- deux comptes différents dès qu'une vraie demande existe. Le garde-fou "self-only" de ces deux
-- fonctions bloque donc CET APPEL LÉGITIME dans 100% des cas réels, avant même d'atteindre la
-- logique de plafond : v_count/v_limit ne sont jamais calculés, l'exception 'Accès refusé.' est
-- levée immédiatement et remonte telle quelle jusqu'au client (RequestCard.tsx ne reconnaît que
-- les préfixes PAYWALL_AGENT_LIMIT/PAYWALL_PARTICULIER_LIMIT dans le message d'erreur, donc affiche
-- son message générique "Impossible de traiter cette demande pour le moment.").
--
-- Reproduit en réel le 31/08/2026 : demande "en_attente" insérée en base, clic réel sur
-- "Accepter" → erreur affichée, `connect_access_relationships.status` toujours 'en_attente' en
-- base (l'update n'est jamais atteint). Rejeu direct de la RPC via curl (JWT du compte joueur) :
-- {"code":"P0001","message":"Accès refusé."} — confirme que l'exception vient bien d'un des deux
-- appels self-only ci-dessus, pas d'un autre garde-fou de connect_respond_profile_access_request
-- elle-même (qui aurait un message différent : "Demande introuvable.", "Action non autorisée.",
-- "Cette demande a déjà été traitée.").
--
-- ────────────────────────────────────────────────────────────────────────
-- CORRECTIF
-- ────────────────────────────────────────────────────────────────────────
--
-- connect_respond_profile_access_request calcule désormais elle-même v_count/v_limit pour
-- grantee_user_id, en ligne, plutôt que de passer par connect_particulier_total_sportifs_count/
-- connect_particulier_limit/connect_agent_effective_tier (toutes trois self-only) — même requête
-- exacte que ces fonctions, dupliquée ici parce que connect_respond_profile_access_request a déjà
-- validé plus haut (v_row.owner_user_id = auth.uid()) que l'appelant a un motif légitime de
-- consulter le plafond du demandeur (c'est lui qui décide d'accepter ou non sa demande), sans
-- affaiblir le garde-fou self-only des trois fonctions partagées (laissées strictement inchangées
-- — utilisées ailleurs, notamment connect_create_managed_athlete, où l'appel est déjà avec
-- auth.uid() et où ce garde-fou reste pleinement légitime).
--
-- Idempotente (create or replace function). Signature et valeur de retour inchangées — aucun
-- changement côté app-connect nécessaire.
--
-- EXÉCUTÉE ET VÉRIFIÉE EN RÉEL le 31/08/2026 : même scénario de test rejoué après correctif — clic
-- réel sur "Accepter" → connect_access_relationships.status passe bien à 'acceptee', right_voir/
-- right_download passent à true, plus aucune erreur console/réseau. "Refuser" revérifié aussi
-- (statut 'refusee'). Toutes les données de test nettoyées après vérification.
-- ============================================================

create or replace function public.connect_respond_profile_access_request(p_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = 'public' as $$
declare
  v_row connect_access_relationships%rowtype;
  v_count integer;
  v_limit integer;
  v_profil text;
  v_tier text;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  select * into v_row from connect_access_relationships where id = p_id for update;
  if not found then
    raise exception 'Demande introuvable.';
  end if;
  if v_row.owner_user_id <> auth.uid() then
    raise exception 'Action non autorisée.';
  end if;
  if v_row.status <> 'en_attente' then
    raise exception 'Cette demande a déjà été traitée.';
  end if;

  if p_accept then
    -- BUGFIX v88 : calculé ici (pas via connect_particulier_total_sportifs_count/
    -- connect_particulier_limit/connect_agent_effective_tier, toutes self-only) — voir
    -- l'en-tête de ce fichier. v_row.owner_user_id = auth.uid() vient d'être vérifié ci-dessus :
    -- l'appelant a un motif légitime de consulter le plafond de v_row.grantee_user_id (c'est le
    -- demandeur de LA requête qu'il est en train d'accepter ou de refuser).
    v_count :=
      (select count(*)::int from connect_access_relationships
         where grantee_user_id = v_row.grantee_user_id and status = 'acceptee')
      +
      (select count(*)::int from managed_athlete_profiles
         where owner_user_id = v_row.grantee_user_id);

    select profil_particulier into v_profil from connect_profile_settings where user_id = v_row.grantee_user_id;

    if v_profil = 'agent' then
      select tier into v_tier from connect_agent_subscriptions
        where user_id = v_row.grantee_user_id and status = 'active';
      v_limit := connect_agent_tier_limit(coalesce(v_tier, 'gratuit'));
    elsif v_profil in ('parent', 'tuteur', 'autre') then
      v_limit := 3;
    else
      v_limit := 999; -- profil jamais choisi (compte pré-v67) : pas de plafond rétroactif
    end if;

    if v_count >= v_limit then
      if v_profil = 'agent' then
        raise exception 'PAYWALL_AGENT_LIMIT: Le compte qui vous a envoyé cette demande a atteint la limite de son abonnement Agent (% sportifs sur %). Il doit souscrire ou changer de palier avant de pouvoir suivre un nouveau sportif.', v_count, v_limit;
      else
        raise exception 'PAYWALL_PARTICULIER_LIMIT: Le compte qui vous a envoyé cette demande a atteint sa limite (% sportifs sur %). Il doit contacter SportVision avant de pouvoir suivre un nouveau sportif.', v_count, v_limit;
      end if;
    end if;
  end if;

  update connect_access_relationships
  set
    status = case when p_accept then 'acceptee' else 'refusee' end,
    responded_at = now(),
    right_voir = case when p_accept then true else right_voir end,
    right_download = case when p_accept then true else right_download end,
    updated_at = now()
  where id = p_id;
end;
$$;
