-- ============================================================
-- Migration additive : restreint les colonnes qu'un collaborateur affecté
-- peut modifier sur `prestations` via un appel API direct (PATCH REST),
-- au-delà du trigger déjà en place sur les champs financiers
-- (migration-connect-v1-securite-hardening.sql,
-- protect_sensitive_prestation_fields — non touché ici, coexiste).
--
-- ── Constat (audit pipeline Secrétariat/Réservations, vérifié dans le
-- code avant d'écrire cette migration) ──
--
-- La policy RLS "prestations_acces" (dernière définition :
-- migration-cm-briefs.sql, reprise de supabase-schema-v2.sql) est un
-- "for all using (...)" — elle ne restreint QUE les lignes visibles/
-- modifiables, pas les colonnes à l'intérieur d'une ligne autorisée. Elle
-- autorise notamment :
--   exists (select 1 from prestations_equipe where prestation_id = prestations.id and collaborateur_id = auth.uid())
-- → tout collaborateur affecté à une prestation (photographe, vidéaste…),
-- quel que soit le statut de son affectation (même 'invitation_envoyée',
-- pas encore acceptée), a un accès UPDATE complet à la ligne entière —
-- y compris lieu, adresse_complete, date_prestation, heure_debut,
-- heure_fin, heure_rdv, contact_sur_place, telephone_sur_place, statut,
-- type_prestation, reference, notes_internes, etc. Le trigger financier
-- existant protège déjà montant_ht/montant_ttc/tva_pct/acompte_*/
-- statut_financier/contrat_signe/budget_client/client_id, mais PAS le
-- lieu/horaire officiel ni le statut commercial — exactement le trou
-- signalé par l'audit.
--
-- Ce que l'UI donne RÉELLEMENT à un collaborateur sur `prestations`
-- aujourd'hui (SportVision-OS-Full.html, vérifié avant d'écrire cette
-- migration) :
--   - avanJourJ() / jourJAction() (Mode Jour J, desktop et mobile) :
--     PATCH statut UNIQUEMENT selon les transitions listées ci-dessous —
--     c'est le suivi d'exécution terrain de SA mission, rien d'autre.
--   - modalDetailById(), rôle photo : PATCH briefing_vu_at une fois
--     (marque le briefing comme vu), automatique, jamais choisi par
--     l'utilisateur.
-- Rien d'autre côté `prestations` n'est modifiable par un collaborateur
-- dans l'app : lieu/horaire/adresse sont saisis par sec/admin/prod
-- (modalDetailPrestation / modalProdFiche, actions réservées à ces
-- rôles) ; les heures/km/frais que le collaborateur déclare vont dans
-- `prestations_equipe` (déjà protégée séparément par
-- protect_sensitive_affectation_fields), pas dans `prestations`.
-- La policy RLS elle-même (qui détermine QUI a une ligne visible/
-- modifiable) n'est pas touchée par cette migration : seul l'ensemble des
-- colonnes modifiables par un non-privilégié est resserré, en défense en
-- profondeur contre un appel API direct qui contournerait l'UI.
--
-- ── Ce que fait cette migration ──
-- Nouveau trigger before update, indépendant de celui déjà en place sur
-- les champs financiers (les deux coexistent, chacun peut bloquer
-- indépendamment). Pour un utilisateur qui n'est PAS admin/sec/prod/
-- compta :
--   - lieu, adresse_complete, contact_sur_place, telephone_sur_place,
--     date_prestation, heure_debut, heure_fin, heure_rdv,
--     type_prestation, reference, description_besoin,
--     livrables_demandes, notes_internes, sport, equipes,
--     responsable_prod_id, responsable_prestation_id : toujours réservés
--     au staff (secrétariat/production).
--   - statut : modifiable uniquement selon les transitions déjà exposées
--     par le Mode Jour J (liste explicite ci-dessous, union desktop +
--     mobile). Toute autre valeur — y compris un statut commercial
--     ('confirmée', 'clôturée'...) ou un saut arrière — est refusée.
--   - briefing_vu_at : toujours modifiable (marquage self-service déjà
--     utilisé par l'app, sans enjeu).
--   - toute autre colonne (id, client_id, montants, statut_financier...)
--     n'est pas re-listée ici : déjà couverte par
--     protect_sensitive_prestation_fields, ou non modifiable par
--     construction (id).
--
-- Un admin/sec/prod/compta garde l'accès complet déjà permis par la
-- policy RLS — ce trigger ne change rien pour eux.
--
-- Idempotente. Nouveau fichier, NON EXÉCUTÉ — à relire puis lancer dans
-- Supabase → SQL Editor.
-- ============================================================

create or replace function protect_prestation_operational_fields()
returns trigger language plpgsql security definer as $$
declare
  is_privileged boolean;
  is_valid_transition boolean;
begin
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
    -- Union exacte des transitions exposées par le Mode Jour J côté
    -- SportVision-OS-Full.html : JOURJ_BTNS (desktop, fonction avanJourJ)
    -- et JJ_STATUT_ACTION (mobile, fonction jourJAction). C'est le seul
    -- flux qui laisse aujourd'hui un collaborateur changer `statut`.
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

drop trigger if exists trg_protect_prestation_operational_fields on prestations;
create trigger trg_protect_prestation_operational_fields
  before update on prestations
  for each row execute function protect_prestation_operational_fields();
