-- ============================================================
-- SPORTVISION CLUB+ — Migration v37
-- Suite de migration-clubplus-v1 à v36.sql. Idempotente.
--
-- Corrige 4 trous identifiés par les 2 audits produit/sécurité Club+ du
-- 16/08/2026 (voir CLUB-PLUS-PRODUCT-BIBLE.md §5/§8/§16/§17/§18/§24) :
--
--   1. Scope équipe réel (club_teams, club_member_teams, team_id) —
--      aujourd'hui club_bookings.team et club_members.teams sont du texte
--      libre non lié, le "scope équipe" d'un coach (Sidebar.tsx,
--      ClubServicesBoard.tsx) n'est qu'un filtre d'affichage, PAS une
--      frontière RLS. Un coach U18 peut lire/écrire toutes les équipes du
--      club via un appel direct au client Supabase.
--   2. RLS équipe-level réelle (is_club_team_scoped_member) sur
--      club_bookings et club_matches.
--   3. Statuts manquants : 'annulee' sur club_bookings.status ; 'reportee'
--      et 'annulee' sur club_matches.status ; verified_by/verified_at sur
--      club_matches pour le futur workflow de vérification Directeur
--      sportif (§8, optionnel selon requires_result_verification — non
--      implémenté dans cette migration, seulement les colonnes).
--   4. Lien club_requests <-> contenus (request_id sur contenus), pour que
--      "brief envoyé" et "contenu en production/validation" redeviennent
--      progressivement un seul objet traçable (§3 règle de non duplication,
--      §17), sans dupliquer ni fusionner les deux tables dans ce chantier.
--
-- ─── Vérification des données réelles avant migration (16/08/2026) ───────
-- Interrogation en lecture seule de la prod (REST, service role) avant
-- d'écrire cette migration :
--   - club_bookings.team  : 1 seule ligne existante, team = NULL.
--   - club_members.teams  : 4 lignes, teams = '[]' (vide) sur les 4.
--   - club_matches        : 0 ligne.
--   - clubs                : 2 lignes, dont "ZZZ-CROSSTENANT-AUDIT-A-DELETE-ME"
--                             (club de test d'audit, à ignorer).
-- Autrement dit : à ce jour, AUCUNE valeur d'équipe en texte libre n'existe
-- en production sur ces 3 colonnes. Il n'y a donc rien de "sale" à trier —
-- il n'y a simplement rien à migrer. Le bloc 1 ci-dessous reste écrit de
-- façon générique et idempotente (au cas où des données de test seraient
-- ajoutées entre cette rédaction et l'exécution par Fouka), mais avec une
-- correspondance EXACTE après trim() uniquement, jamais de rapprochement
-- flou/insensible à la casse : si un jour des valeurs réelles et sales
-- apparaissent (mêmes équipes orthographiées différemment), ce mapping
-- automatique simple les traitera comme des équipes distinctes plutôt que
-- de deviner un rapprochement risqué — à corriger manuellement par Fouka
-- via l'UI (à construire) le cas échéant, pas par cette migration.
--
-- ─── Décision : anciennes colonnes texte libre CONSERVÉES telles quelles ──
-- club_bookings.team, club_matches.team et club_members.teams ne sont NI
-- renommées NI supprimées dans cette migration (choix "garde-les en
-- lecture" plutôt que suffixe _legacy) : elles restent la source lue/écrite
-- par tout le code applicatif existant (data/club/matches.ts,
-- data/club/bookings.ts, data/club/users.ts, ClubServicesBoard.tsx,
-- Sidebar.tsx, l'edge function clubplus-invite) sans aucune modification.
-- Seules de NOUVELLES colonnes team_id (nullable) sont ajoutées à côté.
-- Aucune UI n'est branchée sur team_id dans ce chantier : les nouvelles
-- colonnes restent à NULL pour toutes les lignes existantes et pour toute
-- ligne créée par le code actuel, donc AUCUNE régression de comportement
-- (voir bloc 2, la RLS traite team_id NULL comme "visible par tout membre
-- du club", exactement le comportement actuel). Renommer les colonnes texte
-- libre et rebrancher l'UI dessus est un chantier de suivi volontairement
-- laissé à Fouka (permet un rollback simple : DROP des nouvelles tables/
-- colonnes sans toucher au code applicatif actuel).
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL
-- Editor. Ne JAMAIS exécuter depuis un agent.
-- ============================================================

-- ────────────────────────────────────────────────────────────────────────
-- 1. TABLE club_teams (normalisée) + club_member_teams (liaison) + team_id
-- ────────────────────────────────────────────────────────────────────────

create table if not exists club_teams (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  nom text not null,
  categorie text,
  created_at timestamptz default now(),
  unique (club_id, nom)
);

alter table club_teams enable row level security;

drop policy if exists "ct_member_select" on club_teams;
create policy "ct_member_select" on club_teams for select using (is_club_member(club_id));

drop policy if exists "ct_admin_insert" on club_teams;
create policy "ct_admin_insert" on club_teams for insert with check (is_club_admin(club_id));

drop policy if exists "ct_admin_update" on club_teams;
create policy "ct_admin_update" on club_teams for update using (is_club_admin(club_id));

drop policy if exists "ct_admin_delete" on club_teams;
create policy "ct_admin_delete" on club_teams for delete using (is_club_admin(club_id));

create index if not exists idx_ct_club on club_teams(club_id);

-- Table de liaison membre <-> équipe(s), remplace le tableau texte libre
-- club_members.teams (conservé tel quel, voir note en tête de fichier).
-- Un membre sans aucune ligne ici = scope organisation entière (comportement
-- équivalent à teamScope=[] aujourd'hui) — c'est la condition utilisée par
-- is_club_team_scoped_member() ci-dessous.
create table if not exists club_member_teams (
  member_id uuid references club_members(id) on delete cascade not null,
  team_id uuid references club_teams(id) on delete cascade not null,
  created_at timestamptz default now(),
  primary key (member_id, team_id)
);

alter table club_member_teams enable row level security;

-- Pas de récursion à craindre ici : ces policies interrogent club_members
-- (via is_club_member/is_club_admin, déjà SECURITY DEFINER), jamais
-- club_member_teams elle-même.
drop policy if exists "cmt_member_select" on club_member_teams;
create policy "cmt_member_select" on club_member_teams for select using (
  exists (select 1 from club_members cm where cm.id = member_id and is_club_member(cm.club_id))
);

drop policy if exists "cmt_admin_insert" on club_member_teams;
create policy "cmt_admin_insert" on club_member_teams for insert with check (
  exists (select 1 from club_members cm where cm.id = member_id and is_club_admin(cm.club_id))
);

drop policy if exists "cmt_admin_delete" on club_member_teams;
create policy "cmt_admin_delete" on club_member_teams for delete using (
  exists (select 1 from club_members cm where cm.id = member_id and is_club_admin(cm.club_id))
);

create index if not exists idx_cmt_member on club_member_teams(member_id);
create index if not exists idx_cmt_team on club_member_teams(team_id);

-- team_id sur les deux tables qui portaient déjà un `team` texte libre.
alter table club_bookings add column if not exists team_id uuid references club_teams(id);
alter table club_matches add column if not exists team_id uuid references club_teams(id);

create index if not exists idx_cbk_team on club_bookings(team_id);
create index if not exists idx_cma_team on club_matches(team_id);

-- ── Backfill idempotent (no-op aujourd'hui, voir constat en tête de fichier) ──

-- 1a. club_teams à partir des valeurs distinctes déjà observées, par club,
--     sur les 3 sources (club_bookings.team, club_matches.team,
--     club_members.teams[]). Correspondance exacte après trim() uniquement.
insert into club_teams (club_id, nom)
select distinct club_id, trim(team)
from club_bookings
where team is not null and trim(team) <> ''
on conflict (club_id, nom) do nothing;

insert into club_teams (club_id, nom)
select distinct club_id, trim(team)
from club_matches
where team is not null and trim(team) <> ''
on conflict (club_id, nom) do nothing;

insert into club_teams (club_id, nom)
select distinct cm.club_id, trim(elem.value)
from club_members cm
cross join lateral jsonb_array_elements_text(coalesce(cm.teams, '[]'::jsonb)) as elem(value)
where jsonb_typeof(coalesce(cm.teams, '[]'::jsonb)) = 'array'
  and trim(elem.value) <> ''
on conflict (club_id, nom) do nothing;

-- 1b. Rattache team_id sur club_bookings / club_matches par correspondance
--     exacte (club_id, trim(team) = club_teams.nom).
update club_bookings b
set team_id = t.id
from club_teams t
where b.team_id is null
  and b.team is not null and trim(b.team) <> ''
  and t.club_id = b.club_id and t.nom = trim(b.team);

update club_matches m
set team_id = t.id
from club_teams t
where m.team_id is null
  and m.team is not null and trim(m.team) <> ''
  and t.club_id = m.club_id and t.nom = trim(m.team);

-- 1c. Rattache club_member_teams à partir de club_members.teams[] (même
--     correspondance exacte). Idempotent via la PK composite.
insert into club_member_teams (member_id, team_id)
select cm.id, t.id
from club_members cm
cross join lateral jsonb_array_elements_text(coalesce(cm.teams, '[]'::jsonb)) as elem(value)
join club_teams t on t.club_id = cm.club_id and t.nom = trim(elem.value)
where jsonb_typeof(coalesce(cm.teams, '[]'::jsonb)) = 'array'
  and trim(elem.value) <> ''
on conflict (member_id, team_id) do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- 2. RLS équipe-level réelle
-- ────────────────────────────────────────────────────────────────────────

-- SECURITY DEFINER, même précaution anti-récursion que is_club_member /
-- is_club_admin (migration-clubplus-v1/v2.sql) : interroge club_members et
-- club_member_teams, jamais une table protégée par une policy qui
-- réutiliserait cette fonction.
--
-- Vrai : l'appelant est membre actif du club SANS scope équipe (accès
-- organisation entière — Admin, Président, CM, etc. : aucune ligne dans
-- club_member_teams pour lui), OU il est explicitement assigné à
-- p_team_id via club_member_teams. p_team_id NULL => seule la première
-- branche peut être vraie (accès organisation entière uniquement).
create or replace function is_club_team_scoped_member(p_club_id uuid, p_team_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from club_members cm
    where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and not exists (select 1 from club_member_teams cmt where cmt.member_id = cm.id)
  )
  or (
    p_team_id is not null and exists (
      select 1 from club_members cm
      join club_member_teams cmt on cmt.member_id = cm.id
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'actif'
        and cmt.team_id = p_team_id
    )
  );
$$;

-- ── club_bookings : select + insert (le pipeline lui-même reste piloté
--    par is_club_admin/le staff, inchangé — cbk_admin_update, cbk_admin_
--    delete, cbk_staff_select, cbk_staff_update ne bougent pas). ──

drop policy if exists "cbk_member_select" on club_bookings;
create policy "cbk_member_select" on club_bookings for select using (
  is_club_member(club_id) and (team_id is null or is_club_team_scoped_member(club_id, team_id))
);

drop policy if exists "cbk_member_insert" on club_bookings;
create policy "cbk_member_insert" on club_bookings for insert with check (
  is_club_member(club_id) and (team_id is null or is_club_team_scoped_member(club_id, team_id))
);

-- ── club_matches : select + insert + update (cma_member_update est le
--    chemin de saisie de résultat par le coach — c'est le cas d'usage exact
--    du finding de sécurité, un coach scoped ne doit pouvoir ni lire ni
--    écrire un match d'une autre équipe. cma_admin_delete reste admin-only,
--    inchangé). ──

drop policy if exists "cma_member_select" on club_matches;
create policy "cma_member_select" on club_matches for select using (
  is_club_member(club_id) and (team_id is null or is_club_team_scoped_member(club_id, team_id))
);

drop policy if exists "cma_member_insert" on club_matches;
create policy "cma_member_insert" on club_matches for insert with check (
  is_club_member(club_id) and (team_id is null or is_club_team_scoped_member(club_id, team_id))
);

drop policy if exists "cma_member_update" on club_matches;
create policy "cma_member_update" on club_matches for update using (
  is_club_member(club_id) and (team_id is null or is_club_team_scoped_member(club_id, team_id))
);

-- ── club_requests / club_media / club_creations : PAS de team_id, PAS de
--    RLS équipe-level dans cette migration. Les 3 ont bien une colonne
--    `team` texte libre (facultative), mais aucune n'est un objet
--    systématiquement lié à une équipe précise :
--      - club_requests.team  : une demande peut concerner un sponsor, un
--        document, une info structure entière — le champ existe pour les
--        cas où c'est pertinent, pas pour tous les cas.
--      - club_media.team / club_creations.team : idem, une bonne partie du
--        contenu (logo club, affiche générale, sponsor) n'est d'aucune
--        équipe en particulier.
--    Forcer une frontière RLS équipe-level dessus masquerait par erreur des
--    objets légitimement organisation-wide à un coach scoped. Décision :
--    laissés inchangés (is_club_member(club_id) reste la seule frontière).
--    À revisiter si un jour ces objets deviennent systématiquement liés à
--    une équipe (hors périmètre de ce chantier).
-- ────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────
-- 3. Statuts manquants
-- ────────────────────────────────────────────────────────────────────────

-- club_bookings.status : ajoute 'annulee' (cancel_request est une
-- permission de base, §5/§16, mais le statut manquait à la contrainte).
alter table club_bookings drop constraint if exists club_bookings_status_check;
alter table club_bookings add constraint club_bookings_status_check check (status in (
  'recue','qualifiee','confirmee','operateur_affecte','mission_realisee','livree','annulee'
));

-- club_matches.status : ajoute 'reportee' et 'annulee' (§8/§18 : "Statut :
-- terminé, reporté, annulé") + verified_by/verified_at pour le futur
-- workflow de vérification Directeur sportif (§8 — optionnel selon
-- requires_result_verification, non implémenté ici, colonnes seulement).
alter table club_matches drop constraint if exists club_matches_status_check;
alter table club_matches add constraint club_matches_status_check check (status in (
  'a_venir','a_transmettre','recu','reportee','annulee'
));

alter table club_matches add column if not exists verified_by uuid references auth.users on delete set null;
alter table club_matches add column if not exists verified_at timestamptz;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Lien club_requests <-> contenus
-- ────────────────────────────────────────────────────────────────────────

-- Nullable : un contenu peut exister sans venir d'une demande explicite
-- (ex. contenu spontané SportVision, ou contenu produit hors tout brief
-- club formalisé). Pas de nouvelle UI dans ce chantier — seulement la
-- colonne, exploitable plus tard sans nouvelle migration.
alter table contenus add column if not exists request_id uuid references club_requests(id) on delete set null;

create index if not exists idx_contenus_request on contenus(request_id);

-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- select count(*) from club_teams;                    -- probablement 0 aujourd'hui
-- select count(*) from club_member_teams;              -- probablement 0 aujourd'hui
-- select count(*) from club_bookings where team_id is not null;  -- probablement 0
-- select count(*) from club_matches where team_id is not null;   -- probablement 0
--
-- select policyname, cmd, qual from pg_policies
-- where tablename in ('club_bookings','club_matches') order by tablename, cmd;
--
-- Puis, avec un compte club existant (role='admin', teamScope vide) :
-- vérifier que /services et /matchcenter affichent toujours exactement les
-- mêmes lignes qu'avant cette migration (aucune régression, team_id étant
-- NULL partout, is_club_team_scoped_member() n'entre jamais en jeu pour
-- les données actuelles).
-- ============================================================
