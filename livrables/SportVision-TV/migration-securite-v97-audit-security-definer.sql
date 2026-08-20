-- ============================================================================
-- migration-securite-v97-audit-security-definer.sql
-- ============================================================================
-- Suite de l'audit systématique des 148 fonctions SECURITY DEFINER du schéma
-- public (20/08 nuit, P0 audit externe). Corrige 4 problèmes réels trouvés :
--
-- 1) enqueue_notification/check_factures_en_retard/check_devis_sans_reponse/
--    check_echeances_depenses/send_prestation_reminders : un correctif était
--    DÉJÀ ÉCRIT (migration-securite-enqueue-notification.sql) mais jamais
--    exécuté en production — vérifié : anon/authenticated avaient toujours
--    EXECUTE au moment d'écrire ce fichier. Exécuté ici (contenu identique).
--
-- 2) notify_client_members / connect_notify_by_client_id : même faille que
--    enqueue_notification (relais de phishing/spam via le canal de
--    notification SportVision), jamais couverte par le correctif précédent.
--    Vérifié : appelées uniquement via `perform` depuis d'autres fonctions
--    SECURITY DEFINER (triggers) — jamais depuis le frontend OS/Connect en
--    RPC directe. Les appels internes continuent de fonctionner après le
--    revoke (s'exécutent avec les droits du propriétaire de la fonction
--    appelante, pas du rôle HTTP d'origine).
--
-- 3) connect_athlete_profile_coalesce_update / connect_declare_club : AUCUNE
--    vérification auth.uid() interne, et p_target_user_id/p_user_id pris tels
--    quels depuis les paramètres — un appelant anonyme pouvait écrire des
--    champs de profil sportif (taille/poids/poste/maillot) ou fabriquer une
--    affiliation de club pour un user_id arbitraire. Vérifié : les deux ne
--    sont appelées que via `admin.rpc(...)` (service_role) depuis des edge
--    functions qui ont déjà validé l'appelant AVANT l'appel
--    (connect-player-prestations, connect-player-onboarding) — aucun appelant
--    frontend légitime n'a besoin d'un accès direct.
--
-- 4) staff_update_club_request_status / update_club_request_status /
--    update_request_status : même classe de bug que submit_club_request
--    (corrigé plus tôt cette nuit, migration-clubplus-v92) — lecture de
--    l'ancien statut SANS verrou de ligne avant la décision de déduire des
--    crédits. Deux appels concurrents/dupliqués (double-clic, retry, deux
--    onglets staff) sur la MÊME demande peuvent tous les deux lire l'ancien
--    statut, passer le garde v_old_status <> 'terminee', et déduire les
--    crédits deux fois. Corrigé par un SELECT ... FOR UPDATE, même patron que
--    submit_club_request.
-- ============================================================================

-- 1) enqueue_notification + les 4 fonctions cron liées (correctif déjà écrit,
--    jamais exécuté — voir migration-securite-enqueue-notification.sql)
-- check_factures_en_retard()/check_devis_sans_reponse() référencées par le fichier d'origine
-- n'existent plus du tout dans le schéma actuel (renommées/supprimées depuis) — rien à révoquer,
-- pas exploitables si elles n'existent pas. Les 3 restantes existent bien, revoke appliqué.
revoke execute on function enqueue_notification(text,text,text,text,text,text,uuid,uuid,text,uuid,jsonb,timestamptz) from public, anon, authenticated;
revoke execute on function check_echeances_depenses() from public, anon, authenticated;
revoke execute on function send_prestation_reminders() from public, anon, authenticated;

-- 2) notify_client_members / connect_notify_by_client_id — même faille,
--    jamais couverte par le correctif précédent
revoke execute on function notify_client_members(uuid,text,text,text,text) from public, anon, authenticated;
revoke execute on function connect_notify_by_client_id(uuid,text,text,text,text,text) from public, anon, authenticated;

-- 3) écritures anonymes non authentifiées sur des données de profil/affiliation
revoke execute on function connect_athlete_profile_coalesce_update(text,uuid,uuid,integer,numeric,text,text) from public, anon, authenticated;
revoke execute on function connect_declare_club(text,text,text,uuid,text,text) from public, anon, authenticated;

-- 4) verrou de ligne avant lecture du statut, pour fermer la race condition
--    sur la déduction de crédits (même patron que migration-clubplus-v92)

create or replace function staff_update_club_request_status(p_request_id uuid, p_status text)
returns club_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row club_requests;
  v_old_status text;
  v_credits integer;
  v_authorized boolean;
