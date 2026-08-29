-- ============================================================================
-- migration-audit-final-idempotence-guards.sql
-- Audit final autonome (29/08/2026, nuit) — traçage workflows + idempotence
-- ============================================================================
-- Deux garde-fous de base manquants, identifiés indépendamment par plusieurs
-- traçages de workflow (A "Prestation Connect", C "Full Communication",
-- F "rémunération opérateur"), avec confirmation qu'aucune ligne existante
-- ne viole la contrainte avant de l'ajouter (vérifié : les deux tables
-- concernées sont vides en production à ce jour — aucun risque de migration
-- destructive).
--
-- 1) prestations_equipe(prestation_id, collaborateur_id) — la fonction
--    ajouterMembreEquipe() (SportVision-OS-Full.html) documente elle-même,
--    en commentaire, qu'un double-clic ou une resélection concurrente peut
--    créer deux lignes pour le même (prestation, collaborateur) : double
--    notification, double comptage de rémunération dans les rapports Prod/
--    Compta/"Mes revenus" (qui somment sans déduplication). La garde
--    actuelle est un check-then-act 100% côté client (lecture puis écriture,
--    deux requêtes réseau séparées, sans transaction) — pas une garde en
--    base. On ferme la fenêtre de course avec un index unique partiel, en
--    excluant les états terminaux (refusée/remplacée/annulée) pour ne pas
--    empêcher une réaffectation légitime après refus/remplacement.
--
-- 2) factures(prestation_id) — getOrCreateFacture() fait aussi un
--    check-then-act (lecture de factures?prestation_id=eq.X, puis insert si
--    absent) sans verrou ni contrainte. Le modèle métier actuel n'utilise
--    qu'un seul type de facture par prestation (type_facture='totalite',
--    seule valeur écrite dans tout le code), et l'UI elle-même masque déjà
--    le bouton "Émettre" dès qu'une facture existe (p.factures?.length) —
--    la règle "une facture par prestation" est donc déjà la règle produite
--    en vigueur, seulement pas garantie en base.
-- ============================================================================

do $$ begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'prestations_equipe_active_uniq'
  ) then
    create unique index prestations_equipe_active_uniq
      on prestations_equipe (prestation_id, collaborateur_id)
      where statut in ('invitation_envoyée', 'en_attente', 'acceptée');
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'factures_prestation_id_uniq'
  ) then
    create unique index factures_prestation_id_uniq
      on factures (prestation_id)
      where prestation_id is not null;
  end if;
end $$;
