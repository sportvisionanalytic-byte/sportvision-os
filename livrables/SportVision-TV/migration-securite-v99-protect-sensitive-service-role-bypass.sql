-- ============================================================================
-- migration-securite-v99-protect-sensitive-service-role-bypass.sql
-- ============================================================================
-- Trouvé en testant le E2E complet Vitrine->OS->production->livrable->facture
-- ->paiement (20/08) : le webhook Stripe (stripe-webhook, service_role) tente
-- de mettre à jour prestations.statut_financier après un paiement réussi —
-- bloqué par le trigger protect_sensitive_prestation_fields(), qui vérifie
-- auth.uid()/profiles.role sans jamais tenir compte du rôle Postgres
-- service_role (auth.uid() est NULL pour un appel service_role, donc
-- is_privileged=false, l'update est rejeté). Le code du webhook ne vérifie
-- même pas l'erreur retournée (`const { data } = await admin.from(...)`),
-- donc cet échec est TOTALEMENT SILENCIEUX depuis la création du trigger :
-- un client qui paie réellement via Stripe peut voir sa prestation rester
-- affichée "non facturée"/"en retard" dans l'OS, exposant le staff au risque
-- de relancer un client qui a déjà payé.
--
-- protect_sensitive_club_fields() a DÉJÀ ce garde (`if auth.role() =
-- 'service_role' then return new; end if;`, ajouté antérieurement pour une
-- raison similaire) — la leçon n'avait simplement jamais été propagée aux 15
-- autres triggers `protect_sensitive_*_fields` du même patron. Ce fichier
-- ajoute exactement le même garde, au même endroit (juste après `begin`),
-- sans toucher au reste de la logique de chacun — additif pur.
-- ============================================================================


-- protect_sensitive_affectation_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_affectation_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_privileged boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','prod','sec')
  ) into is_privileged;

  if is_privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.remuneration is not null
       or new.frais_km is not null
       or new.est_responsable is true
       or coalesce(new.statut_paiement,'en_attente') <> 'en_attente'
       or new.date_paiement is not null
       or new.statut is distinct from 'invitation_envoyée'
    then
      raise exception 'Modification non autorisée : rémunération, frais, statut de paiement et responsabilité sont réservés à la Production/Comptabilité.';
    end if;
    return new;
  end if;

  -- UPDATE : champs toujours réservés à la Production/Comptabilité
  if new.remuneration is distinct from old.remuneration
     or new.frais_km is distinct from old.frais_km
     or new.est_responsable is distinct from old.est_responsable
     or new.statut_paiement is distinct from old.statut_paiement
     or new.date_paiement is distinct from old.date_paiement
     or new.prestation_id is distinct from old.prestation_id
     or new.collaborateur_id is distinct from old.collaborateur_id
  then
    raise exception 'Modification non autorisée : rémunération, frais, statut de paiement, responsabilité et affectation sont réservés à la Production/Comptabilité.';
  end if;

  -- Seule transition self-service autorisée : répondre à sa propre invitation
  if new.statut is distinct from old.statut then
    if not (
      old.statut in ('invitation_envoyée','en_attente')
      and new.statut in ('acceptée','refusée')
      and old.collaborateur_id = auth.uid()
    ) then
      raise exception 'Modification non autorisée : seule l''acceptation ou le refus de votre propre invitation est permis sans validation Production.';
    end if;
  end if;

  return new;
end;
$function$
;

-- protect_sensitive_client_user_fields
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
      raise exception 'Modification non autorisée : client_id est réservé au staff SportVision.';
    end if;
  end if;

  return new;
end;
$function$
;

-- protect_sensitive_club_match_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_club_match_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_privileged boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod')) into is_privileged;
  if is_privileged then
    return new;
  end if;
  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : le club d''un match ne peut pas être changé.';
  end if;
  return new;
end;
$function$
;

-- protect_sensitive_club_member_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_club_member_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_os_staff boolean;
  is_this_club_admin boolean;
  is_self_accepting_own_invitation boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into is_os_staff;

  select is_club_admin(old.club_id) into is_this_club_admin;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : club_id est immuable, une adhésion ne se déplace pas par UPDATE.';
  end if;

  -- 19/08/2026 (audit pré-lancement, migration-connect-v15) : un admin ne peut pas
  -- modifier SA PROPRE ligne pour perdre son statut d'admin actif (se suspendre ou
  -- se rétrograder lui-même) via un appel API direct hors UI. Seul le staff OS peut
  -- le faire (branche is_os_staff ci-dessus), pour un transfert de propriété
  -- légitime. Additive : ne touche à rien d'autre du comportement existant.
  if is_this_club_admin and not is_os_staff and old.user_id = auth.uid()
     and (new.status is distinct from 'actif' or new.role is distinct from 'admin')
  then
    raise exception 'Un administrateur ne peut pas se retirer ses propres droits d''administration.';
  end if;

  -- Auto-acceptation de sa propre invitation : la seule transition qu'un
  -- non-admin/non-staff peut déclencher sur role/status. Rôle strictement
  -- inchangé, statut strictement invitation -> actif, et uniquement sur sa
  -- propre ligne (auth.uid() = old.user_id, jamais un tiers).
  is_self_accepting_own_invitation :=
    auth.uid() = old.user_id
    and old.status = 'invitation'
    and new.status = 'actif'
    and new.role = old.role;

  if not is_os_staff and not is_this_club_admin and not is_self_accepting_own_invitation then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
    then
      raise exception 'Modification non autorisée : rôle et statut sont réservés à l''administrateur du club ou au staff SportVision.';
    end if;
  end if;

  return new;