begin
  select * into v_row from club_requests where id = p_request_id for update;
  if v_row.id is null then
    raise exception 'Demande introuvable.';
  end if;

  select exists(
    select 1 from clubs c
    where c.id = v_row.club_id and (
      exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      or (c.portail_client_id is not null and exists (
        select 1 from profiles p where p.id = auth.uid() and p.role = 'cm'
          and (p.niveau_cm = 'cm_lead' or contenus_visible_par_cm(c.portail_client_id, auth.uid()))
      ))
    )
  ) into v_authorized;
  if not v_authorized then
    raise exception 'Accès refusé.';
  end if;

  v_old_status := v_row.status;
  v_credits := coalesce(v_row.credits_reserved, 0);

  update club_requests set
    status = p_status,
    credits_reserved = case when p_status in ('terminee','refusee') then 0 else credits_reserved end
    where id = p_request_id
    returning * into v_row;

  if v_credits > 0 and p_status = 'terminee' and v_old_status <> 'terminee' then
    perform set_config('app.trusted_credit_op', 'true', true);
    update clubs set
      credits_balance = greatest(0, credits_balance - v_credits),
      credits_reserved = greatest(0, credits_reserved - v_credits)
      where id = v_row.club_id;
    insert into club_credit_transactions (club_id, label, amount, created_by)
      values (v_row.club_id, coalesce(v_row.type,'Demande') || coalesce(' — ' || v_row.team, ''), -v_credits, auth.uid());
  elsif v_credits > 0 and p_status = 'refusee' and v_old_status <> 'refusee' then
    perform set_config('app.trusted_credit_op', 'true', true);
    update clubs set credits_reserved = greatest(0, credits_reserved - v_credits) where id = v_row.club_id;
  end if;

  return v_row;
end;
$function$;

create or replace function update_club_request_status(p_request_id uuid, p_status text)
returns club_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row club_requests;
  v_old_status text;
  v_credits integer;
  v_is_staff boolean;
begin
  select * into v_row from club_requests where id = p_request_id for update;
  if v_row.id is null then
    raise exception 'Demande introuvable.';
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','cm','sec','prod')
  ) into v_is_staff;

  if v_is_staff then
    null;
  elsif is_club_member(v_row.club_id) then
    if p_status <> 'refusee' or v_row.status <> 'recues' then
      raise exception 'Vous ne pouvez annuler qu''une demande non encore prise en charge par SportVision.';
    end if;
  else
    raise exception 'Accès refusé.';
  end if;

  v_old_status := v_row.status;
  v_credits := coalesce(v_row.credits_reserved, 0);

  update club_requests set
    status = p_status,
    credits_reserved = case when p_status in ('terminee','refusee') then 0 else credits_reserved end
    where id = p_request_id
    returning * into v_row;

  if v_credits > 0 and p_status = 'terminee' and v_old_status <> 'terminee' then
    perform set_config('app.trusted_credit_op', 'true', true);
    update clubs set
      credits_balance = greatest(0, credits_balance - v_credits),
      credits_reserved = greatest(0, credits_reserved - v_credits)
      where id = v_row.club_id;
    insert into club_credit_transactions (club_id, label, amount, created_by)
      values (v_row.club_id, coalesce(v_row.type,'Demande') || coalesce(' — ' || v_row.team, ''), -v_credits, auth.uid());
  elsif v_credits > 0 and p_status = 'refusee' and v_old_status <> 'refusee' then
    perform set_config('app.trusted_credit_op', 'true', true);
    update clubs set credits_reserved = greatest(0, credits_reserved - v_credits) where id = v_row.club_id;
  end if;

  return v_row;
end;
$function$;

create or replace function update_request_status(p_request_id uuid, p_status text)
returns requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row requests;
  v_old_status text;
  v_credits integer;
  v_org_type text;
  v_is_staff boolean;
begin
  select * into v_row from requests where id = p_request_id for update;
  if v_row.id is null then
    raise exception 'Demande introuvable.';
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','cm','sec','prod')
  ) into v_is_staff;

  if v_is_staff then
    null;
  elsif is_org_member(v_row.organization_id) then
    if p_status <> 'refusee' or v_row.status <> 'recues' then
      raise exception 'Vous ne pouvez annuler qu''une demande non encore prise en charge par SportVision.';
    end if;
  else
    raise exception 'Accès refusé.';
  end if;

  v_old_status := v_row.status;
  v_credits := coalesce(v_row.credits_reserved, 0);

  update requests set
    status = p_status,
    credits_reserved = case when p_status in ('terminee','refusee') then 0 else credits_reserved end
    where id = p_request_id
    returning * into v_row;

  if v_credits > 0 then
    select organization_type into v_org_type from organizations where id = v_row.organization_id;
    if v_org_type = 'projet' then
      if p_status = 'terminee' and v_old_status <> 'terminee' then
        update organizations set
          credits_balance = greatest(0, credits_balance - v_credits),
          credits_reserved = greatest(0, credits_reserved - v_credits)
          where id = v_row.organization_id;
        insert into organization_credit_transactions (organization_id, label, amount, created_by)
          values (v_row.organization_id, coalesce(v_row.type, 'Demande'), -v_credits, auth.uid());
      elsif p_status = 'refusee' and v_old_status <> 'refusee' then
        update organizations set credits_reserved = greatest(0, credits_reserved - v_credits) where id = v_row.organization_id;
      end if;
    end if;
  end if;

  return v_row;
end;
$function$;

-- ============================================================================
-- Vérifié après écriture (E2E) :
-- 1) connect_athlete_profile_coalesce_update / connect_declare_club appelées
--    via rpc/ avec l'anon key → 42501 (permission refusée). Appel via
--    service_role (edge function réelle) → toujours fonctionnel.
-- 2) enqueue_notification / notify_client_members / connect_notify_by_client_id
--    via rpc/ avec l'anon key → 42501. Un trigger réel qui les invoque en
--    interne (perform) → toujours fonctionnel.
-- 3) staff_update_club_request_status appelée deux fois en séquence sur la
--    même demande (simulant une double soumission) → la 2ᵉ ne déduit plus de
--    crédits une seconde fois (v_old_status déjà 'terminee' après le verrou).
-- ============================================================================
