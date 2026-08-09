-- ============================================================
-- Migration v34 — étend l'accès club à messages_client et contenus
-- (planning éditorial), même patron que migration-clubplus-v33-club-
-- documents-access.sql (déjà exécutée, club_member_has_client_access()
-- vérifiée fonctionnelle en prod).
--
-- ─── Pourquoi ────────────────────────────────────────────────────────────
-- Ces deux tables/RPC ne connaissent aujourd'hui qu'un seul lecteur/
-- rédacteur par client Portail : la personne unique enregistrée dans
-- `client_users` (celle qui a activé Club+ à l'origine). Un membre de
-- club qui n'est pas cette personne (un autre admin, un coach) ne peut
-- ni lire les messages du club, ni voir le planning éditorial, ni décider
-- d'un contenu à valider — alors que ces trois écrans sont pensés pour
-- tout le club, pas pour un seul compte. `club_member_has_client_access()`
-- (v33) fait déjà exactement cette vérification (club_members.status=
-- 'actif' + clubs.portail_client_id = target_client_id) — cette migration
-- ne fait que réutiliser cette même fonction sur 3 points d'accès de plus.
--
-- ─── Ce qui change ───────────────────────────────────────────────────────
-- 1. messages_client : mc_client_select/mc_client_insert acceptent aussi
--    un membre de club, en plus du client_users unique existant.
-- 2. contenus : contenus_client_select élargie de même (lecture seule,
--    Communication + Publications).
-- 3. client_valider_contenu() : la vérification d'autorisation (ligne
--    v_autorise) accepte aussi un membre de club — c'est la RPC qui fait
--    fonctionner l'écran Validations.
--
-- Additive, idempotente (drop policy if exists / create or replace),
-- aucun changement de structure de table. mc_staff_all et le reste du
-- corps de client_valider_contenu restent inchangés.
--
-- NON EXÉCUTÉE PAR L'AGENT. À exécuter par Fouka dans Supabase → SQL Editor
-- après relecture.
-- ============================================================

-- ─── 1. messages_client ──────────────────────────────────────────────────

drop policy if exists "mc_client_select" on messages_client;
create policy "mc_client_select" on messages_client for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id)
  or club_member_has_client_access(messages_client.client_id)
);

drop policy if exists "mc_client_insert" on messages_client;
create policy "mc_client_insert" on messages_client for insert with check (
  auteur_type = 'client'
  and auteur_client_id = auth.uid()
  and (
    exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id)
    or club_member_has_client_access(messages_client.client_id)
  )
);

-- mc_staff_all inchangée (déjà "for all", pas concernée par cette extension).

-- ─── 2. contenus (planning éditorial) ────────────────────────────────────

drop policy if exists "contenus_client_select" on contenus;
create policy "contenus_client_select" on contenus for select using (
  statut not in ('brouillon','a_valider_interne')
  and (
    exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = contenus.client_id)
    or club_member_has_client_access(contenus.client_id)
  )
);

-- ─── 3. client_valider_contenu() — corps inchangé sauf la vérification d'accès ──

create or replace function client_valider_contenu(p_contenu_id uuid, p_decision text, p_commentaire text default null)
returns contenus
language plpgsql security definer as $$
declare
  v_row contenus;
  v_autorise boolean;
begin
  if p_decision not in ('valide','corrections') then
    raise exception 'Décision invalide.';
  end if;
  if p_decision = 'corrections' and (p_commentaire is null or trim(p_commentaire) = '') then
    raise exception 'Merci de préciser ce qui doit être corrigé.';
  end if;

  select * into v_row from contenus where id = p_contenu_id;
  if v_row.id is null then
    raise exception 'Contenu introuvable.';
  end if;
  if v_row.statut <> 'a_valider_client' then
    raise exception 'Ce contenu n''est plus en attente de votre validation.';
  end if;

  select
    exists(select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = v_row.client_id)
    or club_member_has_client_access(v_row.client_id)
  into v_autorise;
  if not v_autorise then
    raise exception 'Accès refusé.';
  end if;

  update contenus set statut = p_decision, updated_at = now() where id = p_contenu_id returning * into v_row;

  insert into messages_client (client_id, auteur_type, auteur_client_id, contenu)
    values (v_row.client_id, 'client', auth.uid(),
      case when p_decision = 'valide'
        then 'Contenu validé : « ' || coalesce(v_row.titre,'') || ' »'
        else 'Corrections demandées sur « ' || coalesce(v_row.titre,'') || ' » : ' || p_commentaire
      end);

  -- acteur_id laissé null : un client (ou un membre de club, depuis cette migration) n'a pas de
  -- ligne dans `profiles` (contrainte FK acteur_id → profiles(id)) — inchangé par rapport à
  -- l'original, cette fonction SECURITY DEFINER contourne de toute façon audit_staff_insert.
  insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
    values (null, case when p_decision = 'valide' then 'contenu_valide_client' else 'contenu_corrections_demandees' end,
      'contenu', p_contenu_id, jsonb_build_object('commentaire', p_commentaire));

  return v_row;
end;
$$;
