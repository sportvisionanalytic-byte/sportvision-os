-- v379 — LE CATALOGUE DE FORMATION N'EST NULLE PART EN BASE (01/10/2026)
--
-- ═══ LE PROBLÈME, DIT PAR FOUKA CE MATIN ═══════════════════════════════════════════════════════
--
-- « Le centre de formation ne fonctionne pas, je ne peux pas cliquer sur les trucs. On dirait des
-- captures d'écran posées, figées. »
--
-- Il a raison, et la cause est mesurable en une requête : le CONTENU du catalogue n'existe pas en
-- base. Mesuré le 01/10/2026 avant d'écrire une ligne :
--
--   · `to_regclass('public.formations')` → NULL. Idem `formation_modules`, `formation_lecons`.
--   · `formation_rewards` : 108 lignes. Elle connaît la CLÉ de chaque formation, son nombre de
--     leçons, son XP et sa certification. Elle ne connaît NI son titre, NI ses modules, NI ses
--     leçons.
--   · `formations_custom` : 1 ligne, `cert-photo-video-complet`, publiée depuis l'OS.
--   · Le reste vit dans `SportVision-OS-Full.html`, dans `FORMATIONS_CATALOG` : 108 formations,
--     761 modules, 1 956 leçons, dans une constante JavaScript.
--
-- Conséquence : l'application native n'a littéralement rien à ouvrir. Son propre fichier
-- `src/lib/os-formation.ts` porte un dictionnaire de 108 titres recopiés du HTML pour ne pas
-- afficher « cert-photo-video-complet » à un opérateur. Une deuxième copie, qui dérivera.
--
-- ═══ CE QUE FAIT CETTE MIGRATION ═══════════════════════════════════════════════════════════════
--
-- Trois tables, et une seule idée : la structure du catalogue descend en base, telle quelle.
--
--   `formations`        — une ligne par formation, la clé est celle de `formation_rewards`
--   `formation_modules` — une ligne par module, avec son RANG
--   `formation_lecons`  — une ligne par leçon, avec son RANG et sa `lecon_key`
--
-- ═══ CE QUE CES TABLES NE PORTENT PAS, ET POURQUOI ═════════════════════════════════════════════
--
-- NI XP, NI NOMBRE DE LEÇONS, NI CERTIFICATION. Ces trois-là sont des RÈGLES, elles vivent dans
-- `formation_rewards`, et elles DIVERGENT DÉJÀ du HTML. Mesuré : les 108 formations ont un XP
-- différent dans le HTML et en base — sv-culture 25 contre 10, cert-photo-video-complet 405 contre
-- 225. Ce n'est pas un bug : `migration-formation-v1-bareme-xp.sql` a divisé l'XP par 4 le
-- 09/09/2026 à la demande de Fouka (« ça donne trop d'XP »), en base seulement. C'est la base qui
-- est créditée par `rpc_complete_formation`. Recopier le nombre du HTML ici fabriquerait une
-- troisième vérité.
--
-- En revanche `total_lecons` de `formation_rewards` correspond EXACTEMENT au nombre de leçons du
-- HTML sur les 108 formations, sans une divergence. Le contrôle final de cette migration le
-- vérifie, et refuse de finir si ce n'est plus vrai.
--
-- ═══ `lecon_key` : LA CLÉ DE L'OS, PAS UNE NOUVELLE ════════════════════════════════════════════
--
-- `formation_progression` compte 1 319 leçons validées, repérées par `lecon_key`. Mesuré sur un
-- échantillon : « 14_5 », « 3_4 », « 0_2 » — c'est `<rang du module>_<rang de la leçon>`, les deux
-- à partir de zéro, exactement ce que l'OS écrit (`sbFetch('formation_progression', {lecon_key:
-- key})`). Cette colonne reprend cette clé, sans la réinventer : une leçon validée depuis
-- l'application doit être la même leçon que celle validée depuis l'OS, sinon les 1 319 lignes
-- existantes deviennent illisibles et `rpc_complete_formation` ne compte plus rien.
--
-- ═══ LA VISIBILITÉ EST PORTÉE PAR LA BASE, PAS PAR L'ÉCRAN ═════════════════════════════════════
--
-- L'OS décide qui voit quoi dans `_visibleFormations()` : trois formations communes, un `onlyRole`
-- sur 89 d'entre elles, et `FORMATION_ROLE_MAP` pour 19 autres. Mesuré en rejouant cette règle sur
-- les 108 : photo 36, prod 24, sec 20, cm 45, com 4, compta 3, admin 108. Aucune formation ne
-- tombe hors de la règle.
--
-- `formations.roles` porte ce résultat, et la policy de lecture l'applique. Le contrat de
-- l'application interdit de recopier dans un écran une borne que la base peut tenir (règle 3) :
-- deux copies d'une règle de visibilité, c'est un opérateur qui voit un jour le cursus du
-- secrétariat.
--
-- `grade_minimum` est différent : l'OS AFFICHE la formation verrouillée, avec « 🔒 Débloqué à
-- partir de ⭐⭐ ». Ce n'est donc pas un filtre de lecture, c'est un état. Il reste une colonne
-- lisible, et rien ne le filtre.
--
-- ═══ CE QUE ÇA NE CHANGE PAS ═══════════════════════════════════════════════════════════════════
--
-- RIEN DANS L'OS. Cette migration n'ajoute aucune ligne à `formations_custom`, la seule table que
-- l'OS lit pour son catalogue. `_mergeCustomFormations()` REMPLACE l'entrée du HTML par la ligne
-- de base (`FORMATIONS_CATALOG[idx]={...f}`), et une ligne de `formations_custom` n'a pas de
-- colonne `certification` : y verser les 108 ferait perdre à l'OS les 104 certifications qu'il
-- affiche aujourd'hui. On ne touche pas à cette table.
--
-- ═══ APRÈS APPLICATION ═════════════════════════════════════════════════════════════════════════
--
-- 1. Dans `SportVision-OS-App/src/lib/os-formation.ts`, supprimer le dictionnaire `TITRES`
--    (108 lignes) et lire `formations`.
-- 2. Dans `SportVision-OS-Full.html`, remplacer `FORMATIONS_CATALOG`, `FORMATION_ROLE_MAP`,
--    `_FORM_ROLE_REVERSE`, `_FORM_COMMON_IDS` et `_visibleFormations()` par une lecture de
--    `formations` / `formation_modules` / `formation_lecons`. NON FAIT ici, volontairement : le
--    HTML de l'OS n'est pas modifié par cette migration.

begin;

-- ── 1. Les formations ─────────────────────────────────────────────────────────────────────────

create table if not exists public.formations (
  -- La clé de `formation_rewards`, et la référence l'impose : on ne peut pas publier une formation
  -- que le serveur ne sait pas récompenser. C'est l'erreur exacte que lève
  -- `rpc_complete_formation` : « Formation inconnue côté serveur (formation_rewards non à jour) ».
  id             text primary key references public.formation_rewards(formation_id) on update cascade,
  titre          text not null,
  categorie      text,
  icone          text,
  niveau         text,
  -- « en_ligne » ou « hybride ». Le mot de l'OS, qui appelle ce champ `type`.
  type           text,
  duree          text,
  formateur      text,
  obligatoire    boolean not null default false,
  description    text,
  -- NULL = tout le personnel. Sinon la liste des rôles, résultat de `_visibleFormations()`.
  roles          text[],
  -- Le verrou d'étoiles de l'OS. Il ne cache pas la formation, il la montre verrouillée.
  grade_minimum  integer,
  publiee        boolean not null default true,
  ordre          integer not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.formations is
  'Le catalogue de formation. Le titre, la catégorie et la description vivent ici ; l''XP, le nombre de leçons et la certification restent dans formation_rewards (v379).';
comment on column public.formations.roles is
  'NULL = visible par tout le personnel. Sinon les rôles autorisés : la policy formations_lire l''applique, aucun écran ne refait ce filtre.';

create index if not exists idx_formations_ordre on public.formations (ordre);
create index if not exists idx_formations_categorie on public.formations (categorie);

-- ── 2. Les modules ────────────────────────────────────────────────────────────────────────────

create table if not exists public.formation_modules (
  id            uuid primary key default gen_random_uuid(),
  formation_id  text not null references public.formations(id) on delete cascade,
  -- À PARTIR DE ZÉRO : c'est le premier nombre de `lecon_key`. Un rang qui commencerait à 1
  -- décalerait les 1 319 lignes de `formation_progression` déjà en base.
  ordre         integer not null check (ordre >= 0),
  titre         text not null,
  created_at    timestamptz not null default now(),
  unique (formation_id, ordre)
);

create index if not exists idx_formation_modules_formation on public.formation_modules (formation_id, ordre);

-- ── 3. Les leçons ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.formation_lecons (
  id            uuid primary key default gen_random_uuid(),
  -- `formation_id` est redondant avec le module, et c'est voulu : un écran demande « les leçons de
  -- cette formation » en une requête, et `lecon_key` doit être unique DANS la formation, pas dans
  -- le module.
  formation_id  text not null references public.formations(id) on delete cascade,
  module_id     uuid not null references public.formation_modules(id) on delete cascade,
  ordre         integer not null check (ordre >= 0),
  titre         text not null,
  -- LA CLÉ DE L'OS, recopiée telle quelle : '<ordre du module>_<ordre de la leçon>'. C'est ce que
  -- `formation_progression.lecon_key` contient déjà sur 1 319 lignes.
  lecon_key     text not null,
  created_at    timestamptz not null default now(),
  unique (module_id, ordre),
  unique (formation_id, lecon_key)
);

comment on column public.formation_lecons.lecon_key is
  'La clé que formation_progression enregistre : <ordre du module>_<ordre de la leçon>, les deux à partir de zéro. Celle de l''OS, pas une nouvelle (v379).';

create index if not exists idx_formation_lecons_formation on public.formation_lecons (formation_id);

-- ── 4. Les droits ─────────────────────────────────────────────────────────────────────────────
--
-- LE PERSONNEL LIT, L'ADMINISTRATION ÉCRIT. Copié sur `formations_custom` (`fc_select is_staff()`,
-- écriture au seul rôle 'admin') pour que le catalogue et le catalogue publié depuis l'OS
-- obéissent à la même règle.
--
-- La policy `compte_os_desactive_bloque` est RESTRICTIVE, comme sur les treize autres tables du
-- module : un jeton encore valide dont le profil a été désactivé ne lit plus rien. Vérifié dans
-- `pg_policies` avant d'écrire : `permissive = 'RESTRICTIVE'`, sinon elle n'aurait rien bloqué du
-- tout puisqu'une policy permissive supplémentaire ne fait qu'élargir.

alter table public.formations enable row level security;
alter table public.formation_modules enable row level security;
alter table public.formation_lecons enable row level security;

drop policy if exists formations_lire on public.formations;
create policy formations_lire on public.formations
  for select using (
    is_staff()
    and publiee
    and (
      roles is null
      or (select p.role from public.profiles p where p.id = auth.uid()) = 'admin'
      or (select p.role from public.profiles p where p.id = auth.uid()) = any (roles)
    )
  );

drop policy if exists formations_administrer on public.formations;
create policy formations_administrer on public.formations
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists compte_os_desactive_bloque on public.formations;
create policy compte_os_desactive_bloque on public.formations
  as restrictive for all to authenticated
  using (not (select public.compte_os_desactive()))
  with check (not (select public.compte_os_desactive()));

-- Les modules et les leçons suivent leur formation, et rien d'autre : si la formation n'est pas
-- lisible, ses leçons ne le sont pas. Une seconde règle de visibilité écrite ici pourrait un jour
-- dire autre chose que la première.
drop policy if exists formation_modules_lire on public.formation_modules;
create policy formation_modules_lire on public.formation_modules
  for select using (exists (select 1 from public.formations f where f.id = formation_modules.formation_id));

drop policy if exists formation_modules_administrer on public.formation_modules;
create policy formation_modules_administrer on public.formation_modules
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists compte_os_desactive_bloque on public.formation_modules;
create policy compte_os_desactive_bloque on public.formation_modules
  as restrictive for all to authenticated
  using (not (select public.compte_os_desactive()))
  with check (not (select public.compte_os_desactive()));

drop policy if exists formation_lecons_lire on public.formation_lecons;
create policy formation_lecons_lire on public.formation_lecons
  for select using (exists (select 1 from public.formations f where f.id = formation_lecons.formation_id));

drop policy if exists formation_lecons_administrer on public.formation_lecons;
create policy formation_lecons_administrer on public.formation_lecons
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists compte_os_desactive_bloque on public.formation_lecons;
create policy compte_os_desactive_bloque on public.formation_lecons
  as restrictive for all to authenticated
  using (not (select public.compte_os_desactive()))
  with check (not (select public.compte_os_desactive()));

drop trigger if exists trg_formations_upd on public.formations;
create trigger trg_formations_upd before update on public.formations
  for each row execute function public.update_updated_at_generic();

commit;
