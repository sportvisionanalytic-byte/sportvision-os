-- ============================================================
-- SPORTVISION CONNECT — Migration v41 : les 2 décisions produit tranchées
-- avec Fouka le 11/08/2026 (section 4 du rapport de pré-lancement).
-- ============================================================


-- ════════════════════════════════════════════════════════════════════
-- PARTIE A — Documents financiers du club (devis/factures/contrats)
-- restreints au bureau, plus ouverts à tout membre actif.
--
-- ── Constat ──────────────────────────────────────────────────────────
-- club_member_has_client_access(target_client_id) (migration-clubplus-
-- v33-club-documents-access.sql) ne vérifie que club_members.status =
-- 'actif' — aucun filtre de rôle. Cette fonction est réutilisée pour
-- BEAUCOUP plus que les documents financiers (messages_client, contenus,
-- notifications, client_cm, event/live) : la restreindre casserait ces
-- usages légitimes pour un simple joueur/membre. Décision : créer une
-- fonction séparée, réservée aux 3 vues financières uniquement
-- (client_devis, client_factures, client_contrats), sans toucher à
-- club_member_has_client_access() ni à aucun de ses autres usages.
--
-- Rôles retenus (bureau au sens large) : admin, president, tresorier,
-- membre_bureau — les 4 valeurs du check constraint club_members.role
-- (migration-clubplus-v1.sql) qui correspondent à une fonction de
-- direction/finances du club. Les autres rôles existants (secretaire,
-- comm, cm_externe, coach, resp_equipe, sponsor_mgr, lecture_seule) ne
-- voient plus les documents financiers du club après cette migration.
--
-- Vues redéfinies à l'identique (mêmes colonnes qu'avant), seul le nom
-- de la fonction appelée dans la branche club change. `client_devis`
-- reprend sa version la plus récente (migration-devis-cgv-execution-
-- anticipee-11-08.sql, colonnes CGV/exécution anticipée incluses).
-- ════════════════════════════════════════════════════════════════════

create or replace function club_member_has_financial_access(target_client_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from club_members cm
    join clubs c on c.id = cm.club_id
    where cm.user_id = auth.uid()
      and cm.status = 'actif'
      and cm.role in ('admin','president','tresorier','membre_bureau')
      and c.portail_client_id = target_client_id
  );
$$;

drop view if exists client_devis;
create view client_devis as
select
  d.id, d.numero, d.statut, d.client_id, d.prestation_id,
  d.lignes, d.sous_total, d.remise_pct, d.remise_montant, d.tva_pct, d.total_ht, d.total_ttc,
  d.validite_jours, d.date_envoi, d.date_expiration, d.date_acceptation, d.notes,
  d.cgv_version_acceptee, d.cgv_acceptee_le,
  d.execution_anticipee_demandee, d.execution_anticipee_demandee_le,
  p.date_prestation,
  d.created_at, d.updated_at
from devis d
left join prestations p on p.id = d.prestation_id
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = d.client_id
) or club_member_has_financial_access(d.client_id);

drop view if exists client_factures;
create view client_factures as
select
  f.id, f.numero, f.type_facture, f.statut, f.client_id, f.prestation_id, f.devis_id,
  f.lignes, f.montant_ht, f.tva_pct, f.montant_ttc, f.date_emission, f.date_echeance, f.pdf_url,
  f.created_at
from factures f
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = f.client_id
) or club_member_has_financial_access(f.client_id);

drop view if exists client_contrats;
create view client_contrats as
select
  c.id, c.type_contrat, c.statut,
  c.signature_statut, c.signature_demandee_at, c.signature_confirmee_at,
  c.client_id, c.prestation_id, c.montant_mensuel, c.frequence, c.date_debut, c.date_fin,
  c.created_at, c.updated_at
from contrats c
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = c.client_id
) or club_member_has_financial_access(c.client_id);

-- Note : ces 3 vues restent sans security_invoker (comportement par défaut,
-- exécution avec les droits du propriétaire) — comportement déjà en place
-- avant cette migration, non modifié ici.


-- ════════════════════════════════════════════════════════════════════
-- PARTIE B — Harmonise protect_prestation_operational_fields() avec sa
-- fonction sœur validate_prestation_statut_transition() (migration-
-- prestations-transitions-statut.sql), qui exempte déjà explicitement
-- auth.uid() IS NULL ("pour ne jamais te bloquer toi-même" — Fouka
-- corrigeant depuis le SQL Editor, service_role, ou tout appel interne).
--
-- Sans risque supplémentaire : un accès service_role a de toute façon
-- déjà accès à toute la base sans restriction (bypass RLS) — ce trigger
-- ne protégeait donc que Fouka contre lui-même, pas la base contre un
-- tiers. Reprend le corps de la fonction tel quel, ajoute seulement le
-- garde en tête.
-- ════════════════════════════════════════════════════════════════════

create or replace function protect_prestation_operational_fields()
returns trigger language plpgsql security definer as $$
declare
  is_privileged boolean;
  is_valid_transition boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod','compta')
  ) into is_privileged;

  if is_privileged then
    return new;
  end if;

  if new.lieu is distinct from old.lieu
     or new.adresse_complete is distinct from old.adresse_complete
     or new.contact_sur_place is distinct from old.contact_sur_place
     or new.telephone_sur_place is distinct from old.telephone_sur_place
     or new.date_prestation is distinct from old.date_prestation
     or new.heure_debut is distinct from old.heure_debut
     or new.heure_fin is distinct from old.heure_fin
     or new.heure_rdv is distinct from old.heure_rdv
     or new.type_prestation is distinct from old.type_prestation
     or new.reference is distinct from old.reference
     or new.description_besoin is distinct from old.description_besoin
     or new.livrables_demandes is distinct from old.livrables_demandes
     or new.notes_internes is distinct from old.notes_internes
     or new.sport is distinct from old.sport
     or new.equipes is distinct from old.equipes
     or new.responsable_prod_id is distinct from old.responsable_prod_id
     or new.responsable_prestation_id is distinct from old.responsable_prestation_id
  then
    raise exception 'Modification non autorisée : le lieu, l''horaire et les informations de mission d''une prestation sont réservés au secrétariat/à la production.';
  end if;

  if new.statut is distinct from old.statut then
    is_valid_transition := (
      (old.statut = 'confirmée' and new.statut = 'équipe_en_route')
      or (old.statut = 'équipe_affectée' and new.statut = 'équipe_en_route')
      or (old.statut = 'planifiée' and new.statut = 'équipe_en_route')
      or (old.statut = 'prête' and new.statut = 'équipe_en_route')
      or (old.statut = 'prête' and new.statut = 'production_démarrée')
      or (old.statut = 'équipe_en_route' and new.statut = 'arrivée_sur_place')
      or (old.statut = 'arrivée_sur_place' and new.statut = 'production_démarrée')
      or (old.statut = 'production_démarrée' and new.statut = 'production_terminée')
      or (old.statut = 'production_terminée' and new.statut = 'médias_à_transférer')
      or (old.statut = 'médias_à_transférer' and new.statut = 'médias_complets')
    );
    if not is_valid_transition then
      raise exception 'Modification non autorisée : ce changement de statut n''est pas ouvert au collaborateur affecté (réservé au secrétariat/à la production).';
    end if;
  end if;

  return new;
end;
$$;

-- Trigger déjà existant (migration-prestations-rls-collaborateur-champs.sql),
-- create or replace de la fonction suffit, pas besoin de recréer le trigger.


-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution :
--
-- Partie A : avec un compte membre de club jetable, role='coach' (donc PAS
--   dans la liste blanche), confirmer que select * from client_devis /
--   client_factures / client_contrats renvoie [] pour ce club — puis avec
--   role='tresorier' (ou 'president'/'admin'/'membre_bureau'), confirmer
--   que les documents réapparaissent. Vérifier aussi qu'un membre
--   quelconque garde bien accès à messages_client/contenus (branche
--   inchangée, club_member_has_client_access() non touchée).
--
-- Partie B : depuis le SQL Editor (donc auth.uid() NULL), tenter de
--   modifier prestations.lieu sur une ligne existante — doit maintenant
--   réussir sans lever l'exception "réservé au secrétariat/à la
--   production".
-- ============================================================
