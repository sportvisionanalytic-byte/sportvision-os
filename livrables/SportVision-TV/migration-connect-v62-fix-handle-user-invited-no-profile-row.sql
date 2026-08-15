-- ============================================================
-- SPORTVISION — Migration v60 — NON EXÉCUTÉE
-- Corrige une RÉGRESSION introduite PAR v58 lui-même (migration-connect-
-- v58-fix-handle-new-user-connect-personnel.sql, exécutée le 15/08) :
-- la PROCHAINE invitation d'un vrai collaborateur (via invite-collaborateur,
-- le SEUL chemin légitime de création de compte staff) ne créera PLUS AUCUNE
-- ligne `profiles` — cassant silencieusement l'accès du nouveau collaborateur
-- invité, alors même que son invitation aura semblé réussir.
--
-- ────────────────────────────────────────────────────────────────────────
-- CAUSE EXACTE (déduite en relisant, dans l'ordre chronologique, v31 → v35
-- → v58 — vérifiée en direct ci-dessous avec la clé service_role, lecture
-- seule)
-- ────────────────────────────────────────────────────────────────────────
--
-- 1. Supabase Auth crée `auth.users` en DEUX temps pour une invitation
--    (`admin.auth.admin.generateLink({type:'invite', ...})`, utilisé par
--    invite-collaborateur) : un INSERT initial où `invited_at` est encore
--    NULL, PUIS un UPDATE séparé qui pose `invited_at`. C'est exactement
--    ce que migration-connect-v35-fix-handle-user-invited-role.sql a
--    découvert et documenté (empiriquement, avec un compte jetable réel) :
--    le trigger INSERT `handle_new_user()` ne voit JAMAIS `invited_at`
--    renseigné, même pour une vraie invitation admin.
--
-- 2. v35 a donc ajouté un DEUXIÈME trigger, `handle_user_invited()` (AFTER
--    UPDATE on auth.users, quand invited_at passe de NULL à non-NULL), qui
--    fait un simple `UPDATE profiles SET role = ... WHERE id = new.id`.
--    Cela fonctionnait car, à l'époque (v31), `handle_new_user()` créait
--    TOUJOURS une ligne `profiles` (role='photo' par défaut) pour TOUT
--    signup — donc la ligne à mettre à jour existait déjà quand le second
--    trigger se déclenchait.
--
-- 3. v58 (aujourd'hui) a changé `handle_new_user()` pour ne PLUS insérer
--    AUCUNE ligne `profiles` tant que `invited_at is not null` — exactement
--    la condition que, selon le point 1 (découverte de v35, jamais recroisée
--    par v58), n'est JAMAIS vraie au moment où ce trigger INSERT s'exécute.
--    Résultat : `handle_new_user()` ne crée plus de ligne `profiles` pour
--    PERSONNE, pas même pour un vrai collaborateur invité. Le trigger UPDATE
--    de v35 tente ensuite un `UPDATE ... WHERE id = new.id` sur une ligne qui
--    n'a JAMAIS été créée : 0 ligne affectée, aucune erreur, échec silencieux.
--
-- Vérifié en direct (lecture seule, clé service_role, /auth/v1/admin/users) :
-- les 10 comptes staff réels actuels ont TOUS `invited_at = null` (créés
-- avant l'existence du flux d'invitation actuel) — donc ce chemin n'a encore
-- jamais été retesté en conditions réelles depuis v58. La prochaine
-- invitation via "Utilisateurs & accès" échouera silencieusement : e-mail
-- envoyé, lien d'invitation valide, mais AUCUN accès OS pour l'invité.
--
-- Ce n'est PAS une faille de sécurité (elle échoue fermé : personne ne
-- gagne un accès qu'il ne devrait pas avoir) — c'est une régression
-- fonctionnelle bloquante sur le seul chemin légitime d'onboarding staff.
-- À exécuter AVANT la prochaine invitation d'un collaborateur.
--
-- ────────────────────────────────────────────────────────────────────────
-- CORRECTIF
-- ────────────────────────────────────────────────────────────────────────
-- `handle_new_user()` (v58, INSERT trigger) reste STRICTEMENT identique —
-- son comportement (aucune ligne `profiles` créée à l'INSERT, quelle que
-- soit la raison) est correct et volontaire.
--
-- `handle_user_invited()` (v35, UPDATE trigger) passe d'un simple UPDATE à
-- un UPSERT (INSERT ... ON CONFLICT DO UPDATE), et n'agit QUE si le rôle
-- fourni dans les métadonnées est un rôle staff valide — c'est exactement
-- le signal qui distingue une invitation staff (invite-collaborateur,
-- seule à fournir `role` dans les métadonnées d'invitation) d'une invitation
-- Connect club/famille (org-invite, clubplus-invite, clubplus-family-invite
-- — vérifiées : aucune des trois ne fournit jamais `role` dans les
-- métadonnées, elles envoient seulement prenom/nom/telephone). Ces
-- invitations Connect continueront donc, comme avant v58, à ne JAMAIS créer
-- de ligne `profiles` — c'est le comportement voulu.
--
-- Rôles valides alignés sur la contrainte CHECK actuelle de profiles.role
-- (migration-finance-lot0.sql) ET sur ROLE_LABELS de invite-collaborateur/
-- index.ts, qui accepte bien 'expert_comptable' et 'auditeur' en plus des
-- 7 rôles historiques — ces deux valeurs manquaient dans le CASE de v35 et
-- dans is_staff() (v31/v58) : un expert-comptable ou auditeur invité aurait
-- silencieusement perdu son rôle réel. is_staff() n'est volontairement PAS
-- modifiée ici (ces deux rôles sont déjà gérés par des policies dédiées,
-- ex. migration-finance-fec.sql, qui vérifient le rôle directement plutôt
-- que via is_staff() — hors périmètre de ce correctif, comportement existant
-- et voulu).
--
-- Idempotente (CREATE OR REPLACE). NON EXÉCUTÉE — à relire puis exécuter
-- par Fouka dans Supabase → SQL Editor.
-- ============================================================

create or replace function handle_user_invited()
returns trigger language plpgsql security definer as $$
declare
  v_role text;
begin
  if old.invited_at is null and new.invited_at is not null then
    v_role := new.raw_user_meta_data->>'role';

    if v_role in ('admin','sec','prod','photo','cm','compta','com','expert_comptable','auditeur') then
      insert into public.profiles (id, role, prenom, nom, email)
      values (
        new.id,
        v_role,
        coalesce(new.raw_user_meta_data->>'prenom', ''),
        coalesce(new.raw_user_meta_data->>'nom', ''),
        new.email
      )
      on conflict (id) do update set
        role = excluded.role,
        prenom = coalesce(nullif(excluded.prenom, ''), profiles.prenom),
        nom = coalesce(nullif(excluded.nom, ''), profiles.nom),
        email = coalesce(excluded.email, profiles.email);
    end if;
    -- Si v_role est NULL ou n'est pas un rôle staff valide (cas normal des
    -- invitations Connect club/famille, qui ne fournissent jamais `role`),
    -- on ne fait STRICTEMENT rien : pas de ligne `profiles` créée. C'est le
    -- comportement voulu par v58.
  end if;
  return new;
end;
$$;

-- Le trigger lui-même (on_auth_user_invited) existe déjà depuis v35 et
-- pointe déjà vers cette fonction par son nom — aucun changement nécessaire
-- côté trigger, seul le corps de la fonction change (CREATE OR REPLACE).

-- ─── Vérification recommandée après exécution ─────────────────────────
-- 1. Inviter un collaborateur de test via "Utilisateurs & accès" (rôle non
--    admin, ex. "sec"). Vérifier qu'une ligne `profiles` apparaît bien avec
--    le bon rôle après que l'invité a suivi le lien (ou même avant, dès que
--    Supabase Auth pose invited_at — généralement immédiat après l'appel
--    generateLink).
-- 2. Vérifier qu'un signup Connect (club, joueur, particulier) via /auth/v1/
--    signup public ne crée toujours AUCUNE ligne `profiles` (comportement
--    v58, inchangé).
-- 3. Vérifier qu'une invitation club/famille Connect (org-invite,
--    clubplus-invite, clubplus-family-invite) ne crée toujours AUCUNE ligne
--    `profiles` (v_role sera NULL pour ces trois flux, donc no-op).
