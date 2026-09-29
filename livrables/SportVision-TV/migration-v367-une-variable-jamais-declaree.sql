-- v367 — UNE VARIABLE JAMAIS DÉCLARÉE, ET LA PREMIÈRE DEMANDE D'ACCÈS AURAIT ÉCHOUÉ (30/09/2026)
--
-- Trouvé par l'audit de la base. `connect_respond_profile_access_request` — le geste par lequel
-- quelqu'un ACCEPTE ou REFUSE qu'un agent, un parent ou un proche suive son profil — utilise
-- `v_proprietaire` dans le calcul du plafond, et ne la déclare nulle part. Le bloc `declare` ne
-- contient que `v_row`, `v_count`, `v_limit`, `v_profil`, `v_tier`.
--
-- QUAND ÇA CASSE, ET POURQUOI PERSONNE NE L'A VU. La ligne fautive est dans la branche `else`,
-- atteinte seulement quand `v_profil` ne vaut ni 'agent' ni parent/tuteur/autre — c'est-à-dire quand
-- le demandeur n'a AUCUNE ligne `connect_profile_settings`, donc quand `v_profil` est nul. Mesuré
-- par l'audit : erreur 42703 « column "v_proprietaire" does not exist ». Zéro demande en attente
-- aujourd'hui, donc personne n'est bloqué : la PREMIÈRE le sera, et le message qu'elle recevra ne
-- lui dira rien.
--
-- CE QUE LA VARIABLE DÉSIGNAIT, établi en lisant le bloc et non en devinant : tout le calcul du
-- plafond porte sur `v_row.grantee_user_id` — le compteur, le profil, le palier d'abonnement. Cette
-- ligne-ci lit la date de création des réglages du même compte, pour accorder 999 au lieu de 3 aux
-- comptes antérieurs au 16/08 (droits acquis pré-v67, v197). C'est donc bien le demandeur.
--
-- Le corps est repris de `pg_get_functiondef` : une seule chaîne change, rien n'est recopié à la
-- main.


CREATE OR REPLACE FUNCTION public.connect_respond_profile_access_request(p_id uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      v_limit := case when (select cps.created_at from connect_profile_settings cps
                           where cps.user_id = v_row.grantee_user_id) < timestamptz '2026-08-16 00:00:00+00'
                     then 999 else 3 end; -- droits acquis pré-v67 seulement (v197)
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
$function$;

notify pgrst, 'reload schema';
