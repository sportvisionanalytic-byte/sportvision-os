-- v178 : des messages d'erreur écrits pour des humains (12/09/2026).
--
-- Huit messages renvoyés à l'utilisateur nommaient des colonnes et des tables : « team_id
-- n'appartient pas à club_id », « user_id requis », « clubs.portail_client_id manquant »,
-- « signature_statut = signee ». Ce sont des phrases écrites pour celui qui a écrit le code, pas
-- pour le président de club qui les lit à 22 h.
--
-- Rien d'autre ne change : même logique, même condition, même code d'erreur. Seul le texte est
-- réécrit, et les fonctions sont recopiées telles qu'elles tournent en production.
-- Test : tests/messages-erreur-lisibles.test.sql

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

create or replace function public.check_team_membership_club()
returns trigger language plpgsql as $function$
begin
  if new.club_id <> (select club_id from club_teams where id = new.team_id) then
    raise exception 'Cette équipe n''appartient pas à ce club.';
  end if;
  return new;
end;
$function$;
