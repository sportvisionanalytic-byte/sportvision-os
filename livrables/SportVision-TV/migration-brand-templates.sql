-- ============================================================================
-- migration-brand-templates.sql (03/09/2026)
-- ============================================================================
-- Quatrième pièce du Communication Hub : "le système doit connaître les templates par club sans
-- coder les clubs en dur — brand_templates liés à club_id." Audit confirmé : aucune notion de
-- template graphique n'existait (recherche "template"/"brand_template" vide dans tout le repo,
-- seulement la charte graphique comme contenu pédagogique du module Formation CM).
--
-- Un template = une RÉFÉRENCE (lien Canva/fichier/dossier), pas un fichier hébergé ici — cohérent
-- avec le reste du produit (Google Drive reste le stockage master des médias, voir commentaires
-- existants sur club_creations). Versionné (`version`) : archiver un ancien template au lieu de le
-- supprimer garde les contenus déjà créés cohérents avec ce qu'ils utilisaient réellement.

create table if not exists brand_templates (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  categorie text,
  nom text not null,
  asset_url text not null,
  version integer not null default 1,
  statut text not null default 'active' check (statut in ('active', 'archive')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_brand_templates_club on brand_templates(club_id);
create index if not exists idx_brand_templates_categorie on brand_templates(club_id, categorie) where statut = 'active';

comment on table brand_templates is 'Templates graphiques par club et catégorie éditoriale (référence externe, pas de fichier hébergé) — migration-brand-templates.sql, 03/09/2026. Gérés par le staff SportVision (CM), pas par le club (V1).';
comment on column brand_templates.categorie is 'Catégorie éditoriale ciblée (valeurs contenus.categorie, ex. "Matchday") — NULL = template générique utilisable pour toute catégorie.';

alter table brand_templates enable row level security;

-- V1 : gestion strictement staff (le CM prépare les templates), cohérent avec l'UI construite
-- (panneau dans modalNouveauContenu, OS uniquement). Une exposition lecture seule côté Club+
-- (le club consulte sans modifier) reste hors périmètre de cette migration, ajoutable plus tard
-- sans changement de schéma.
create policy "brand_templates_staff_all" on brand_templates for all using (is_staff()) with check (is_staff());

-- ============================================================================
-- VÉRIFICATION RECOMMANDÉE après exécution :
--
-- select count(*) from brand_templates; -- 0 attendu juste après
-- select policyname, cmd from pg_policies where tablename='brand_templates'; -- 1 ligne attendue
-- ============================================================================
