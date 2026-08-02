-- Migration de sécurité : verrouille les colonnes sensibles de `profiles`
-- (role, grade) contre une auto-promotion, et corrige des policies RLS qui
-- empêchaient en silence certaines écritures admin légitimes de fonctionner.
--
-- ─── Faille corrigée ─────────────────────────────────────────────────────────
-- La policy "Mise à jour profil personnel" (auth.uid() = id) autorisait un
-- utilisateur à modifier N'IMPORTE QUELLE colonne de SA PROPRE ligne via un
-- appel direct à l'API REST Supabase (en dehors de toute interface, avec la
-- simple clé publique déjà visible dans le code source de la page + son propre
-- jeton de session). Un compte photo/cm/sec/etc. pouvait donc s'auto-promouvoir
-- admin en un seul appel PATCH sur /profiles, indépendamment de ce que
-- l'interface affiche ou autorise visuellement.
--
-- ─── Bug fonctionnel découvert en même temps ────────────────────────────────
-- À l'inverse, aucune policy n'autorisait un admin à modifier le profil d'un
-- AUTRE utilisateur. Or plusieurs fonctions de l'OS le font directement :
-- changerRoleUser(), centreValiderGrade(), centreValidateGradeChange(). Ces
-- appels PATCH touchaient donc 0 ligne (refusés par RLS), sans jamais renvoyer
-- d'erreur exploitable côté app — PostgREST répond 200 avec un tableau vide sur
-- un UPDATE qui ne matche aucune ligne. L'OS affichait donc "Rôle mis à jour" /
-- "Grade mis à jour" alors que rien n'était réellement modifié en base.
--
-- ─── Ce que fait cette migration ────────────────────────────────────────────
-- 1. Empêche tout utilisateur non-admin de modifier role/grade/grade_valide_at/
--    grade_valide_par, y compris sur SA PROPRE ligne (via un trigger : RLS seule
--    ne peut pas restreindre par colonne, seulement par ligne).
-- 2. Ajoute la policy manquante permettant à l'admin de modifier le profil de
--    n'importe quel collaborateur (corrige changerRoleUser et la validation de
--    grade au passage).
-- 3. Autorise l'auto-insertion dans xp_events pour l'XP que l'on s'attribue à
--    soi-même (missions réalisées, formations, quiz réussis) : c'était bloqué
--    en silence jusqu'ici (seul un insert par un admin était permis), donc le
--    journal d'XP ne s'alimentait jamais pour l'XP auto-créditée — même si
--    profiles.xp, lui, montait bien (colonne non protégée avant cette migration).
--
-- ─── Risque résiduel assumé ─────────────────────────────────────────────────
-- La colonne `xp` reste modifiable par son propriétaire : c'est nécessaire à
-- syncMissionXp/soumettreQuiz/toggleFormLesson, qui créditent l'XP depuis la
-- session du collaborateur lui-même, sans passer par l'admin. Un utilisateur
-- techniquement averti pourrait donc s'auto-attribuer de l'XP arbitraire par un
-- appel direct à l'API. C'est un risque réel mais mineur : seul le `grade` fait
-- foi pour les permissions/avantages, et le passage de grade reste un acte
-- 100% admin, désormais protégé par le trigger ci-dessous. Une correction
-- complète nécessiterait de déplacer le calcul d'éligibilité XP dans une
-- fonction Postgres (RPC) plutôt que côté client JS — à envisager dans un
-- second temps si tu veux fermer aussi ce risque-là.
--
-- Idempotente : DROP ... IF EXISTS avant chaque CREATE, peut être rejouée sans
-- effet de bord.
-- À exécuter dans Supabase → SQL Editor.

-- ─── 1. Trigger de protection des colonnes sensibles sur profiles ───────────
create or replace function protect_sensitive_profile_fields()
returns trigger language plpgsql security definer as $$
declare
  is_admin boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role = 'admin'
  ) into is_admin;

  if not is_admin then
    if new.role is distinct from old.role
       or new.grade is distinct from old.grade
       or new.grade_valide_at is distinct from old.grade_valide_at
       or new.grade_valide_par is distinct from old.grade_valide_par
    then
      raise exception 'Modification non autorisée : rôle et grade sont réservés à l''administrateur.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_profile_fields on profiles;
create trigger trg_protect_sensitive_profile_fields
  before update on profiles
  for each row execute function protect_sensitive_profile_fields();

-- ─── 2. Policy manquante : l'admin peut modifier n'importe quel profil ──────
drop policy if exists "Admin met à jour tous profils" on profiles;
create policy "Admin met à jour tous profils" on profiles
  for update using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ─── 3. Auto-insertion dans xp_events pour son propre XP ────────────────────
drop policy if exists "xp_own_insert" on xp_events;
create policy "xp_own_insert" on xp_events for insert with check (
  collaborateur_id = auth.uid()
);
