-- ============================================================
-- SPORTVISION CLUB+ — Migration v38
-- Suite de migration-clubplus-v1 à v37.sql. Idempotente.
--
-- Portée (chantier "Studio dynamique + Sponsors backend réel", 16/08/2026,
-- voir CLUB-PLUS-PRODUCT-BIBLE.md) :
--   1. studio_templates : catalogue des modèles visuels du Studio, sorti
--      du code (STUDIO_TEMPLATES, src/lib/mock/studio.ts) vers une vraie
--      table pilotable sans déploiement.
--   2. sponsor_operations : activations sponsor (prévue/réalisée), aucun
--      équivalent réel n'existait (mockSponsorOperations).
--   3. club_creations.sponsor_id : FK nullable vers club_sponsors, pour
--      un lien fiable contenu <-> sponsor (voir note § 3 ci-dessous).
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- studio_templates existe avec 47 lignes actives, sponsor_operations existe.
-- Cet en-tête disait à tort "NON EXÉCUTÉE" ; ne pas relancer cette migration
-- sur la base de cette mention obsolète.
-- ============================================================

-- ────────────────────────────────────────────────────────────────────────
-- Vérification des données réelles avant migration (16/08/2026, via curl
-- REST + SUPABASE_URL/SUPABASE_SECRET_KEY du .env racine, lecture seule) :
--   - Table `studio_templates`      : n'existe pas (absente de la liste
--     complète des tables retournée par /rest/v1/?select=* — vérifié en
--     direct, même erreur que celle qui avait cassé v37 évitée ici).
--   - Table `sponsor_operations`    : n'existe pas non plus.
--   - `club_sponsors`  : 0 ligne en prod.
--   - `club_creations` : 0 ligne en prod (donc aucun risque de backfill
--     ambigu sur le nouveau `sponsor_id` — colonne ajoutée directement
--     nullable, sans donnée existante à rapprocher).
--   - Dernier numéro de migration clubplus réellement présent dans
--     livrables/SportVision-TV/ au moment de l'écriture : v37. D'autres
--     agents travaillent en parallèle sur matchcenter/newsroom (numérotés
--     séparément, préfixe `connect-v*`, jusqu'à v77 au 16/08) — v38 choisi
--     ici pour rester dans la même série `clubplus-v*` sans collision.
-- ────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════
-- 1. STUDIO — studio_templates
-- ════════════════════════════════════════════════════════════════════════
--
-- Remplace STUDIO_TEMPLATES (src/lib/mock/studio.ts), catalogue figé de 47
-- modèles / 7 catégories. Colonnes reprises pour ne perdre aucune donnée
-- exploitée par studio/page.tsx et studio/[template]/page.tsx : code (slug
-- de route /studio/:code), name, category, credit_cost (1-3, coût en
-- crédits), delivery_delay (libellé affiché), image_url (aperçu — reprend
-- ici exactement le pattern `placeholder://studio/{code}` déjà utilisé
-- comme `previewUrl`, aucune vraie image n'existe encore côté design),
-- min_tier (palier minimum requis, littéral 2 pour tous les modèles
-- actuels dans le code — sorti en colonne pour permettre une variation
-- future sans redéploiement), active, display_order (ordre d'affichage —
-- reprend l'ordre du tableau STUDIO_TEMPLATES d'origine pour ne pas
-- changer la présentation visuelle lors du bascule).
--
-- `description` : colonne demandée par la consigne (catalogue "dynamique")
-- mais aucune description par modèle n'existe dans le code actuel — laissée
-- NULL pour tous les modèles plutôt que d'inventer un texte, cohérent avec
-- la convention du reste du projet (ne jamais combler une donnée absente
-- par une valeur affichée comme un fait). `formFields`/`prefilledFields`
-- (STUDIO_FIELD_LABELS, CATEGORY_FIELDS) restent des constantes de code
-- côté frontend : ce sont des règles de formulaire par CATÉGORIE (pas par
-- modèle), donc pas une donnée de catalogue au sens de cette table.
--
-- Modèle de référence pour la structure et les policies : `catalogue_offres`
-- (migration-portail-v1.sql, § 3), même famille de table "catalogue"
-- pilotée par le staff. Différence assumée : lecture restreinte aux
-- utilisateurs Club+ authentifiés (club_members OU memberships, voir plus
-- bas) plutôt que `actif = true` public, le Studio n'ayant pas vocation à
-- être exposé hors application.

create table if not exists studio_templates (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  name text not null,
  category text not null check (category in (
    'pre_match','match_day','post_match','players','club_life','sponsors','events'
  )),
  description text,
  image_url text,
  credit_cost smallint not null check (credit_cost in (1, 2, 3)),
  delivery_delay text not null check (delivery_delay in ('24 h', '48 h', '72 h')),
  min_tier smallint not null default 2,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_stpl_upd on studio_templates;
create trigger trg_stpl_upd before update on studio_templates
  for each row execute procedure update_updated_at_generic();

alter table studio_templates enable row level security;

-- Lecture : tout utilisateur Club+ authentifié et actif — le Studio est
-- utilisé par plusieurs types d'organisation (club, académie, coach,
-- sponsor, generic — voir studio/[template]/page.tsx § usesGenericRequestsTable),
-- pas seulement par les clubs au sens strict de `club_members`. Les deux
-- systèmes d'appartenance coexistent aujourd'hui dans ce projet
-- (club_members/is_club_member pour le type "club" historique,
-- memberships/is_org_member pour les types plus récents — voir
-- migration-connect-v2-organizations-entitlements.sql § "Fusion cible" :
-- memberships ne remplace pas encore club_members). D'où l'OR ci-dessous
-- plutôt qu'une seule des deux tables.
drop policy if exists "stpl_authenticated_read" on studio_templates;
create policy "stpl_authenticated_read" on studio_templates for select using (
  active = true and (
    exists (select 1 from club_members where user_id = auth.uid() and status = 'actif')
    or exists (select 1 from memberships where user_id = auth.uid() and status = 'actif')
  )
);

-- Écriture : staff SportVision uniquement. `is_staff()` (fonction partagée
-- créée par migration-connect-v2-organizations-entitlements.sql : simple
-- appartenance à `profiles`, sans distinction de rôle) réutilisée plutôt
-- que redéfinie — c'est la fonction pensée pour ce type de contrôle
-- générique "staff vs client", et elle existe déjà sur ce projet.
drop policy if exists "stpl_staff_all" on studio_templates;
create policy "stpl_staff_all" on studio_templates for all using (is_staff());

create index if not exists idx_stpl_category on studio_templates(category, active, display_order);

-- ── Seed idempotent — reprend exactement STUDIO_TEMPLATES (src/lib/mock/
--    studio.ts), même ordre, mêmes 47 codes/noms/catégories/coûts. Délai
--    de livraison dérivé de la même règle que `tpl()` dans le code source
--    (1 crédit -> 24 h, 2 -> 48 h, 3 -> 72 h). `on conflict (code) do
--    nothing` : ne réécrase jamais une ligne déjà éditée manuellement par
--    le staff après un premier passage de cette migration. ──

insert into studio_templates (code, name, category, credit_cost, delivery_delay, image_url, min_tier, display_order)
values
  -- Avant-match (7)
  ('matchday', 'Matchday', 'pre_match', 3, '72 h', 'placeholder://studio/matchday', 2, 1),
  ('affiche-rencontre', 'Affiche de rencontre', 'pre_match', 3, '72 h', 'placeholder://studio/affiche-rencontre', 2, 2),
  ('convocation', 'Convocation', 'pre_match', 2, '48 h', 'placeholder://studio/convocation', 2, 3),
  ('groupe-convoque', 'Groupe convoqué', 'pre_match', 2, '48 h', 'placeholder://studio/groupe-convoque', 2, 4),
  ('programme-weekend', 'Programme du week-end', 'pre_match', 2, '48 h', 'placeholder://studio/programme-weekend', 2, 5),
  ('programme-mensuel', 'Programme mensuel', 'pre_match', 2, '48 h', 'placeholder://studio/programme-mensuel', 2, 6),
  ('annonce-deplacement', 'Annonce de déplacement', 'pre_match', 1, '24 h', 'placeholder://studio/annonce-deplacement', 2, 7),

  -- Jour de match (7)
  ('starting-xi', 'Starting XI', 'match_day', 2, '48 h', 'placeholder://studio/starting-xi', 2, 8),
  ('composition', 'Composition', 'match_day', 2, '48 h', 'placeholder://studio/composition', 2, 9),
  ('remplacants', 'Remplaçants', 'match_day', 1, '24 h', 'placeholder://studio/remplacants', 2, 10),
  ('coup-envoi', 'Coup d''envoi', 'match_day', 1, '24 h', 'placeholder://studio/coup-envoi', 2, 11),
  ('score-direct', 'Score en direct', 'match_day', 1, '24 h', 'placeholder://studio/score-direct', 2, 12),
  ('mi-temps', 'Mi-temps', 'match_day', 1, '24 h', 'placeholder://studio/mi-temps', 2, 13),
  ('buteur', 'Buteur', 'match_day', 1, '24 h', 'placeholder://studio/buteur', 2, 14),

  -- Après-match (7)
  ('resultat', 'Résultat', 'post_match', 1, '24 h', 'placeholder://studio/resultat', 2, 15),
  ('victoire', 'Victoire', 'post_match', 1, '24 h', 'placeholder://studio/victoire', 2, 16),
  ('defaite', 'Défaite', 'post_match', 1, '24 h', 'placeholder://studio/defaite', 2, 17),
  ('match-nul', 'Match nul', 'post_match', 1, '24 h', 'placeholder://studio/match-nul', 2, 18),
  ('homme-du-match', 'Homme du match', 'post_match', 1, '24 h', 'placeholder://studio/homme-du-match', 2, 19),
  ('statistiques', 'Statistiques', 'post_match', 2, '48 h', 'placeholder://studio/statistiques', 2, 20),
  ('classement', 'Classement', 'post_match', 2, '48 h', 'placeholder://studio/classement', 2, 21),

  -- Joueurs (8)
  ('joueur-anniversaire', 'Anniversaire', 'players', 1, '24 h', 'placeholder://studio/joueur-anniversaire', 2, 22),
  ('signature', 'Signature', 'players', 2, '48 h', 'placeholder://studio/signature', 2, 23),
  ('prolongation', 'Prolongation', 'players', 2, '48 h', 'placeholder://studio/prolongation', 2, 24),
  ('nouvelle-recrue', 'Nouvelle recrue', 'players', 3, '72 h', 'placeholder://studio/nouvelle-recrue', 2, 25),
  ('joueur-presentation', 'Présentation', 'players', 3, '72 h', 'placeholder://studio/joueur-presentation', 2, 26),
  ('depart', 'Départ', 'players', 2, '48 h', 'placeholder://studio/depart', 2, 27),
  ('selection', 'Sélection', 'players', 2, '48 h', 'placeholder://studio/selection', 2, 28),
  ('recompense', 'Récompense', 'players', 2, '48 h', 'placeholder://studio/recompense', 2, 29),

  -- Vie du club (7)
  ('communique', 'Communiqué', 'club_life', 3, '72 h', 'placeholder://studio/communique', 2, 30),
  ('recrutement-joueurs', 'Recrutement joueurs', 'club_life', 2, '48 h', 'placeholder://studio/recrutement-joueurs', 2, 31),
  ('detection', 'Détection', 'club_life', 2, '48 h', 'placeholder://studio/detection', 2, 32),
  ('stage', 'Stage', 'club_life', 2, '48 h', 'placeholder://studio/stage', 2, 33),
  ('horaires', 'Horaires', 'club_life', 1, '24 h', 'placeholder://studio/horaires', 2, 34),
  ('portes-ouvertes', 'Portes ouvertes', 'club_life', 2, '48 h', 'placeholder://studio/portes-ouvertes', 2, 35),
  ('recrutement-educateurs', 'Recrutement éducateurs', 'club_life', 2, '48 h', 'placeholder://studio/recrutement-educateurs', 2, 36),

  -- Sponsors (6)
  ('nouveau-partenaire', 'Nouveau partenaire', 'sponsors', 2, '48 h', 'placeholder://studio/nouveau-partenaire', 2, 37),
  ('sponsor-du-match', 'Sponsor du match', 'sponsors', 2, '48 h', 'placeholder://studio/sponsor-du-match', 2, 38),
  ('sponsor-presentation', 'Présentation', 'sponsors', 1, '24 h', 'placeholder://studio/sponsor-presentation', 2, 39),
  ('remerciement', 'Remerciement', 'sponsors', 1, '24 h', 'placeholder://studio/remerciement', 2, 40),
  ('offre-sponsor', 'Offre', 'sponsors', 2, '48 h', 'placeholder://studio/offre-sponsor', 2, 41),
  ('anniversaire-partenariat', 'Anniversaire de partenariat', 'sponsors', 2, '48 h', 'placeholder://studio/anniversaire-partenariat', 2, 42),

  -- Événements (5)
  ('tournoi', 'Tournoi', 'events', 3, '72 h', 'placeholder://studio/tournoi', 2, 43),
  ('loto', 'Loto', 'events', 2, '48 h', 'placeholder://studio/loto', 2, 44),
  ('soiree-du-club', 'Soirée du club', 'events', 3, '72 h', 'placeholder://studio/soiree-du-club', 2, 45),
  ('soiree-partenaires', 'Soirée partenaires', 'events', 2, '48 h', 'placeholder://studio/soiree-partenaires', 2, 46),
  ('remise-trophees', 'Remise de trophées', 'events', 3, '72 h', 'placeholder://studio/remise-trophees', 2, 47)
on conflict (code) do nothing;


-- ════════════════════════════════════════════════════════════════════════
-- 2. SPONSORS — sponsor_operations (activations)
-- ════════════════════════════════════════════════════════════════════════
--
-- Aucun équivalent réel n'existait pour SponsorOperation (mockSponsorOperations,
-- src/lib/mock/sponsors.ts) : "activation prévue ou réalisée" — stand au
-- stade, remise de maillots floqués, tirage au sort mi-temps, etc.
-- Confirmé en relisant lib/types/sponsors.ts (commentaire de SponsorOperation :
-- « onglet Livrables / espace partenaire "Opérations" ») : ce sont des
-- interventions ORGANISÉES PAR SportVision pour le compte du sponsor, pas
-- des actions que le club ou le sponsor déclenchent eux-mêmes depuis
-- Club+ — d'où l'écriture strictement staff (is_staff()), lecture élargie
-- au club propriétaire du partenariat ET au sponsor lui-même s'il a un
-- espace (organizations.sponsor_organization_id, même mécanique que
-- csp_sponsor_org_select sur club_sponsors, migration-connect-v4-sponsor.sql).

create table if not exists sponsor_operations (
  id uuid default gen_random_uuid() primary key,
  sponsor_id uuid references club_sponsors(id) on delete cascade not null,
  label text not null,
  date date not null,
  status text not null check (status in ('prevue', 'realisee')) default 'prevue',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_sop_upd on sponsor_operations;
create trigger trg_sop_upd before update on sponsor_operations
  for each row execute procedure update_updated_at_generic();

alter table sponsor_operations enable row level security;

drop policy if exists "sop_club_member_select" on sponsor_operations;
create policy "sop_club_member_select" on sponsor_operations for select using (
  exists (
    select 1 from club_sponsors cs
    where cs.id = sponsor_operations.sponsor_id and is_club_member(cs.club_id)
  )
);

drop policy if exists "sop_sponsor_org_select" on sponsor_operations;
create policy "sop_sponsor_org_select" on sponsor_operations for select using (
  exists (
    select 1 from club_sponsors cs
    where cs.id = sponsor_operations.sponsor_id
      and cs.sponsor_organization_id is not null
      and is_org_member(cs.sponsor_organization_id)
  )
);

drop policy if exists "sop_staff_all" on sponsor_operations;
create policy "sop_staff_all" on sponsor_operations for all using (is_staff());

create index if not exists idx_sop_sponsor on sponsor_operations(sponsor_id, date desc);


-- ════════════════════════════════════════════════════════════════════════
-- 3. SPONSORS — lien fiable club_creations <-> club_sponsors (Publications)
-- ════════════════════════════════════════════════════════════════════════
--
-- SponsorPublication (mockSponsorPublications) modélise « une publication
-- où le logo du sponsor apparaît ». La vraie table de contenus de Club+
-- ("Mes contenus", voir src/lib/data/club/content.ts) est `club_creations`
-- (migration-clubplus-v8.sql) — PAS `contenus` (celle-ci appartient au
-- planning éditorial CM de SportVision Connect, interrogée par client_id,
-- quasi vide en prod à ce jour, et sans rapport avec le module Club+
-- "Mes contenus" scoping par club_id — vérifié en lisant studio/[template],
-- content.ts et communication/page.tsx : deux tables et deux modules
-- distincts malgré la ressemblance de nom).
--
-- `club_creations.sponsor` existe déjà mais c'est un texte libre («conservé
-- tel quel pour l'affichage/rétrocompatibilité», voir le commentaire de
-- migration-connect-v4-sponsor.sql § 2) : un rapprochement par égalité de
-- texte avec `club_sponsors.name` serait fragile (casse, renommage,
-- accents) — exactement le cas que la consigne de ce chantier demande de
-- ne PAS forcer. Plutôt que d'improviser ce rapprochement, on ajoute la
-- vraie FK qui manquait, sur le même principe que `contenus.request_id`
-- (migration-clubplus-v37.sql) : nullable, non backfillée (0 ligne
-- `club_creations` en prod au 16/08/2026, donc aucune ambiguïté possible),
-- exploitable par une UI ultérieure de tag sponsor sur un contenu.
--
-- `club_creations.sponsor_organization_id` (déjà ajoutée par
-- migration-connect-v4-sponsor.sql) reste le bon lien pour la vue AGRÉGÉE
-- du sponsor sur son propre espace (toutes ses publications, tous clubs
-- confondus) — `sponsor_id` ci-dessous sert la vue PAR PARTENARIAT côté
-- club (un seul club_sponsors.id), les deux colonnes sont complémentaires,
-- pas redondantes.

alter table club_creations add column if not exists sponsor_id uuid references club_sponsors(id) on delete set null;

create index if not exists idx_ccr_sponsor on club_creations(sponsor_id);

-- Aucune nouvelle policy nécessaire : ccr_member_select (is_club_member)
-- et ccr_sponsor_org_select (is_org_member via sponsor_organization_id)
-- couvrent déjà la lecture de cette colonne supplémentaire.

-- ============================================================
-- VÉRIFICATION RECOMMANDÉE après exécution (à rejouer séparément) :
--
-- select count(*) from studio_templates;                 -- attendu 47
-- select category, count(*) from studio_templates group by category;
--   pre_match=7, match_day=7, post_match=7, players=8, club_life=7,
--   sponsors=6, events=5 (total 47)
--
-- select policyname, cmd from pg_policies
-- where tablename in ('studio_templates','sponsor_operations')
-- order by tablename, cmd;
--
-- select column_name from information_schema.columns
-- where table_name = 'club_creations' and column_name = 'sponsor_id';
--
-- Puis, avec un compte club existant : vérifier que /studio affiche
-- toujours 47 modèles dans les mêmes 7 catégories, et que /sponsors/:id
-- (onglet Publications) reste vide tant qu'aucun contenu n'a sponsor_id
-- renseigné (comportement honnête, pas une régression).
-- ============================================================
