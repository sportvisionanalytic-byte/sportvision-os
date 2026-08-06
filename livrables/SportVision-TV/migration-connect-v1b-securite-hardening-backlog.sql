-- ============================================================
-- Migration de sécurité : suite du backlog de migration-connect-v1-
-- securite-hardening.sql (même défaut "colonne non protégée" : RLS
-- restreint les LIGNES, pas les COLONNES à l'intérieur — voir l'en-tête
-- de ce fichier pour l'explication complète du mécanisme).
--
-- Corrige les 10 occurrences listées en backlog en fin de v1 (kits,
-- club_sponsors, club_creations, club_newsroom_items,
-- parent_player_relationships, formation_inscriptions, incidents,
-- kit_reservations, club_matches, team_projects). Déclenchée par la
-- décision du 2026-08-06 de retirer le Portail au profit de SportVision
-- Connect : avant d'onboarder de vrais clients dessus, ce backlog de
-- sécurité (qui touche tout l'écosystème, pas seulement Connect) doit
-- être fermé, indépendamment du calendrier de bascule.
--
-- ⚠️ team_projects : `tpr_educateur_insert` a déjà été corrigée en
-- migration-clubplus-v23.sql (restriction du statut initial). Cette
-- migration ne touche QUE `tpr_creator_update_draft`, seule policy
-- encore ouverte sur cette table.
--
-- Idempotente : DROP ... IF EXISTS avant chaque CREATE.
-- À exécuter dans Supabase → SQL Editor, après migration-connect-v1-
-- securite-hardening.sql.
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 7. KITS — "kits_acces" (for all) laisse tout collaborateur ayant une
--    réservation active sur un kit modifier ou supprimer la fiche
--    matériel elle-même (valeur, statut, contenu), alors que ce droit
--    ne devrait exister qu'en lecture (consulter le kit qu'on a
--    réservé). Fix : scinde en lecture (inchangée) et écriture
--    (réservée au staff matériel).
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "kits_acces" on kits;

create policy "kits_select" on kits for select using (
  exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod','sec','compta'))
  or exists(
    select 1 from kit_reservations kr
    join prestations_equipe pe on pe.prestation_id = kr.prestation_id
    where kr.kit_id = kits.id and pe.collaborateur_id = auth.uid()
  )
);

create policy "kits_write" on kits for all using (
  exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod','sec','compta'))
) with check (
  exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod','sec','compta'))
);


-- ═══════════════════════════════════════════════════════════════
-- 8. CLUB_SPONSORS — "csp_member_insert"/"csp_member_update" n'exigent
--    que is_club_member (n'importe quel rôle actif), donc n'importe
--    quel membre peut créer/modifier un sponsor avec un montant
--    fabriqué. Fix : restreint aux rôles club dont c'est réellement le
--    métier (admin, president, sponsor_mgr, tresorier — sponsor_mgr et
--    tresorier existent déjà dans le catalogue de rôles club_members).
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "csp_member_insert" on club_sponsors;
create policy "csp_member_insert" on club_sponsors for insert with check (
  exists(
    select 1 from club_members
    where club_id = club_sponsors.club_id and user_id = auth.uid() and status = 'actif'
      and role in ('admin','president','sponsor_mgr','tresorier')
  )
);

drop policy if exists "csp_member_update" on club_sponsors;
create policy "csp_member_update" on club_sponsors for update using (
  exists(
    select 1 from club_members
    where club_id = club_sponsors.club_id and user_id = auth.uid() and status = 'actif'
      and role in ('admin','president','sponsor_mgr','tresorier')
  )
);


-- ═══════════════════════════════════════════════════════════════
-- 9. CLUB_CREATIONS — "ccr_member_insert"/"ccr_member_update" laissent
--    n'importe quel membre faire passer directement une création à
--    status='publie', sans validation. Fix : un membre reste libre de
--    créer/modifier tant que le statut cible reste 'brouillon' ou
--    'a_valider' (son usage normal : soumettre du contenu) ; passer à
--    'valide'/'publie' exige un rôle de validation (admin, president,
--    comm — comm = responsable communication, rôle déjà existant).
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "ccr_member_insert" on club_creations;
create policy "ccr_member_insert" on club_creations for insert with check (
  is_club_member(club_id) and (
    status in ('brouillon','a_valider')
    or exists(
      select 1 from club_members
      where club_id = club_creations.club_id and user_id = auth.uid() and status = 'actif'
        and role in ('admin','president','comm')
    )
  )
);

drop policy if exists "ccr_member_update" on club_creations;
create policy "ccr_member_update" on club_creations for update using (
  is_club_member(club_id)
) with check (
  is_club_member(club_id) and (
    status in ('brouillon','a_valider')
    or exists(
      select 1 from club_members
      where club_id = club_creations.club_id and user_id = auth.uid() and status = 'actif'
        and role in ('admin','president','comm')
    )
  )
);


-- ═══════════════════════════════════════════════════════════════
-- 10. CLUB_NEWSROOM_ITEMS — même défaut que club_creations sur le
--     statut de publication ('publie'). Même fix : un membre reste
--     libre de soumettre/compléter ('recu', 'infos_manquantes' — les
--     deux statuts où c'est le club qui fournit l'information) ; toute
--     étape de traitement éditorial ultérieure (a_verifier,
--     pret_a_transformer, en_creation, programme, publie, archive)
--     exige admin/president/comm.
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "cni_member_insert" on club_newsroom_items;
create policy "cni_member_insert" on club_newsroom_items for insert with check (
  is_club_member(club_id) and (
    status in ('recu','infos_manquantes')
    or exists(
      select 1 from club_members
      where club_id = club_newsroom_items.club_id and user_id = auth.uid() and status = 'actif'
        and role in ('admin','president','comm')
    )
  )
);

drop policy if exists "cni_member_update" on club_newsroom_items;
create policy "cni_member_update" on club_newsroom_items for update using (
  is_club_member(club_id)
) with check (
  is_club_member(club_id) and (
    status in ('recu','infos_manquantes')
    or exists(
      select 1 from club_members
      where club_id = club_newsroom_items.club_id and user_id = auth.uid() and status = 'actif'
        and role in ('admin','president','comm')
    )
  )
);


-- ═══════════════════════════════════════════════════════════════
-- 11. PARENT_PLAYER_RELATIONSHIPS — "ppr_parent_confirm" (update) ne
--     contraint que parent_id (le parent doit posséder la ligne), ni
--     player_id ni statut ne sont vérifiés dans un with check séparé :
--     un parent peut repointer sa relation vers un enfant qui n'est pas
--     le sien via un simple PATCH REST. Le statut, lui, doit rester
--     librement modifiable (c'est tout l'objet de cette policy :
--     confirmer/refuser/se retirer) — seul le rattachement (parent_id,
--     player_id) doit être verrouillé après création. Comme les
--     policies RLS ne peuvent pas comparer proprement l'ancienne et la
--     nouvelle ligne sur un update, fix par trigger (même mécanisme que
--     les autres protect_sensitive_*_fields de ce projet).
-- ═══════════════════════════════════════════════════════════════

create or replace function protect_sensitive_ppr_fields()
returns trigger language plpgsql security definer as $$
begin
  if new.player_id is distinct from old.player_id then
    raise exception 'Modification non autorisée : le rattachement à un autre enfant n''est pas permis depuis cette action.';
  end if;
  if new.parent_id is distinct from old.parent_id then
    raise exception 'Modification non autorisée : le parent d''une relation ne peut pas être changé.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_ppr_fields on parent_player_relationships;
create trigger trg_protect_sensitive_ppr_fields
  before update on parent_player_relationships
  for each row execute function protect_sensitive_ppr_fields();


-- ═══════════════════════════════════════════════════════════════
-- 12. FORMATION_INSCRIPTIONS — "fi_admin_update" laisse le
--     collaborateur (collaborateur_id = auth.uid(), dans la clause OR)
--     s'auto-déclarer statut='terminee'/progression_pct=100 ET
--     xp_gagnes à une valeur arbitraire, sans distinction. Le suivi de
--     sa propre progression (statut, progression_pct, complétion, score
--     de quiz) est un usage normal et attendu d'une formation en
--     self-service — seul xp_gagnes (la récompense) doit rester
--     hors de portée du collaborateur, sur le même principe que le
--     fix déjà appliqué à xp_events dans migration-connect-v1-
--     securite-hardening.sql (item 5). Risque résiduel assumé, déjà
--     documenté pour xp_events et valable ici à l'identique : le calcul
--     réel des XP mérite à terme une RPC dédiée plutôt qu'un champ
--     laissé à 0 par défaut côté self-service.
-- ═══════════════════════════════════════════════════════════════

create or replace function protect_sensitive_formation_inscription_fields()
returns trigger language plpgsql security definer as $$
declare
  is_privileged boolean;
begin
  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod')) into is_privileged;
  if is_privileged then
    return new;
  end if;
  if new.xp_gagnes is distinct from old.xp_gagnes then
    raise exception 'Modification non autorisée : les XP gagnés sont attribués par SportVision, pas déclarés par le collaborateur.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_formation_inscription_fields on formation_inscriptions;
create trigger trg_protect_sensitive_formation_inscription_fields
  before update on formation_inscriptions
  for each row execute function protect_sensitive_formation_inscription_fields();


-- ═══════════════════════════════════════════════════════════════
-- 13. INCIDENTS — "incidents_acces" (for all) laisse le déclarant
--     (declare_par = auth.uid()) clôturer lui-même son propre incident
--     (cloture, cloture_par, cloture_at, resolution), sans distinction
--     entre déclarer et clôturer. Fix par trigger : le déclarant garde
--     la main sur le contenu de son signalement (description,
--     type_incident, niveau), mais la clôture et le rattachement
--     (prestation_id, declare_par) redeviennent réservés à
--     admin/prod/sec — même périmètre que la policy existante.
-- ═══════════════════════════════════════════════════════════════

create or replace function protect_sensitive_incident_fields()
returns trigger language plpgsql security definer as $$
declare
  is_privileged boolean;
begin
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
$$;

drop trigger if exists trg_protect_sensitive_incident_fields on incidents;
create trigger trg_protect_sensitive_incident_fields
  before update on incidents
  for each row execute function protect_sensitive_incident_fields();


-- ═══════════════════════════════════════════════════════════════
-- 14. KIT_RESERVATIONS — "kit_resa_acces" (for all) laisse le
--     collaborateur modifier ET supprimer librement sa réservation, y
--     compris rattacher la ligne à un autre kit/prestation/
--     collaborateur. Le statut de sortie/retour (statut, dates,
--     etat_sortie/etat_retour) reste un usage normal en self-service
--     (c'est la personne qui a le matériel qui déclare l'avoir
--     récupéré/rendu — pas de RPC dédiée aujourd'hui pour le faire
--     autrement) ; on ne restreint donc pas ces colonnes. Fix : scinde
--     la policy pour retirer le DELETE en self-service (on garde une
--     trace de toute réservation), puis verrouille par trigger le
--     rattachement (kit_id, prestation_id, collaborateur_id,
--     responsable_id), qui n'a lui aucune raison de changer une fois la
--     réservation créée.
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "kit_resa_acces" on kit_reservations;

create policy "kit_resa_select" on kit_reservations for select using (
  exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
  or collaborateur_id = auth.uid()
);

create policy "kit_resa_insert" on kit_reservations for insert with check (
  exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
  or collaborateur_id = auth.uid()
);

create policy "kit_resa_update" on kit_reservations for update using (
  exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
  or collaborateur_id = auth.uid()
);

create policy "kit_resa_delete" on kit_reservations for delete using (
  exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

create or replace function protect_sensitive_kit_reservation_fields()
returns trigger language plpgsql security definer as $$
declare
  is_privileged boolean;
begin
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
$$;

drop trigger if exists trg_protect_sensitive_kit_reservation_fields on kit_reservations;
create trigger trg_protect_sensitive_kit_reservation_fields
  before update on kit_reservations
  for each row execute function protect_sensitive_kit_reservation_fields();


-- ═══════════════════════════════════════════════════════════════
-- 15. CLUB_MATCHES — "cma_member_update" (using is_club_member(club_id),
--     sans with check séparé) permet en théorie à un membre de deux
--     clubs de rattacher un match de l'un à l'autre. Le statut
--     ('a_venir'/'a_transmettre'/'recu') reste volontairement libre :
--     c'est le club lui-même qui annonce avoir transmis son contenu de
--     match, aucun angle de fraude identifié dessus (audit : "faible
--     impact, pas d'argent"). Fix minimal par trigger : verrouille
--     uniquement club_id.
-- ═══════════════════════════════════════════════════════════════

create or replace function protect_sensitive_club_match_fields()
returns trigger language plpgsql security definer as $$
declare
  is_privileged boolean;
begin
  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod')) into is_privileged;
  if is_privileged then
    return new;
  end if;
  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : le club d''un match ne peut pas être changé.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_club_match_fields on club_matches;
create trigger trg_protect_sensitive_club_match_fields
  before update on club_matches
  for each row execute function protect_sensitive_club_match_fields();


-- ═══════════════════════════════════════════════════════════════
-- 16. TEAM_PROJECTS — "tpr_creator_update_draft" (using created_by =
--     auth.uid() and statut = 'brouillon', sans with check séparé)
--     laisse le créateur reconfigurer team_id/club_id/catalogue_offre_id
--     /montant_cible tant que le projet reste en brouillon. Fix par
--     trigger : verrouille ces 4 colonnes pour tout le monde sauf un
--     admin du club concerné (is_club_admin, déjà utilisé ailleurs sur
--     cette même table). N'affecte pas recompute_team_project_amount()
--     (trigger existant sur team_project_contributions, déclenché via
--     le webhook Stripe en service role) : ce dernier n'écrit que
--     montant_collecte/statut, jamais les 4 colonnes verrouillées ici.
--     Ne retouche pas tpr_educateur_insert (déjà corrigée en v23).
-- ═══════════════════════════════════════════════════════════════

create or replace function protect_sensitive_team_project_draft_fields()
returns trigger language plpgsql security definer as $$
begin
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
$$;

drop trigger if exists trg_protect_sensitive_team_project_draft_fields on team_projects;
create trigger trg_protect_sensitive_team_project_draft_fields
  before update on team_projects
  for each row execute function protect_sensitive_team_project_draft_fields();
