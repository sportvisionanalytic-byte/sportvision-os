-- Migration URGENTE : corrige une boucle infinie RLS introduite par la policy
-- "Staff lecture annuaire" (migration-notification-prefs.sql), qui casse
-- actuellement TOUTE requête sur `profiles` et, par ricochet, sur toutes les
-- tables dont les policies vérifient le rôle via profiles (prestations,
-- clients, etc. — quasiment tout l'OS).
--
-- Cause : "exists (select 1 from profiles where id = auth.uid())" est une
-- sous-requête corrélée SUR LA MÊME TABLE que la policy protège. Pour évaluer
-- cette policy, Postgres doit réévaluer les policies RLS de profiles pour la
-- sous-requête — y compris cette policy elle-même — sans jamais pouvoir
-- s'arrêter : boucle infinie détectée (code 42P17).
--
-- Correctif : le besoin réel était juste "un utilisateur connecté" — inutile
-- de re-interroger profiles pour ça, auth.uid() suffit. Aucune sous-requête,
-- donc aucune récursion possible.
--
-- À exécuter en URGENCE dans Supabase → SQL Editor.

drop policy if exists "Staff lecture annuaire" on profiles;
create policy "Staff lecture annuaire" on profiles
  for select using (auth.uid() is not null);
