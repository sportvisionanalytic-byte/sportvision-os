-- ============================================================================
-- migration-audit-final-find-or-create-client.sql
-- Audit final autonome (29/08/2026, nuit) — traçage workflows + idempotence
-- ============================================================================
-- "Double création client ne doit pas créer deux profils" (test d'idempotence
-- explicitement demandé). Vérification en base : clients.email n'a aucun
-- doublon actuellement (0 ligne), mais AUCUNE contrainte n'empêche d'en créer
-- — et 4 points d'entrée indépendants (edge functions create-guest-request,
-- create-guest-rdv, portal-onboarding, clubplus-onboarding) reproduisent
-- exactement le même motif non atomique :
--   SELECT clients WHERE email ilike X (maybeSingle)
--   → si absent, INSERT clients (...)
-- Ce sont deux requêtes HTTP/transactions Postgres séparées (via le client
-- supabase-js), donc deux appels concurrents avec le même e-mail (double-clic
-- visiteur, deux onglets, retry réseau) peuvent tous deux lire "absent" avant
-- qu'aucun des deux n'ait écrit → deux lignes clients pour la même personne.
--
-- Pas de contrainte UNIQUE globale sur clients.email : une organisation
-- (club/association/entreprise) peut légitimement partager un contact avec
-- une autre fiche existante selon le contexte commercial — imposer l'unicité
-- globale serait un changement de règle métier, pas un simple correctif
-- d'idempotence (documenté séparément dans le rapport d'audit, non appliqué
-- ici). En revanche, il est sûr et logique de rendre CHAQUE opération
-- individuelle de "trouver-ou-créer pour cet e-mail précis" atomique, ce qui
-- ferme la race condition sans changer aucune règle métier existante.
--
-- Solution : verrou consultatif Postgres (pg_advisory_xact_lock) scopé au
-- hash de l'e-mail, à l'intérieur d'une seule fonction SECURITY DEFINER —
-- deux appels concurrents pour le même e-mail sont désormais sérialisés (le
-- second attend que le premier commit, puis retrouve la ligne fraîchement
-- créée au lieu d'en insérer une seconde).
-- ============================================================================

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
  p_promo_bienvenue_disponible boolean default null
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

  -- Sérialise toutes les créations concurrentes pour un même e-mail : une
  -- seule transaction à la fois peut "trouver-ou-créer" pour cet e-mail,
  -- fermant la fenêtre de course laissée ouverte par le motif SELECT-puis-
  -- INSERT séparé côté edge function. Verrou relâché automatiquement à la
  -- fin de la transaction (xact).
  perform pg_advisory_xact_lock(hashtext(lower(p_email)));

  select * into v_row from clients where lower(email) = lower(p_email) order by created_at asc limit 1;
  if not found then
    insert into clients (
      statut, type_client, nom, nom_contact, prenom_contact, email, telephone,
      origine_prospect, ville, promo_bienvenue_disponible
    ) values (
      coalesce(p_statut, 'prospect')::statut_client, coalesce(p_type_client, 'particulier'), p_nom, p_nom_contact, p_prenom_contact,
      p_email, p_telephone, p_origine_prospect, p_ville, coalesce(p_promo_bienvenue_disponible, false)
    )
    returning * into v_row;
    v_created := true;
  end if;

  -- Retourne la ligne clients complète + un indicateur "_created" (pour un
  -- appelant qui a besoin de distinguer "nouvelle fiche" de "fiche déjà
  -- existante", ex. portal-onboarding pour la promo de bienvenue) sans
  -- changer le type de retour d'une fonction PL/pgSQL déjà exposée en RPC.
  return to_jsonb(v_row) || jsonb_build_object('_created', v_created);
end;
$function$;
