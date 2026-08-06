-- Migration : pont Club+ → OS pour "Demandes reçues" côté CM.
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- club_requests (migration-clubplus-v4.sql) est une table de demandes
-- structurées complète (type, statut à 6 valeurs, urgence, crédits
-- réservés, commentaires), déjà utilisée par l'app Club+
-- (livrables/SportVision-Club-Plus, livrables/SportVision-Connect). Mais
-- `clubs` (le club Club+, authentifié via club_members/auth.users,
-- indépendant de `profiles`) n'a aucun lien avec `clients` (le client suivi
-- côté OS) — deux fiches non reliées pour le même club réel. Confirmé avec
-- l'utilisateur : même entité, il manque la colonne de liaison.
--
-- Découverte en marge : même le staff OS n'a aujourd'hui aucun accès à
-- club_requests (RLS ne couvre que les membres du club via is_club_member).
-- clubs_staff_all existe pour `clubs` (admin/com/sec) mais pas `cm`, et
-- update_club_request_status() ne peut être appelée que par un membre du
-- club — aucun rôle staff, pas même admin, ne peut faire avancer une
-- demande aujourd'hui.
--
-- À exécuter APRÈS migration-client-affiliations.sql (dépend de
-- contenus_visible_par_cm()) ET migration-clubplus-v1/v4.sql (clubs,
-- club_requests, club_credit_transactions, is_club_member doivent déjà
-- exister).
--
-- Idempotente : DROP ... IF EXISTS avant chaque CREATE.

-- ─── 1. Colonne de liaison ───────────────────────────────────────────────
alter table clubs add column if not exists client_id uuid references clients(id);
create index if not exists idx_clubs_client on clubs(client_id);

-- ─── 2. clubs : lecture CM (clubs_staff_all ne couvrait qu'admin/com/sec) ─
drop policy if exists "clubs_cm_select" on clubs;
create policy "clubs_cm_select" on clubs for select using (
  client_id is not null and (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
    or contenus_visible_par_cm(client_id, auth.uid())
  )
);

-- ─── 3. club_requests : lecture staff (rien n'existait, même pas admin) ──
drop policy if exists "creq_staff_select" on club_requests;
create policy "creq_staff_select" on club_requests for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  or exists (
    select 1 from clubs c where c.id = club_requests.club_id and c.client_id is not null and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
      or contenus_visible_par_cm(c.client_id, auth.uid())
    )
  )
);

-- ─── 4. RPC staff pour changer le statut d'une demande ──────────────────
-- Distincte de update_club_request_status() (réservée aux membres du club
-- via is_club_member — déjà utilisée en production par l'app Club+
-- elle-même) : même logique de réservation/débit de crédits, mais
-- autorisation staff/CM via le client lié plutôt que l'appartenance club.
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

  -- admin reste inconditionnel (comme partout ailleurs dans l'app, y compris
  -- pour un club pas encore lié à un client) ; le CM, lui, reste strictement
  -- gated par le lien clubs.client_id et sa propre visibilité.
  select exists(
    select 1 from clubs c
    where c.id = v_row.club_id and (
      exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      or (c.client_id is not null and exists (
        select 1 from profiles p where p.id = auth.uid() and p.role = 'cm'
          and (p.niveau_cm = 'cm_lead' or contenus_visible_par_cm(c.client_id, auth.uid()))
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
