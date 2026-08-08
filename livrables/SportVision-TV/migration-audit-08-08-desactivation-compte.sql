-- ============================================================
-- Migration — vraie désactivation de compte (suite de l'audit du
-- 08/08/2026, item non traité #4)
--
-- "Supprimer un utilisateur" ne faisait qu'un DELETE sur profiles, qui
-- échouait en silence (contrainte FK RESTRICT par défaut) dès que le
-- collaborateur avait la moindre activité réelle (mission, réservation
-- de kit, incident déclaré...) — en pratique inutilisable pour tout
-- collaborateur ayant déjà travaillé, sans que le modal de confirmation
-- ne le dise. Remplacé côté JS par une désactivation réversible
-- (profiles.actif), voir SportVision-OS-Full.html (desactiverUser/
-- reactiverUser, doLogin, checkSession).
--
-- Idempotent. À exécuter dans Supabase → SQL Editor.
-- ============================================================

alter table profiles add column if not exists actif boolean not null default true;

create index if not exists idx_profiles_actif on profiles(actif) where actif = false;

-- Protège `actif` contre l'auto-réactivation : sans ça, un compte désactivé
-- qui détient encore un token Supabase valide (pas expiré) pourrait se
-- repasser actif=true lui-même via un PATCH direct sur /profiles (la policy
-- de base "Mise à jour profil personnel" autorise auth.uid() = id sur
-- n'importe quelle colonne non explicitement protégée). Étend le trigger
-- déjà en place pour role/grade (migration-securite-profiles-rls.sql) plutôt
-- que d'en créer un second.
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
       or new.actif is distinct from old.actif
    then
      raise exception 'Modification non autorisée : rôle, grade et statut du compte sont réservés à l''administrateur.';
    end if;
  end if;

  return new;
end;
$$;
-- Le trigger existant réutilise cette fonction (create or replace suffit).
