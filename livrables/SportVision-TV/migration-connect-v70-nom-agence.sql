-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v70 (renumérotée depuis v69, collision avec
-- migration-connect-v69-montage-compilation-profile-writeback.sql écrite en parallèle par un
-- autre agent le même jour — v69 est déjà pris)
-- Nom d'agence facultatif pour un compte Agent (décidé par Fouka le 15/08) : un agent peut
-- renseigner le nom de son agence sur son profil, visible par les sportifs qui lui ont accordé
-- l'accès (relation acceptée, relation_type='agent').
--
-- ────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE FONCTION DÉDIÉE PLUTÔT QU'UNE POLICY RLS SUPPLÉMENTAIRE SUR CONNECT_PROFILE_SETTINGS
-- ────────────────────────────────────────────────────────────────────────
--
-- connect_profile_settings n'a qu'UNE SEULE policy ("cps_self_all", migration-connect-personnel-
-- accueil-profil-acces.sql) : `user_id = auth.uid()`, appliquée à toute la ligne. Un sportif qui a
-- accordé l'accès à un agent doit pouvoir lire le NOM D'AGENCE de cet agent — mais une policy SELECT
-- supplémentaire du type "grantee visible si relation acceptée" exposerait TOUTE la ligne
-- (téléphone, ville, sport, poste, categorie, notification_prefs, account_type,
-- profil_particulier, client_id...), pas seulement nom_agence. Ce projet a un principe déjà établi
-- ailleurs (voir commentaires connect_access_relationships, migration-connect-personnel-accueil-
-- profil-acces.sql) : "aucun annuaire public", jamais plus de surface exposée que nécessaire. Une
-- fonction SECURITY DEFINER dédiée, qui ne renvoie QUE nom_agence après avoir vérifié la relation,
-- respecte ce principe — même famille de choix que connect_os_account_detail (staff) ou
-- connect_agent_discount (déjà dans ce schéma), qui exposent un sous-ensemble contrôlé plutôt
-- qu'une policy RLS large.
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor. Idempotente
-- (add column if not exists, create or replace function).
-- ============================================================

-- ─── 1. Colonne ──────────────────────────────────────────────────────────
alter table connect_profile_settings add column if not exists nom_agence text;

comment on column connect_profile_settings.nom_agence is
  'Nom de l''agence, facultatif — pertinent pour profil_particulier=''agent'' uniquement (migration-'
  'connect-v67). Jamais lisible directement par un tiers via RLS (cps_self_all reste inchangée) — '
  'exposé au sportif concerné exclusivement via connect_get_agent_agency_names() ci-dessous.';

-- ─── 2. Lecture contrôlée pour un ou plusieurs sportifs (leur(s) propre(s) agent(s)) ────────
-- Renvoie UNIQUEMENT (user_id, nom_agence) pour les agents de p_agent_user_ids avec lesquels
-- L'APPELANT (auth.uid(), jamais un paramètre) a une relation acceptée de type 'agent' — aucune
-- autre colonne de connect_profile_settings n'est jamais exposée par cette fonction. Un
-- agent_user_id sans relation acceptée avec l'appelant, ou sans nom_agence renseigné, est
-- simplement absent du résultat (pas d'erreur — comportement "filtre", pas "vérifie et échoue").
create or replace function connect_get_agent_agency_names(p_agent_user_ids uuid[])
returns table (user_id uuid, nom_agence text)
language sql security definer stable set search_path = public
as $$
  select cps.user_id, cps.nom_agence
  from connect_profile_settings cps
  where cps.user_id = any(p_agent_user_ids)
    and cps.nom_agence is not null
    and exists (
      select 1 from connect_access_relationships car
      where car.owner_user_id = auth.uid()
        and car.grantee_user_id = cps.user_id
        and car.relation_type = 'agent'
        and car.status = 'acceptee'
    );
$$;

revoke all on function connect_get_agent_agency_names(uuid[]) from public;
grant execute on function connect_get_agent_agency_names(uuid[]) to authenticated;

-- ============================================================
-- FIN. Câblage frontend déjà écrit dans le même chantier (édition côté agent dans
-- PersonalInfoSection.tsx, affichage côté sportif dans acces/page.tsx + GrantCard.tsx) — à
-- ajuster pour appeler cette fonction au lieu d'un select direct sur connect_profile_settings
-- (voir le commit correspondant).
-- ============================================================