end;
$function$
;

-- protect_sensitive_club_request_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_club_request_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_staff boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','cm','sec','prod')
  ) into v_is_staff;

  if v_is_staff then
    return new;
  end if;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : le club d''une demande ne peut pas être changé.';
  end if;

  if new.status is distinct from old.status or new.credits_reserved is distinct from old.credits_reserved then
    if not (old.status = 'recues' and new.status = 'refusee' and new.credits_reserved = 0) then
      raise exception 'Modification non autorisée : le statut et les crédits d''une demande ne peuvent être modifiés que par SportVision, ou pour annuler une demande non encore prise en charge.';
    end if;
  end if;

  return new;
end;
$function$
;

-- protect_sensitive_formation_inscription_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_formation_inscription_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_privileged boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod')) into is_privileged;
  if is_privileged then
    return new;
  end if;
  if old.xp_gagnes is distinct from 0 and new.xp_gagnes is distinct from old.xp_gagnes then
    raise exception 'Modification non autorisée : les XP gagnés sont attribués par SportVision, pas déclarés par le collaborateur.';
  end if;
  return new;
end;
$function$
;

-- protect_sensitive_incident_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_incident_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_privileged boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod','sec')) into is_privileged;
  if is_privileged then
    return new;
  end if;
  if new.cloture is distinct from old.cloture
     or new.cloture_par is distinct from old.cloture_par
     or new.cloture_at is distinct from old.cloture_at
     or new.resolution is distinct from old.resolution
     or new.prestation_id is distinct from old.prestation_id
     or new.declare_par is distinct from old.declare_par
  then
    raise exception 'Modification non autorisée : la clôture d''un incident est réservée à l''administration, la production ou la sécurité.';
  end if;
  return new;
end;
$function$
;

-- protect_sensitive_kit_reservation_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_kit_reservation_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_privileged boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod')) into is_privileged;
  if is_privileged then
    return new;
  end if;
  if new.kit_id is distinct from old.kit_id
     or new.prestation_id is distinct from old.prestation_id
     or new.collaborateur_id is distinct from old.collaborateur_id
     or new.responsable_id is distinct from old.responsable_id
  then
    raise exception 'Modification non autorisée : le rattachement d''une réservation (kit, prestation, collaborateur) est réservé à l''administration/production.';
  end if;
  return new;
end;
$function$
;

-- protect_sensitive_membership_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_membership_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_staff boolean;
  v_is_org_admin boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','sec')
  ) into v_is_staff;

  if v_is_staff then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'Modification non autorisée : l''organisation d''une adhésion est immuable.';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'Modification non autorisée : une adhésion ne peut pas être réattribuée à un autre utilisateur.';
  end if;

  select is_org_admin(old.organization_id) into v_is_org_admin;

  -- Cas 1 : un admin de l'organisation modifie un AUTRE membre. Jamais
  -- sa propre ligne par ce chemin — évite qu'un admin se rétrograde ou
  -- se suspende lui-même par erreur et verrouille son organisation sans
  -- personne pour revenir en arrière (aucun admin de secours automatique
  -- n'existe, donc ce garde-fou est la seule protection pour l'instant).
  if v_is_org_admin and old.user_id is distinct from auth.uid() then
    if new.role is distinct from old.role then
      if not exists (
        select 1 from organization_role_catalog rc
        join organizations o on o.organization_type = rc.organization_type
        where o.id = old.organization_id and rc.role_key = new.role
      ) then
        raise exception 'Rôle invalide pour ce type d''organisation.';
      end if;
    end if;
    if new.status is distinct from old.status then
      if new.status not in ('actif', 'suspendu') then
        raise exception 'Statut invalide : un admin d''organisation peut seulement activer ou suspendre un membre.';
      end if;
      if old.status = 'invitation' and new.status = 'suspendu' then
        raise exception 'Une invitation en attente ne peut pas être suspendue, seulement annulée par le staff.';
      end if;
    end if;
    return new;
  end if;

  -- Cas 2 : self-activation (inchangé depuis v5).
  if new.role is distinct from old.role then
    raise exception 'Modification non autorisée : le rôle est réservé au staff SportVision ou à un administrateur de l''organisation.';
  end if;

  if new.status is distinct from old.status then
    if not (old.status = 'invitation' and new.status = 'actif' and old.user_id = auth.uid()) then
      raise exception 'Modification non autorisée : seule l''activation de votre propre invitation est permise en self-service.';
    end if;
  end if;

  return new;
