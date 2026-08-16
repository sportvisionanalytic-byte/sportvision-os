-- ============================================================
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor.
-- Ne JAMAIS exécuter depuis un agent.
-- ============================================================
--
-- Fondations Club+ pour les rôles internes restants de la Product Bible
-- (CLUB-PLUS-PRODUCT-BIBLE.md §5/§6/§7/§8/§10) : Directeur sportif et
-- Administratif. AUCUN persona Joueur/Parent ici — ceux-ci vivent sur
-- app-connect (Connect), hors périmètre de ce chantier (brief Fouka
-- 17/08/2026 : "il n'y a pas de compte joueur ni parent, oublie-les, ils
-- sont sur Connect affilié").
--
-- Vérifié en direct par curl (REST, lecture seule, SUPABASE_URL/
-- SUPABASE_SECRET_KEY du .env racine) avant d'écrire cette migration :
--   - club_members.role : seule 'admin' est utilisée en prod aujourd'hui,
--     mais la check constraint autorise déjà les 11 valeurs de
--     migration-clubplus-v1.sql. Aucune trace de 'directeur_sportif' ni
--     'administratif'.
--   - clubs?select=id,requires_result_verification -> 42703 "column does
--     not exist" : la colonne n'existe pas encore, sûr de l'ajouter.
--   - club_matches?select=id,verified_by,verified_at -> réponse vide sans
--     erreur : les 2 colonnes existent déjà (posées par
--     migration-clubplus-v37-team-scoping-statuts-liaison.sql, déjà
--     exécutée), jamais lues/écrites par le code — c'est cette migration
--     qui active enfin leur consommation (voir data/club/matches.ts
--     § verifyClubMatchResult, hors fichier SQL).
--   - v40 confirmé comme prochain numéro libre (dernier fichier présent :
--     migration-clubplus-v39-visibilite-facture-partielle-support-
--     reponse.sql).
--
-- Idempotente : chaque étape peut être rejouée sans erreur.

-- ── 1. club_members.role — ajoute 'directeur_sportif' et 'administratif' ──
-- Ne retire aucune des 11 valeurs existantes (migration-clubplus-v1.sql).
-- Nom de contrainte non explicité à la création (`role text check (role in
-- (...))` inline) : Postgres l'a donc nommée par défaut club_members_role_check
-- — confirmé par convention de nommage standard, aucune autre migration de ce
-- dépôt ne l'a renommée depuis (grep "club_members_role_check"/"drop constraint"
-- sur livrables/SportVision-TV/*.sql : aucun résultat).

alter table club_members drop constraint if exists club_members_role_check;

alter table club_members add constraint club_members_role_check check (role in (
  'admin','president','secretaire','comm','cm_externe','coach',
  'resp_equipe','sponsor_mgr','tresorier','membre_bureau','lecture_seule',
  'directeur_sportif','administratif'
));

-- ── 2. is_team_educateur() — Directeur sportif rejoint le scope équipe ──
-- Reproduit exactement la fonction existante (dernière définition :
-- migration-clubplus-v21.sql, qui avait étendu le groupe "accès total" à
-- 'president'), en ajoutant seulement 'directeur_sportif' au groupe scopé
-- équipe (comme coach/resp_equipe : cm.teams doit contenir le nom de
-- l'équipe). Le Directeur sportif supervise PLUSIEURS équipes/groupes
-- (Bible §8) : club_members.teams est déjà un tableau JSONB, un même
-- membre peut donc déjà porter plusieurs noms d'équipe dedans — aucun
-- nouveau mécanisme de scope multi-équipes n'est nécessaire.
-- CREATE OR REPLACE : ne duplique pas la fonction existante.

create or replace function is_team_educateur(p_team_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from club_members cm, club_teams ct
    where ct.id = p_team_id and cm.club_id = ct.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and (
        cm.role in ('admin', 'president')
        or (cm.role in ('coach', 'resp_equipe', 'directeur_sportif') and cm.teams @> to_jsonb(ct.name::text))
      )
  );
$$;

-- ── 3. clubs.requires_result_verification — workflow de vérification (§8) ──
-- Colonne seule pour cette migration : configurable plus tard depuis
-- Paramètres > Organisation par l'admin (hors périmètre de ce chantier —
-- juste la colonne + la lecture, voir data/club/matches.ts). Défaut false :
-- un club existant n'active pas silencieusement un workflow supplémentaire
-- qu'il n'a jamais demandé.

alter table clubs add column if not exists requires_result_verification boolean not null default false;
