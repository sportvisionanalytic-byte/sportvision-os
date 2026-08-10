-- ============================================================
-- Migration additive : machine à états pour `prestations.statut`.
--
-- ── Constat (audit pipeline Secrétariat/Réservations, vérifié dans le
-- code avant d'écrire cette migration) ──
--
-- `prestations.statut` est un enum Postgres (statut_prestation,
-- supabase-schema-v2.sql) — l'enum garantit que la valeur écrite existe
-- dans la liste, mais ne dit rien sur l'ORDRE dans lequel on peut passer
-- d'une valeur à l'autre. Aucun trigger ne validait la séquence avant
-- cette migration. Toutes les écritures de `statut` passent par la policy
-- RLS "prestations_acces" (for all, cf. migration-cm-briefs.sql), qui ne
-- restreint que les LIGNES visibles, pas les valeurs. Concrètement,
-- `modifierPrestation()` (SportVision-OS-Full.html) expose un <select>
-- listant les ~32 statuts existants sans aucune contrainte JS sur la
-- valeur de départ — un saut direct 'demande_reçue' → 'clôturée' est
-- accepté tel quel aujourd'hui, par erreur de manipulation ou par appel
-- API direct.
--
-- ── Construction de la table de transitions ──
-- Reconstituée en listant TOUT le code qui écrit prestations.statut dans
-- SportVision-OS-Full.html et dans les fonctions/migrations SQL (RPC
-- client_cancel_prestation, seule écriture SQL directe trouvée) :
--   - La chaîne normale : _NEXT_ST (SportVision-OS-Full.html), le seul
--     endroit qui énumère l'ordre logique complet du workflow (utilisé
--     par les KPI, filtres et Kanban dans tout le fichier).
--   - Les sauts constatés dans du code réel et actuellement fonctionnel
--     (secQualifierDemande, secMarquerLivre, validerPrestation, la
--     synchronisation devis→prestation ajoutée le 10/08 dans
--     envoyerDevis()/_sendDevisEmailConfirm(), et le Mode Jour J desktop +
--     mobile qui fait sauter certaines étapes de planification).
--   - La sortie universelle vers 'annulée' : voir le commentaire dédié
--     plus bas, c'est un jugement métier assumé, pas une simple lecture
--     de code.
-- Toute transition qui n'apparaît dans AUCUNE de ces catégories est
-- refusée.
--
-- ── Portée : pas d'exemption de rôle ──
-- Ce trigger s'applique à tout le monde, y compris admin/sec/prod, dès
-- qu'un utilisateur authentifié (auth.uid() non nul) est à l'origine de
-- l'update — c'est délibéré : la faille visée par l'audit inclut un appel
-- API direct fait avec la session d'un membre du staff, pas seulement un
-- collaborateur. Seule exemption : auth.uid() IS NULL, c'est-à-dire une
-- requête exécutée hors contexte utilisateur (SQL Editor Supabase avec
-- tes identifiants, job service_role) — pour ne jamais te bloquer toi-même
-- si tu dois corriger une donnée à la main.
-- Conséquence assumée : le <select> libre de modifierPrestation() sera
-- désormais bloqué par la base sur toute valeur hors table ci-dessous,
-- MÊME pour admin/sec/prod. Si cela s'avère trop strict à l'usage
-- (besoin réel de corriger un statut mal renseigné depuis l'UI), la
-- correction la plus rapide est d'ajouter en tête de fonction :
--   if exists(select 1 from profiles where id = auth.uid() and role = 'admin') then return new; end if;
-- Volontairement NON ACTIVÉ par défaut ici — à toi de trancher.
--
-- Coexiste avec migration-prestations-rls-collaborateur-champs.sql (les
-- deux triggers before update s'exécutent tous les deux ; les transitions
-- Mode Jour J whitelistées côté collaborateur non-privilégié dans cette
-- autre migration sont reprises ici pour que le personnel privilégié qui
-- utilise le même écran (Jour J n'est affiché qu'au rôle 'photo' dans
-- l'app aujourd'hui, mais la table reste correcte si ça change) ne soit
-- pas bloqué non plus.
--
-- Idempotente. Nouveau fichier, NON EXÉCUTÉ — à relire puis lancer dans
-- Supabase → SQL Editor.
-- ============================================================

create or replace function validate_prestation_statut_transition()
returns trigger language plpgsql security definer as $$
declare
  is_known_transition boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.statut is distinct from old.statut then

    -- Sortie universelle : annuler reste possible depuis n'importe quel
    -- statut non déjà clôturé/annulé. Jugement métier assumé : aucune
    -- règle du code n'énumère explicitement "annulée depuis absolument
    -- n'importe où", mais client_cancel_prestation.sql autorise déjà
    -- l'annulation client depuis 5 statuts de début de pipeline, et
    -- modifierPrestation() est aujourd'hui le SEUL moyen pour le staff
    -- d'annuler une prestation déjà confirmée/planifiée (no-show, météo,
    -- doublon) — la bloquer casserait un usage opérationnel réel sans
    -- bénéfice de sécurité clair (une annulation n'expose ni argent ni
    -- données sensibles). À resserrer toi-même si besoin.
    if new.statut = 'annulée' and old.statut not in ('clôturée','annulée') then
      return new;
    end if;

    is_known_transition := (
      -- Chaîne normale (_NEXT_ST, SportVision-OS-Full.html)
      (old.statut = 'demande_reçue' and new.statut = 'à_qualifier')
      or (old.statut = 'à_qualifier' and new.statut = 'offre_en_préparation')
      or (old.statut = 'offre_en_préparation' and new.statut = 'devis_envoyé')
      or (old.statut = 'devis_envoyé' and new.statut = 'en_attente_réponse')
      or (old.statut = 'en_attente_réponse' and new.statut = 'devis_accepté')
      or (old.statut = 'devis_accepté' and new.statut = 'en_attente_signature')
      or (old.statut = 'en_attente_signature' and new.statut = 'en_attente_acompte')
      or (old.statut = 'en_attente_acompte' and new.statut = 'documents_complets')
      or (old.statut = 'documents_complets' and new.statut = 'à_valider_production')
      or (old.statut = 'à_valider_production' and new.statut = 'confirmée')
      or (old.statut = 'confirmée' and new.statut = 'à_planifier')
      or (old.statut = 'à_planifier' and new.statut = 'planifiée')
      or (old.statut = 'planifiée' and new.statut = 'équipe_affectée')
      or (old.statut = 'équipe_affectée' and new.statut = 'prête')
      or (old.statut = 'prête' and new.statut = 'équipe_en_route')
      or (old.statut = 'équipe_en_route' and new.statut = 'arrivée_sur_place')
      or (old.statut = 'arrivée_sur_place' and new.statut = 'production_démarrée')
      or (old.statut = 'production_démarrée' and new.statut = 'production_terminée')
      or (old.statut = 'production_terminée' and new.statut = 'médias_à_transférer')
      or (old.statut = 'médias_à_transférer' and new.statut = 'médias_complets')
      or (old.statut = 'médias_complets' and new.statut = 'à_monter')
      or (old.statut = 'à_monter' and new.statut = 'montage_en_cours')
      or (old.statut = 'montage_en_cours' and new.statut = 'prêt_validation')
      or (old.statut = 'prêt_validation' and new.statut = 'à_valider_client')
      or (old.statut = 'à_valider_client' and new.statut = 'prête_à_livrer')
      or (old.statut = 'prête_à_livrer' and new.statut = 'livrée')
      or (old.statut = 'livrée' and new.statut = 'facturée')
      or (old.statut = 'facturée' and new.statut = 'partiellement_payée')
      or (old.statut = 'partiellement_payée' and new.statut = 'payée')
      or (old.statut = 'payée' and new.statut = 'clôturée')
      -- Sauts constatés dans du code réel et fonctionnel aujourd'hui
      or (old.statut = 'demande_reçue' and new.statut = 'offre_en_préparation') -- secQualifierDemande()
      or (old.statut = 'demande_reçue' and new.statut = 'devis_envoyé') -- envoyerDevis()/_sendDevisEmailConfirm(), sync ajoutée le 10/08
      or (old.statut = 'à_qualifier' and new.statut = 'devis_envoyé') -- idem
      or (old.statut = 'prêt_validation' and new.statut = 'livrée') -- secMarquerLivre()
      or (old.statut = 'à_valider_production' and new.statut = 'refusée') -- validerPrestation(), rejet production
      -- Mode Jour J (avanJourJ desktop + jourJAction mobile) : whitelist
      -- identique à protect_prestation_operational_fields() dans
      -- migration-prestations-rls-collaborateur-champs.sql
      or (old.statut = 'confirmée' and new.statut = 'équipe_en_route')
      or (old.statut = 'équipe_affectée' and new.statut = 'équipe_en_route')
      or (old.statut = 'planifiée' and new.statut = 'équipe_en_route')
      or (old.statut = 'prête' and new.statut = 'production_démarrée')
    );

    if not is_known_transition then
      raise exception 'Transition de statut non autorisée : % → % ne correspond à aucun enchaînement connu du workflow.', old.statut, new.statut;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_prestation_statut_transition on prestations;
create trigger trg_validate_prestation_statut_transition
  before update on prestations
  for each row execute function validate_prestation_statut_transition();
