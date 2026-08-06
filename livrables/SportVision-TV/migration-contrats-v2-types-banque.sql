-- Migration : contrats v2 — types issus de la « Banque de contrats modulables SportVision OS »
-- À exécuter dans Supabase → SQL Editor
--
-- Objectif :
--   1. Remplacer l'ancienne liste de type_contrat (abonnement_mensuel, abonnement_annuel,
--      forfait_saison, ponctuel, partenariat) par les vraies catégories de la banque de contrats.
--   2. Ajouter les colonnes nécessaires à la génération du texte contractuel (socle commun
--      25 articles + conditions particulières) dans genererContratPDF().
--
-- Propriétés : idempotente (ré-exécutable sans erreur) et sans perte de données
--              (les valeurs existantes sont remappées AVANT la pose de la nouvelle contrainte).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colonnes nécessaires à la génération du texte contractuel
-- ─────────────────────────────────────────────────────────────────────────────
alter table contrats
  add column if not exists tva_pct            numeric(5,2) default 20,
  add column if not exists engagement_mois    integer,
  add column if not exists preavis_jours      integer default 60,
  add column if not exists validite_signature boolean default false;

comment on column contrats.tva_pct            is 'Taux de TVA appliqué (%) — sert à calculer le prix HT depuis montant_mensuel (TTC).';
comment on column contrats.engagement_mois    is 'Durée d''engagement en mois — variable {{COMMITMENT_MONTHS}} des conditions particulières.';
comment on column contrats.preavis_jours      is 'Préavis de résiliation en jours — variable {{NOTICE_DAYS}} des conditions particulières.';
comment on column contrats.validite_signature is 'true = contrat effectivement signé ; pilote l''affichage « Bon pour accord » dans le PDF.';

-- Rattrapage des lignes existantes (colonnes ajoutées après coup : NULL au lieu du default)
update contrats set tva_pct            = 20    where tva_pct is null;
update contrats set preavis_jours      = 60    where preavis_jours is null;
update contrats set validite_signature = false where validite_signature is null;

-- Cohérence avec le suivi de signature déjà en place (migration-phase3-4-5.sql / portail-v1).
-- Les colonnes sources sont testées : la migration reste exécutable même si l'une d'elles
-- n'existe pas encore sur l'instance.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'contrats' and column_name = 'signature_statut') then
    update contrats set validite_signature = true
     where validite_signature is distinct from true and signature_statut = 'signee';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'contrats' and column_name = 'statut_signature') then
    update contrats set validite_signature = true
     where validite_signature is distinct from true and statut_signature = 'signe';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Suppression de l'ANCIENNE contrainte AVANT tout update
--    (sinon les UPDATE de remap ci-dessous violeraient la contrainte en place)
-- ─────────────────────────────────────────────────────────────────────────────
alter table contrats drop constraint if exists contrats_type_contrat_check;

-- Filet de sécurité : si la contrainte a été créée sous un autre nom, on la retrouve
-- et on la supprime aussi (toute contrainte CHECK de contrats portant sur type_contrat).
do $$
declare r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'contrats'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%type_contrat%'
  loop
    execute format('alter table contrats drop constraint %I', r.conname);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Remap des valeurs existantes vers les nouvelles catégories
--    (aucune ligne n'est supprimée : chaque ancienne valeur a une cible)
-- ─────────────────────────────────────────────────────────────────────────────
update contrats set type_contrat = 'full_communication'
 where type_contrat in ('abonnement_mensuel','abonnement_annuel');

update contrats set type_contrat = 'evenement'
 where type_contrat in ('forfait_saison','forfait_evenement');

update contrats set type_contrat = 'sponsoring'
 where type_contrat = 'partenariat';

-- Valeurs historiques rencontrées côté UI mais absentes de l'ancien CHECK
update contrats set type_contrat = 'ponctuel'
 where type_contrat in ('prestations_ponctuelles','prestation_ponctuelle');

-- Tout reliquat inconnu (import, saisie libre, ancienne version) part en 'autre'
-- plutôt que de faire échouer la pose de la contrainte.
update contrats set type_contrat = 'autre'
 where type_contrat is not null
   and type_contrat not in (
     'ponctuel','full_communication','club_plus','coach_academie',
     'evenement','joueur','sponsoring','pilote','autre'
   );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Nouveau default
--    L'ancien default ('abonnement_mensuel') n'existe plus : il violerait la nouvelle
--    contrainte sur tout INSERT n'indiquant pas de type. On retient 'ponctuel',
--    la catégorie la plus neutre et la moins engageante.
-- ─────────────────────────────────────────────────────────────────────────────
alter table contrats alter column type_contrat set default 'ponctuel';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Nouvelle contrainte (catégories de la Banque de contrats modulables)
-- ─────────────────────────────────────────────────────────────────────────────
alter table contrats
  add constraint contrats_type_contrat_check
  check (type_contrat in (
    'ponctuel',            -- SV-CL-001 — prestation ponctuelle
    'full_communication',  -- SV-CL-002 — accompagnement communication récurrent
    'club_plus',           -- SV-CL-003 — abonnement logiciel Club+
    'coach_academie',      -- conditions particulières à rédiger
    'evenement',           -- conditions particulières à rédiger
    'joueur',              -- conditions particulières à rédiger
    'sponsoring',          -- conditions particulières à rédiger
    'pilote',              -- conditions particulières à rédiger
    'autre'                -- conditions particulières à rédiger
  ));

comment on column contrats.type_contrat is
  'Catégorie de la Banque de contrats modulables SportVision OS. Détermine le bloc de conditions particulières inséré dans le PDF.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Vérification (à exécuter manuellement après migration)
-- ─────────────────────────────────────────────────────────────────────────────
-- select type_contrat, count(*) from contrats group by 1 order by 2 desc;
