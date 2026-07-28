-- ═══════════════════════════════════════════════════════════════
-- PATCH JUILLET 2026 — À exécuter dans Supabase → SQL Editor
-- Sécurisé : toutes les instructions sont idempotentes (IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Colonne telephone sur profiles ─────────────────────────
-- Permet d'afficher le bouton "📞 Appeler" dans l'annuaire équipe
alter table profiles
  add column if not exists telephone text;

-- ─── 2. Colonnes étendues sur profiles (si migration-profiles-extended.sql
--         n'a pas encore été jouée en entier) ─────────────────────
alter table profiles
  add column if not exists avatar_url  text,
  add column if not exists bio         text,
  add column if not exists adresse     text,
  add column if not exists ville       text,
  add column if not exists code_postal text,
  add column if not exists vehicule    boolean default false,
  add column if not exists permis      boolean default false;

-- ─── 3. Colonne division sur clients ───────────────────────────
-- Permet de stocker le niveau de compétition (R1, Départemental…)
alter table clients
  add column if not exists division text;

-- ─── 4. Supprimer la FK de formations_quiz_custom ──────────────
-- Permet d'ajouter des quiz aux formations intégrées (builtin)
-- dont les IDs ne sont pas en DB
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'formations_quiz_custom_formation_id_fkey'
      and table_name = 'formations_quiz_custom'
  ) then
    alter table formations_quiz_custom
      drop constraint formations_quiz_custom_formation_id_fkey;
  end if;
end $$;

-- ─── Résultat attendu ──────────────────────────────────────────
-- profiles.telephone   → colonne ajoutée (ou déjà présente)
-- profiles.*           → colonnes avatar_url, bio, etc. confirmées
-- clients.division     → colonne ajoutée (ou déjà présente)
-- formations_quiz_custom → FK supprimée, quiz possibles sur toutes formations
