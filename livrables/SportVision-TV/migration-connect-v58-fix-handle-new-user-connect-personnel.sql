-- ============================================================
-- SPORTVISION — Migration v58
-- CORRIGE UN BUG CRITIQUE : chaque compte créé sur Connect (joueur,
-- particulier, agent) apparaît comme "collaborateur" dans SportVision OS.
--
-- ────────────────────────────────────────────────────────────────────────
-- CAUSE EXACTE (remontée par Fouka le 15/08, vérifiée avant d'écrire une
-- seule ligne ci-dessous)
-- ────────────────────────────────────────────────────────────────────────
--
-- `handle_new_user()` (trigger `on_auth_user_created`, after insert on
-- auth.users — déclenché par TOUT nouveau compte du projet Supabase, y
-- compris chaque signup Connect) insère automatiquement une ligne dans
-- `profiles` avec `role='photo'` par défaut pour tout signup public
-- (migration-connect-v31-fix-is-staff-cross-tenant-leak.sql, Partie A —
-- déjà un correctif de sécurité sur ce même trigger, mais qui garde
-- l'insertion, seulement en verrouillant le rôle à 'photo').
--
-- SportVision-OS-Full.html lit `profiles` DIRECTEMENT, sans filtre
-- (`sbFetch('profiles?select=id,prenom,nom,role...')`, vérifié à plusieurs
-- endroits : liste Collaborateurs, ET listes d'affectation photographe/
-- prod sur une prestation réelle, `role=in.(photo,prod)`). Donc CHAQUE
-- signup Connect apparaît dans l'Annuaire staff ET dans les listes
-- d'affectation d'une vraie prestation.
--
-- v31 avait aussi corrigé `is_staff()` pour exclure tout compte ayant une
-- ligne `memberships` (les anciens signups Connect club/coach/académie).
-- Le nouveau Connect personnel (Espace joueur/particulier, 14-15/08/2026)
-- n'utilise JAMAIS `memberships` — il utilise `player_profiles`/
-- `connect_profile_settings`/`connect_access_relationships` — donc ce
-- signal d'exclusion ne couvre PAS ces comptes : `is_staff()` renvoie
-- `true` pour tout joueur/particulier/agent inscrit sur le nouveau Connect
-- personnel, en plus du problème d'affichage ci-dessus.
--
-- ────────────────────────────────────────────────────────────────────────
-- CORRECTIF (deux parties, comme suggéré par v31 mais jamais tranché)
-- ────────────────────────────────────────────────────────────────────────
--
-- Partie A — LA VRAIE CAUSE, RÉGLÉE À LA RACINE : `handle_new_user()`
-- n'insère PLUS AUCUNE ligne `profiles` pour un signup public
-- (`invited_at is null`) — seul un compte réellement invité par un admin
-- (`invite-collaborateur`, qui vérifie déjà `role !== 'admin' → 403`
-- avant d'inviter) obtient une ligne `profiles`. Un client/joueur/
-- particulier/club Connect n'a strictement aucun besoin d'une ligne dans
-- l'annuaire staff — la déduction "role='photo' par défaut est neutre"
-- de v31 ne tient plus depuis que Connect personnel existe : ce n'est
-- PAS neutre, c'est la cause du bug remonté aujourd'hui.
--
-- Partie B — DÉFENSE EN PROFONDEUR (utile pour les lignes déjà créées
-- avant l'exécution de cette migration, tant que le nettoyage de la
-- Partie C n'a pas été fait) : `is_staff()` exclut désormais aussi tout
-- compte ayant une ligne `player_profiles` OU `connect_profile_settings`,
-- en plus de `memberships` déjà exclu par v31.
--
-- Partie C — NETTOYAGE DES LIGNES DÉJÀ CRÉÉES : fournie séparément à la
-- fin de ce fichier, en COMMENTAIRE, à exécuter par Fouka lui-même après
-- avoir vérifié le résultat du SELECT fourni juste avant. Je n'exécute
-- JAMAIS une suppression sur `profiles` sans revue humaine explicite —
-- une ligne staff réelle supprimée par erreur casserait immédiatement
-- l'accès de cette personne.
--
-- Parties A et B idempotentes (CREATE OR REPLACE), sans risque.
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- fonctions handle_new_user et is_staff existent déjà en base. Cet
-- en-tête disait à tort "NON EXÉCUTÉE".
-- ============================================================


-- ─── Partie A ───────────────────────────────────────────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  if new.invited_at is not null then
    insert into public.profiles (id, role, prenom, nom, email)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'role', 'photo'),
      coalesce(new.raw_user_meta_data->>'prenom', ''),
      coalesce(new.raw_user_meta_data->>'nom', ''),
      new.email
    );
  end if;
  return new;
end;
$$;


-- ─── Partie B ───────────────────────────────────────────────────────────
create or replace function is_staff()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role in ('admin','sec','prod','photo','cm','compta','com')
      and not exists (select 1 from memberships m where m.user_id = p.id)
      and not exists (select 1 from player_profiles pp where pp.user_id = p.id)
      and not exists (select 1 from connect_profile_settings cps where cps.user_id = p.id)
  );
$$;


-- ============================================================
-- Partie C — NETTOYAGE (NE PAS EXÉCUTER AUTOMATIQUEMENT AVEC LE RESTE DU
-- FICHIER). Étape 1, à exécuter en premier, en LECTURE SEULE — vérifie
-- toi-même la liste avant toute suppression :
--
--   select p.id, p.prenom, p.nom, p.email, p.role, u.created_at
--   from profiles p
--   join auth.users u on u.id = p.id
--   where u.invited_at is null
--     and (
--       exists (select 1 from player_profiles pp where pp.user_id = p.id)
--       or exists (select 1 from connect_profile_settings cps where cps.user_id = p.id)
--       or exists (select 1 from memberships m where m.user_id = p.id)
--     )
--   order by u.created_at desc;
--
-- Si (et seulement si) cette liste ne contient AUCUN vrai membre du staff
-- SportVision (elle ne devrait contenir que des comptes Connect clients),
-- étape 2 — suppression réelle, même filtre exact que le SELECT ci-dessus :
--
--   delete from profiles p
--   where p.id in (
--     select p2.id from profiles p2
--     join auth.users u on u.id = p2.id
--     where u.invited_at is null
--       and (
--         exists (select 1 from player_profiles pp where pp.user_id = p2.id)
--         or exists (select 1 from connect_profile_settings cps where cps.user_id = p2.id)
--         or exists (select 1 from memberships m where m.user_id = p2.id)
--       )
--   );
--
-- Si un compte de ce SELECT te semble être un vrai collaborateur (staff
-- interne qui aurait, par coïncidence, aussi un profil Connect
-- personnel), RETIRE-le du filtre avant de supprimer quoi que ce soit.
-- ============================================================
