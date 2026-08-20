-- ============================================================
-- Migration additive : débloque le workflow crédits de club_requests, cassé
-- par une protection trop large (audit cross-app FullComm/Club+ ↔ OS,
-- 20/08/2026, testé en réel avec un compte jetable).
--
-- ── Constat vérifié en conditions réelles (pas une supposition) ──
-- trg_protect_sensitive_club_fields (BEFORE UPDATE sur clubs) bloque toute
-- modification de credits_reserved/credits_balance sauf pour service_role ou
-- un membre profiles.role IN ('admin','com','sec','compta'). Mais les 3 RPC
-- SECURITY DEFINER qui gèrent légitimement les crédits d'une demande visuel
-- (submit_club_request, update_club_request_status, staff_update_club_
-- request_status) sont appelées par :
--   - un simple membre club (aucune ligne `profiles`, donc jamais staff) —
--     submit_club_request échoue systématiquement dès que p_credits > 0.
--   - le rôle cm (responsable réel de ces demandes selon la policy RLS
--     creq_staff_select) — absent de la liste staff de la protection —
--     update_club_request_status/staff_update_club_request_status échouent
--     dès qu'un cm termine/refuse une demande à crédits.
-- SECURITY DEFINER change les droits objets (current_user), pas auth.uid()/
-- auth.role() (lus depuis les claims JWT de la requête PostgREST) : la
-- protection continue donc de voir l'utilisateur réel, pas la fonction de
-- confiance qui l'appelle.
-- Testé en réel avant cette migration : submit_club_request avec
-- p_credits=2 → "Modification non autorisée : ... réservés au staff
-- SportVision." ; avec p_credits=0 → fonctionne. Confirme que TOUTE
-- demande à crédits (le cas normal, pas l'exception) était bloquée.
--
-- ── Ce que fait cette migration ──
-- Ajoute un bypass ciblé via un GUC de transaction (app.trusted_credit_op),
-- positionné explicitement par ces 3 RPC juste avant leur propre UPDATE sur
-- clubs — pas un contournement général de la protection, seulement pour ces
-- écritures précises, déjà elles-mêmes protégées par leurs propres
-- vérifications d'autorisation (is_club_member / rôle staff).
--
-- Idempotente.
-- ============================================================

create or replace function protect_sensitive_club_fields()
returns trigger language plpgsql security definer as $$
declare
  is_os_staff boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Positionné par submit_club_request / update_club_request_status /
  -- staff_update_club_request_status juste avant leur propre écriture
  -- contrôlée sur credits_reserved/credits_balance — voir ces fonctions.
  if coalesce(current_setting('app.trusted_credit_op', true), '') = 'true' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec', 'compta')
  ) into is_os_staff;

  if is_os_staff then
    return new;
  end if;

  if new.plan is distinct from old.plan
     or new.engagement is distinct from old.engagement
     or new.pilot_mode is distinct from old.pilot_mode
     or new.credits_balance is distinct from old.credits_balance
     or new.credits_monthly is distinct from old.credits_monthly
     or new.credits_reserved is distinct from old.credits_reserved
     or new.portail_client_id is distinct from old.portail_client_id
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.subscription_status is distinct from old.subscription_status
  then
    raise exception 'Modification non autorisée : formule, engagement, crédits, rattachement Portail et abonnement Stripe sont réservés au staff SportVision.';
  end if;

  return new;
end;
$$;

create or replace function submit_club_request(
  p_club_id uuid, p_team text, p_type text, p_urgency text, p_detail text, p_credits integer
)
returns club_requests language plpgsql security definer as $$
declare
  v_row club_requests;
  v_name text;
begin
  if not is_club_member(p_club_id) then
    raise exception 'Accès refusé : vous n''êtes pas membre actif de ce club.';
  end if;

  select trim(coalesce(prenom,'') || ' ' || coalesce(nom,'')) into v_name
    from club_members where user_id = auth.uid() and club_id = p_club_id limit 1;

  insert into club_requests (club_id, team, type, requester_id, requester_name, status, urgency, detail, credits_reserved)
  values (p_club_id, p_team, p_type, auth.uid(), nullif(v_name, ''), 'recues', coalesce(p_urgency,'normale'), p_detail, coalesce(p_credits, 0))
  returning * into v_row;

  if coalesce(p_credits, 0) > 0 then
    perform set_config('app.trusted_credit_op', 'true', true);
    update clubs set credits_reserved = credits_reserved + p_credits where id = p_club_id;
  end if;

  return v_row;
end;
$$;

create or replace function update_club_request_status(p_request_id uuid, p_status text)
returns club_requests language plpgsql security definer as $$
declare
  v_row club_requests;
  v_old_status text;
  v_credits integer;
  v_is_staff boolean;
begin
  select * into v_row from club_requests where id = p_request_id;
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
$$;

create or replace function staff_update_club_request_status(p_request_id uuid, p_status text)
returns club_requests language plpgsql security definer as $$
declare
  v_row club_requests;
  v_old_status text;
  v_credits integer;
  v_authorized boolean;
begin
  select * into v_row from club_requests where id = p_request_id;
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
$$;
