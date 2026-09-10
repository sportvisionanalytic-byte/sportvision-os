-- Préparer une personne sans lui créer de compte.
--
-- ── La règle posée par Fouka, 10/09/2026 ──
-- « Le CM ne crée pas un compte pour le coach/joueur/parent. Il crée l'accès potentiel et envoie
-- l'invitation. La personne prend possession de son compte elle-même. »
--
-- Ce n'est pas une préférence d'ergonomie. C'est ce qui permet au même compte SportVision d'être
-- demain coach d'une équipe, parent d'un enfant et acheteur Connect, sans fabriquer trois
-- identités. Un compte créé PAR le club serait un quatrième.
--
-- ── Pourquoi une table, et pas la réutilisation d'une existante ──
-- Trois candidates ont été regardées avant d'écrire une ligne :
--
--   `club_members`  — `user_id` est NOT NULL. Une personne préparée n'a, par définition, pas
--                     encore de compte : elle n'a pas sa place ici. Rendre la colonne nullable
--                     casserait toutes les policies qui comparent `user_id = auth.uid()`.
--   `player_invitations` / `parent_invitations` — existent, mais n'ont AUCUN jeton. Ce sont des
--                     traces (« on a écrit à cette adresse »), pas des liens. Elles ne peuvent
--                     donc pas porter un parcours d'activation, et rien n'y est encore écrit.
--   `team_invite_codes` — le bon outil pour un lien COLLECTIF réutilisable (§41). Un coach reçoit
--                     des droits d'administration sur son équipe : lui donner un code affichable
--                     au vestiaire serait exactement ce que Fouka refuse au §42.
--
-- D'où cette table : une invitation NOMINATIVE, portant son jeton, son périmètre et son état.
--
-- ── Ce que le jeton sait, et ce que l'URL ne dit pas (§14) ──
-- L'autorité vit ici, côté serveur : club, équipes, rôle. L'URL ne porte que le jeton. Un lien de
-- la forme `?club=...&role=coach` laisserait n'importe qui se nommer coach de n'importe quoi.

begin;

create table if not exists public.club_invitations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizations(id) on delete cascade,

  -- La personne, telle que le club la connaît. Aucun compte derrière, à ce stade.
  email text not null,
  prenom text,
  nom text,
  telephone text,

  -- Ce que l'invitation accorde. `teams` porte des NOMS d'équipes, comme `club_members.teams`,
  -- parce que c'est ce que lit `is_team_educateur` — s'en écarter ici obligerait à traduire au
  -- moment de l'acceptation, et une traduction est un endroit où se tromper.
  role text not null check (role in (
    'president', 'secretaire', 'comm', 'coach', 'resp_equipe',
    'sponsor_mgr', 'tresorier', 'membre_bureau', 'lecture_seule',
    'directeur_sportif', 'administratif'
  )),
  teams jsonb not null default '[]'::jsonb,

  -- Le jeton. 32 octets aléatoires : ni devinable, ni énumérable. Il ne remplace pas
  -- l'authentification — la personne devra bien se connecter ou créer son compte — il désigne
  -- seulement QUELLE invitation elle accepte.
  token text not null unique default encode(gen_random_bytes(32), 'hex'),

  statut text not null default 'preparee'
    check (statut in ('preparee', 'envoyee', 'acceptee', 'revoquee')),
  expire_at timestamptz not null default now() + interval '30 days',

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

-- Le rôle `admin` est absent de la contrainte ci-dessus, volontairement (§11) : le CM prépare des
-- encadrants et des dirigeants, il ne fabrique pas d'administrateur de club, et encore moins un
-- accès SportVision. `cm_externe` en est absent pour la même raison : un CM ne s'invite pas un
-- collègue par ce chemin.

-- Une seule invitation vivante par (club, adresse) : sans ça, trois clics du CM enverraient trois
-- liens, dont deux qui resteraient valides sans que personne ne sache les révoquer. Même défaut
-- que celui corrigé sur les codes d'équipe en v98.
create unique index if not exists club_invitations_vivante_uniq
  on public.club_invitations (club_id, lower(email))
  where statut in ('preparee', 'envoyee');

create index if not exists club_invitations_club_idx on public.club_invitations (club_id, statut);

alter table public.club_invitations enable row level security;

-- Lecture et écriture : qui opère le club (v99). Le CM affilié, le staff d'exploitation, les
-- administrateurs du club. Personne d'autre — et surtout pas l'invité, qui n'a rien à lire ici :
-- il passe par la RPC d'acceptation, qui ne lui rend que ce qui le concerne.
drop policy if exists ci_operateur_all on public.club_invitations;
create policy ci_operateur_all on public.club_invitations
  for all using (peut_operer_club(club_id)) with check (peut_operer_club(club_id));

commit;