end;
$function$
;

-- protect_sensitive_ppr_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_ppr_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.player_id is distinct from old.player_id then
    raise exception 'Modification non autorisée : le rattachement à un autre enfant n''est pas permis depuis cette action.';
  end if;
  if new.parent_id is distinct from old.parent_id then
    raise exception 'Modification non autorisée : le parent d''une relation ne peut pas être changé.';
  end if;
  return new;
end;
$function$
;

-- protect_sensitive_prestation_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_prestation_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_privileged boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod','compta')
  ) into is_privileged;

  if not is_privileged then
    if new.montant_ht is distinct from old.montant_ht
       or new.montant_ttc is distinct from old.montant_ttc
       or new.tva_pct is distinct from old.tva_pct
       or new.acompte_montant is distinct from old.acompte_montant
       or new.acompte_recu is distinct from old.acompte_recu
       or new.acompte_date is distinct from old.acompte_date
       or new.statut_financier is distinct from old.statut_financier
       or new.contrat_signe is distinct from old.contrat_signe
       or new.budget_client is distinct from old.budget_client
       or new.client_id is distinct from old.client_id
    then
      raise exception 'Modification non autorisée : les champs financiers et le rattachement client sont réservés à l''administration.';
    end if;
  end if;

  return new;
end;
$function$
;

-- protect_sensitive_profile_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_admin boolean;
  is_lead_cm boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role = 'admin'
  ) into is_admin;

  select exists(
    select 1 from profiles where id = auth.uid() and role = 'cm' and niveau_cm = 'cm_lead'
  ) into is_lead_cm;

  if not is_admin then
    if new.role is distinct from old.role
       or new.grade is distinct from old.grade
       or new.grade_valide_at is distinct from old.grade_valide_at
       or new.grade_valide_par is distinct from old.grade_valide_par
       or new.actif is distinct from old.actif
    then
      raise exception 'Modification non autorisée : rôle, grade et statut du compte sont réservés à l''administrateur.';
    end if;
    if new.niveau_cm is distinct from old.niveau_cm and not is_lead_cm then
      raise exception 'Modification non autorisée : le niveau CM est réservé à l''administrateur ou au Lead CM.';
    end if;
  end if;

  return new;
end;
$function$
;

-- protect_sensitive_request_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_request_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_staff boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','cm','sec','prod')
  ) into v_is_staff;

  if v_is_staff then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'Modification non autorisée : l''organisation d''une demande ne peut pas être changée.';
  end if;

  if new.status is distinct from old.status or new.credits_reserved is distinct from old.credits_reserved then
    if not (old.status = 'recues' and new.status = 'refusee' and new.credits_reserved = 0) then
      raise exception 'Modification non autorisée : le statut et les crédits d''une demande ne peuvent être modifiés que par SportVision, ou pour annuler une demande non encore prise en charge.';
    end if;
  end if;

  return new;
end;
$function$
;

-- protect_sensitive_retractation_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_retractation_fields()
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
    select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'compta')
  ) into is_os_staff;

  if is_os_staff then
    return new;
  end if;

  if new.statut is distinct from old.statut
     or new.traitee_par is distinct from old.traitee_par
     or new.traitee_at is distinct from old.traitee_at
     or new.note_staff is distinct from old.note_staff
  then
    raise exception 'Modification non autorisée : le traitement d''une demande de rétractation est réservé au staff SportVision.';
  end if;

  return new;
end;
$function$
;

-- protect_sensitive_team_project_draft_fields
CREATE OR REPLACE FUNCTION public.protect_sensitive_team_project_draft_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if exists(select 1 from profiles where id = auth.uid() and role = 'admin') or is_club_admin(new.club_id) then
    return new;
  end if;
  if new.team_id is distinct from old.team_id
     or new.club_id is distinct from old.club_id
     or new.catalogue_offre_id is distinct from old.catalogue_offre_id
     or new.montant_cible is distinct from old.montant_cible
  then
    raise exception 'Modification non autorisée : l''équipe, le club, l''offre et le montant cible d''un projet ne peuvent être modifiés que par un administrateur du club, même en brouillon.';
  end if;
  return new;
end;
$function$
;
