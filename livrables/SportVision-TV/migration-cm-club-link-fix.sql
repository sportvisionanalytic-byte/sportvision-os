-- Migration : corrige migration-clubplus-cm-bridge.sql — colonne de liaison
-- club↔client dupliquée avec une colonne déjà existante.
--
-- ─── Découverte ──────────────────────────────────────────────────────────
-- migration-clubplus-cm-bridge.sql (session précédente) a ajouté
-- clubs.client_id en pensant combler un lien manquant entre `clubs`
-- (Club+) et `clients` (OS). Ce lien existe en réalité déjà depuis
-- migration-clubplus-v12.sql sous le nom clubs.portail_client_id — posé
-- automatiquement par les Edge Functions clubplus-activate (lien
-- d'activation privé généré depuis la fiche client, cf.
-- modalInviterClubPlus/genererLienActivationClubPlus) et clubplus-
-- onboarding (rattachement par e-mail à l'inscription self-service), et
-- déjà consommé par migration-connect-v2/v7/v8 pour la synchronisation des
-- organisations Connect.
--
-- Conséquence concrète : clubs.client_id (la colonne ajoutée par erreur)
-- est restée NULL pour tous les clubs réels — aucune UI n'a jamais écrit
-- dessus (le gap "liaison manuelle non outillée" signalé à l'époque était
-- donc un faux problème : le lien existait déjà, posé automatiquement).
-- "Demandes reçues" et "Briefs production" côté CM étaient de fait vides
-- en production pour tout club déjà activé.
--
-- Reporte clubs_cm_select / creq_staff_select / staff_update_club_
-- request_status sur portail_client_id, puis supprime la colonne
-- redondante. Sans risque : jamais alimentée par aucune UI.
--
-- Idempotente : DROP ... IF EXISTS avant chaque CREATE. À exécuter APRÈS
-- migration-clubplus-cm-bridge.sql.

-- ─── 1. clubs : lecture CM sur portail_client_id ────────────────────────
drop policy if exists "clubs_cm_select" on clubs;
create policy "clubs_cm_select" on clubs for select using (
  portail_client_id is not null and (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
    or contenus_visible_par_cm(portail_client_id, auth.uid())
  )
);

-- ─── 2. club_requests : lecture staff sur portail_client_id ─────────────
drop policy if exists "creq_staff_select" on club_requests;
create policy "creq_staff_select" on club_requests for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  or exists (
    select 1 from clubs c where c.id = club_requests.club_id and c.portail_client_id is not null and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
      or contenus_visible_par_cm(c.portail_client_id, auth.uid())
    )
  )
);

-- ─── 3. RPC staff : même logique, portail_client_id ─────────────────────
create or replace function staff_update_club_request_status(p_request_id uuid, p_status text)
returns club_requests
language plpgsql security definer as $$
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
    update clubs set
      credits_balance = greatest(0, credits_balance - v_credits),
      credits_reserved = greatest(0, credits_reserved - v_credits)
      where id = v_row.club_id;
    insert into club_credit_transactions (club_id, label, amount, created_by)
      values (v_row.club_id, coalesce(v_row.type,'Demande') || coalesce(' — ' || v_row.team, ''), -v_credits, auth.uid());
  elsif v_credits > 0 and p_status = 'refusee' and v_old_status <> 'refusee' then
    update clubs set credits_reserved = greatest(0, credits_reserved - v_credits) where id = v_row.club_id;
  end if;

  return v_row;
end;
$$;

-- ─── 4. Supprime la colonne redondante ───────────────────────────────────
-- Jamais écrite (aucune UI ne la ciblait) : suppression sans perte de
-- données. L'index idx_clubs_client posé par migration-clubplus-cm-
-- bridge.sql est supprimé automatiquement avec la colonne.
alter table clubs drop column if exists client_id;
