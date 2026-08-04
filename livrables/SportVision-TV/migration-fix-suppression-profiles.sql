-- Migration : corrige la suppression d'un collaborateur, jamais possible
-- jusqu'ici.
--
-- Cause : aucune policy RLS "for delete" n'a jamais existé sur `profiles`
-- (seules select et update sont couvertes depuis le schéma d'origine). Le
-- bouton Supprimer d'un utilisateur (supprimerUser(), écran Utilisateurs &
-- accès) exécutait donc un DELETE qui touchait 0 ligne — refusé en silence
-- par RLS, sans erreur renvoyée par PostgREST (0 ligne supprimée = succès
-- vide) — l'app affichait "Utilisateur supprimé" alors que rien n'avait
-- réellement été supprimé en base.
--
-- Correctif : seul un admin peut supprimer un profil (même principe déjà en
-- place pour la mise à jour, voir migration-securite-profiles-rls.sql — ce
-- pattern est sûr et ne provoque aucune récursion tant que la policy de
-- lecture personnelle directe "Lecture profil personnel" existe, ce qui est
-- le cas).
--
-- Idempotente : DROP ... IF EXISTS avant CREATE.
-- À exécuter dans Supabase → SQL Editor.

drop policy if exists "Admin supprime un profil" on profiles;
create policy "Admin supprime un profil" on profiles
  for delete using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );
