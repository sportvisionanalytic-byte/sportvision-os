-- ============================================================
-- Migration — Audit nocturne de sécurité (08/08 → 09/08/2026)
--
-- Audit en LECTURE SEULE mené sur les 145 fichiers migration-*.sql de ce
-- dossier (schéma Supabase de sportvision-os). Cette migration corrige les
-- 4 findings SQL confirmés par relecture directe du code source (pas
-- seulement du résumé d'audit). Un 5e point (logs manquants dans des
-- catch() silencieux de 4 edge functions) a été corrigé séparément et
-- directement dans le code TypeScript — ce n'est pas du schéma, donc hors
-- périmètre de ce fichier.
--
-- Idempotente dans son ensemble : CREATE OR REPLACE FUNCTION, DROP POLICY
-- IF EXISTS avant CREATE POLICY, REVOKE/GRANT (no-op si déjà dans l'état
-- cible). Peut être rejouée sans effet de bord.
-- À exécuter dans Supabase → SQL Editor, par Fouka — jamais par un agent.
-- ============================================================


-- ═══════════════════════════════════════════════════════════════════════
-- 1. CRITIQUE — protect_sensitive_profile_fields() ne protège plus
--    niveau_cm (régression)
-- ═══════════════════════════════════════════════════════════════════════
-- ─── Découverte ──────────────────────────────────────────────────────────
-- migration-cm-tiers.sql (07/08) avait étendu ce trigger pour interdire la
-- modification de profiles.niveau_cm (le palier CM, qui conditionne l'accès
-- RLS en lecture à clients/contrats/marges via contenus_visible_par_cm) à
-- quiconque n'est ni admin ni Lead CM.
--
-- migration-audit-08-08-desactivation-compte.sql (08/08, plus récent) a
-- refait un `create or replace function protect_sensitive_profile_fields()`
-- pour protéger la colonne `actif` (empêcher l'auto-réactivation d'un
-- compte désactivé) — mais CREATE OR REPLACE remplace tout le corps de la
-- fonction, il ne fusionne rien avec la version précédente. Le contrôle
-- niveau_cm de migration-cm-tiers.sql a donc disparu silencieusement : la
-- version actuellement en base ne protège plus QUE role/grade/grade_valide_*
-- et actif. Un collaborateur quelconque peut aujourd'hui s'auto-attribuer
-- n'importe quel niveau_cm (y compris 'cm_lead') par un PATCH direct sur
-- /profiles, et donc gagner un accès en lecture élargi à des clients,
-- contrats et messages qui ne le concernent pas.
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- Recombine les deux contrôles dans un seul corps de fonction : rien n'est
-- perdu de la version actuelle (actif réservé à l'admin, sans exception —
-- cf. commentaire original : « pas de RPC dédiée pour le faire autrement »,
-- donc pas de raison d'ouvrir d'exception Lead CM ici), et niveau_cm
-- retrouve sa protection admin-ou-Lead-CM de migration-cm-tiers.sql.
-- Le trigger trg_protect_sensitive_profile_fields (posé par migration-
-- securite-profiles-rls.sql) réutilise cette fonction telle quelle —
-- CREATE OR REPLACE suffit, pas besoin de recréer le trigger.
create or replace function protect_sensitive_profile_fields()
returns trigger language plpgsql security definer as $$
declare
  is_admin boolean;
  is_lead_cm boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role = 'admin'
  ) into is_admin;

  select exists(
    select 1 from profiles where id = auth.uid() and role = 'cm' and niveau_cm = 'cm_lead'
  ) into is_lead_cm;

  if not is_admin then
    if new.role is distinct from old.role
       or new.grade is distinct from old.grade
       or new.grade_valide_at is distinct from old.grade_valide_at
       or new.grade_valide_par is distinct from old.grade_valide_par
       or new.actif is distinct from old.actif
    then
      raise exception 'Modification non autorisée : rôle, grade et statut du compte sont réservés à l''administrateur.';
    end if;
    if new.niveau_cm is distinct from old.niveau_cm and not is_lead_cm then
      raise exception 'Modification non autorisée : le niveau CM est réservé à l''administrateur ou au Lead CM.';
    end if;
  end if;

  return new;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. ÉLEVÉ — rpc_get_custom_quiz() sans contrôle d'accès
-- ═══════════════════════════════════════════════════════════════════════
-- ─── Découverte ──────────────────────────────────────────────────────────
-- migration-audit-08-08-quiz-correction-serveur.sql a créé
-- rpc_get_custom_quiz(p_formation_id text) en `language sql security
-- definer`, avec un `grant execute ... to authenticated` mais aucun
-- `revoke ... from public` et surtout aucune vérification d'identité ou
-- d'inscription dans le corps de la fonction : un simple `select` filtré
-- uniquement par p_formation_id. N'importe quel compte authentifié peut
-- donc appeler rpc/rpc_get_custom_quiz avec l'id de N'IMPORTE QUELLE
-- formation (y compris une formation à laquelle il n'est pas inscrit) et
-- récupérer questions + options — sans les bonnes réponses, mais ce n'est
-- pas censé être accessible du tout hors inscription active.
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- Repasse en `language plpgsql` (signature et type de retour inchangés,
-- CREATE OR REPLACE l'autorise) pour ajouter le même style de contrôle que
-- rpc_submit_quiz/rpc_complete_formation dans le même fichier : exige une
-- authentification, puis exige soit une ligne dans formation_inscriptions
-- pour ce formation_id et ce collaborateur (quel que soit son statut —
-- même choix que rpc_submit_quiz, qui ne filtre pas non plus sur `statut`),
-- soit un rôle admin/prod — même périmètre « staff formation » que
-- fi_own_read/fi_admin_update (migration-formation-v1.sql) et fsess_manage
-- (migration-formation-v2.sql), cohérent avec le fait que fqc_select
-- autorise déjà l'admin en lecture directe de formations_quiz_custom.
-- Ferme aussi l'angle mort PUBLIC (jamais revoke jusqu'ici) : authenticated
-- uniquement, avec le contrôle d'inscription en plus comme filet.
create or replace function rpc_get_custom_quiz(p_formation_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_authorized boolean;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  select
    exists (select 1 from profiles where id = v_uid and role in ('admin','prod'))
    or exists (select 1 from formation_inscriptions where formation_id = p_formation_id and collaborateur_id = v_uid)
  into v_authorized;

  if not v_authorized then
    raise exception 'Non autorisé : inscription requise pour accéder à ce quiz.';
  end if;

  return coalesce(
    (select jsonb_agg(jsonb_build_object('question', question, 'options', options) order by ordre)
     from formations_quiz_custom
     where formation_id = p_formation_id),
    '[]'::jsonb
  );
end;
$$;

revoke execute on function rpc_get_custom_quiz(text) from public, anon, authenticated;
grant execute on function rpc_get_custom_quiz(text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
-- 3. MOYEN — 6 fonctions SECURITY DEFINER jamais verrouillées par REVOKE
-- ═══════════════════════════════════════════════════════════════════════
-- ─── Découverte ──────────────────────────────────────────────────────────
-- contenus_visible_par_cm, media_ref_club_id, media_has_unauthorized_
-- tagged_player, is_media_visible_to_family, club_member_has_client_access
-- et parent_visible_to_club_admin sont toutes SECURITY DEFINER, prennent
-- une identité ou une ressource cible en paramètre plutôt que de tout
-- dériver de auth.uid() en interne, et n'ont jamais eu de `revoke execute`
-- — exactement le même schéma que le relais de phishing fermé par
-- migration-securite-enqueue-notification.sql. PostgREST expose par défaut
-- toute fonction du schéma public en RPC ; sans revoke, ces 6 fonctions
-- sont donc directement appelables par n'importe qui, y compris `anon`
-- (non authentifié), avec des paramètres arbitraires — une personne non
-- connectée peut par exemple sonder si un uid X a accès au client Y via
-- contenus_visible_par_cm(Y, X), sans jamais se connecter.
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- Revoke uniforme sur les 6 (from public, anon, authenticated), puis
-- re-grant à `authenticated` UNIQUEMENT pour celles réellement appelées à
-- la racine d'une policy RLS ou d'une vue (donc évaluées avec les droits du
-- rôle appelant — authenticated en pratique) : sans ce re-grant, les
-- lectures normales des tables/vues concernées échoueraient pour tout le
-- monde. Vérifié une par une par recherche des points d'appel réels :
--
--   • contenus_visible_par_cm(uuid, uuid) : appelée directement dans de
--     nombreuses policies (contenus, clients, contrats, messages_client,
--     briefs, club_documents...) → re-grant authenticated nécessaire.
--   • media_ref_club_id(text, uuid) : appelée comme argument direct dans
--     les policies de media_player_tags (mpt_member_select/insert/delete)
--     → re-grant authenticated nécessaire.
--   • is_media_visible_to_family(text, uuid) : appelée directement dans
--     cmd_family_select/ccr_family_select (club_media/club_creations)
--     → re-grant authenticated nécessaire.
--   • club_member_has_client_access(uuid) : appelée directement dans les
--     vues client_devis/client_factures/client_contrats (les vues
--     n'exécutent PAS les fonctions qu'elles appellent avec les droits du
--     propriétaire de la vue — seul l'accès aux tables sous-jacentes en
--     bénéficie ; l'EXECUTE sur la fonction reste vérifié pour le rôle
--     appelant réel) → re-grant authenticated nécessaire.
--   • parent_visible_to_club_admin(uuid) : appelée directement dans la
--     policy parp_club_admin_select (parent_profiles) → re-grant
--     authenticated nécessaire.
--   • media_has_unauthorized_tagged_player(text, uuid) : UNIQUEMENT
--     appelée depuis le corps de is_media_visible_to_family(), elle-même
--     SECURITY DEFINER — l'appel interne s'exécute avec les droits du
--     propriétaire de la fonction appelante, pas du rôle HTTP d'origine
--     (même principe que migration-securite-enqueue-notification.sql) →
--     AUCUN re-grant direct nécessaire.
--
-- Risque résiduel assumé (non fermé ici, hors périmètre de ce correctif) :
-- ces fonctions continuent d'accepter une identité/ressource cible en
-- paramètre plutôt que de la dériver uniquement de auth.uid(). Un compte
-- authentifié quelconque (pas seulement anon) peut donc toujours appeler
-- ces RPC directement avec des paramètres arbitraires (ex. sonder l'accès
-- d'un AUTRE uid à un client donné) et obtenir un simple booléen — fuite
-- d'information mineure (pas les données elles-mêmes), mais réelle. Fermer
-- complètement ce point nécessiterait de réécrire chaque fonction pour
-- ignorer tout paramètre d'identité fourni et n'utiliser que auth.uid() en
-- interne, ce qui n'a pas été demandé ici et casserait potentiellement des
-- appels légitimes existants (ex. contenus_visible_par_cm est toujours
-- invoquée avec p_uid = auth.uid() dans le code actuel, donc sans risque
-- immédiat, mais rien ne l'empêche techniquement d'être appelée autrement).
revoke execute on function contenus_visible_par_cm(uuid, uuid) from public, anon, authenticated;
grant execute on function contenus_visible_par_cm(uuid, uuid) to authenticated;

revoke execute on function media_ref_club_id(text, uuid) from public, anon, authenticated;
grant execute on function media_ref_club_id(text, uuid) to authenticated;

revoke execute on function media_has_unauthorized_tagged_player(text, uuid) from public, anon, authenticated;
-- Pas de re-grant : usage interne uniquement (cf. ci-dessus).

revoke execute on function is_media_visible_to_family(text, uuid) from public, anon, authenticated;
grant execute on function is_media_visible_to_family(text, uuid) to authenticated;

revoke execute on function club_member_has_client_access(uuid) from public, anon, authenticated;
grant execute on function club_member_has_client_access(uuid) to authenticated;

revoke execute on function parent_visible_to_club_admin(uuid) from public, anon, authenticated;
grant execute on function parent_visible_to_club_admin(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
-- 4. FAIBLE — kit_reservations : policy SELECT permissive oubliée lors
--    d'un durcissement
-- ═══════════════════════════════════════════════════════════════════════
-- ─── Découverte ──────────────────────────────────────────────────────────
-- migration-kits-rls-photo.sql avait créé "kit_resa_via_equipe" : tout
-- collaborateur membre de l'équipe assignée à la prestation (via
-- prestations_equipe) peut voir la réservation de kit correspondante.
--
-- migration-connect-v1b-securite-hardening-backlog.sql (postérieure) a
-- ensuite entièrement repensé les policies de kit_reservations : elle a
-- DROP la policy "kit_resa_acces" ("for all", trop permissive — laissait
-- n'importe quel collaborateur modifier/supprimer librement) et l'a
-- remplacée par 4 policies dédiées par commande, dont "kit_resa_select"
-- volontairement plus stricte : admin/prod, ou collaborateur_id =
-- auth.uid() uniquement — aucune mention d'un accès élargi à l'équipe.
--
-- Problème : "kit_resa_via_equipe" n'a jamais été droppée (elle n'était
-- pas nommée "kit_resa_acces", donc hors de portée du DROP POLICY IF
-- EXISTS du hardening). Les deux policies SELECT coexistent, et Postgres
-- combine plusieurs policies permissives sur la même commande en OR :
-- l'accès réel en lecture est donc resté aussi large qu'avant le
-- durcissement (tout membre d'équipe voit toujours tout), ce qui annule
-- concrètement l'intention de resserrement de kit_resa_select pour le
-- SELECT.
--
-- ─── Décision ────────────────────────────────────────────────────────────
-- On retire kit_resa_via_equipe plutôt que de la documenter comme
-- coexistence volontaire. Raisonnement : le hardening (v1b) est la
-- migration la plus récente et la plus explicitement réfléchie sur le
-- périmètre voulu pour cette table (son commentaire décrit précisément
-- « admin/prod ou soi-même », sans jamais mentionner ni exempter la
-- visibilité d'équipe) — tout indique un oubli plutôt qu'un choix assumé
-- de laisser cohabiter les deux. Si la visibilité d'équipe (savoir qui a
-- réservé quel kit sur une prestation commune) est un vrai besoin produit,
-- elle mérite d'être réintroduite consciemment plus tard, potentiellement
-- restreinte à des colonnes non sensibles, plutôt que de subsister par
-- défaut. À VÉRIFIER avec Fouka avant exécution si ce n'est pas le
-- comportement voulu : si la visibilité d'équipe doit être conservée, ne
-- pas exécuter cette section (ou la remplacer par un commentaire actant le
-- choix inverse).
drop policy if exists "kit_resa_via_equipe" on kit_reservations;
