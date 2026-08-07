-- Migration : validation client réelle des contenus (statut "a_valider_client").
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- contenus (migration-contenus.sql) a un statut "a_valider_client" et un
-- statut "corrections", mais rien côté client ne permet aujourd'hui de
-- valider un contenu ou de demander des corrections — aucune policy sur
-- `contenus` ne référence `client_users`/`auth.uid()` côté client. Le CM
-- doit donc gérer ces retours manuellement (téléphone, message) et cliquer
-- lui-même sur le bouton côté OS. Cette migration branche l'espace Projet
-- de SportVision Connect (livrables/SportVision-Connect/) sur ce statut.
--
-- Idempotente : DROP ... IF EXISTS avant chaque CREATE. À exécuter après
-- migration-client-affiliations.sql (contenus_visible_par_cm) et, si déjà
-- jouée, migration-cm-audit-contenus.sql (remplace sa policy de lecture
-- d'audit) — l'ordre relatif entre les deux n'a pas d'importance, chacune
-- est idempotente.

-- ─── 1. Lecture client (contenus) ────────────────────────────────────────
-- Exclut les statuts internes (brouillon, vérif. interne) : le client ne
-- voit que ce qui a atteint "à valider" ou au-delà.
drop policy if exists "contenus_client_select" on contenus;
create policy "contenus_client_select" on contenus for select using (
  statut not in ('brouillon','a_valider_interne')
  and exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = contenus.client_id)
);

-- ─── 2. Décision client — RPC dédiée ─────────────────────────────────────
-- Pattern déjà établi cette session (staff_update_club_request_status) :
-- une RPC SECURITY DEFINER pour une transition d'état contrôlée, plutôt
-- qu'un UPDATE direct + policy colonne par colonne. Écrit aussi dans
-- messages_client (déjà visible du CM via mc_cm_acces) et audit_logs (déjà
-- consommé par le panneau "Historique" de modalEditContenu côté OS).
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

  select exists(select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = v_row.client_id) into v_autorise;
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

  -- acteur_id laissé null : un client n'a pas de ligne dans `profiles`
  -- (contrainte FK acteur_id → profiles(id)) — cette fonction SECURITY
  -- DEFINER contourne de toute façon audit_staff_insert pour sa propre
  -- écriture, comme le reste des RPC déjà en place cette session.
  insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
    values (null, case when p_decision = 'valide' then 'contenu_valide_client' else 'contenu_corrections_demandees' end,
      'contenu', p_contenu_id, jsonb_build_object('commentaire', p_commentaire));

  return v_row;
end;
$$;

-- ─── 3. Élargit la lecture d'audit CM ────────────────────────────────────
-- audit_cm_lead_read_contenu (migration-cm-audit-contenus.sql) limitait la
-- lecture du journal "contenu" au seul Lead CM. La décision du client est
-- une information opérationnelle critique pour le CM assigné, pas
-- seulement un journal d'admin/Lead — élargit à tout CM qui peut déjà voir
-- le contenu (propriétaire, portefeuille, ou Lead).
drop policy if exists "audit_cm_lead_read_contenu" on audit_logs;
drop policy if exists "audit_cm_read_contenu" on audit_logs;
create policy "audit_cm_read_contenu" on audit_logs for select using (
  cible_type = 'contenu' and exists (
    select 1 from contenus c where c.id = audit_logs.cible_id and (
      c.cm_id = auth.uid()
      or contenus_visible_par_cm(c.client_id, auth.uid())
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
    )
  )
);
