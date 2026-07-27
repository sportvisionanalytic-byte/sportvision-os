-- Migration : Centre Médias & Postproduction — SportVision OS
-- À exécuter dans Supabase → SQL Editor

-- 1. Liens médias (table centrale — aucun fichier stocké, uniquement des URLs)
create table if not exists media_liens (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id) on delete cascade,
  nom text not null,
  url text not null,
  categorie text check (categorie in ('depot','rushs','travail','previsualisation','final','livraison','bibliotheque')) default 'rushs',
  type_media text check (type_media in ('photo','video','audio','drone','veo','graphisme','canva','document','mixte','autre')) default 'mixte',
  fournisseur text default 'autre',
  statut text check (statut in ('a_verifier','valide','acces_limite','autorisation_requise','mdp_requis','expirant','expire','inaccessible','remplace','archive')) default 'a_verifier',
  ajouteur_id uuid references profiles(id) on delete set null,
  responsable_id uuid references profiles(id) on delete set null,
  date_expiration timestamptz,
  mot_de_passe_enc text,                          -- mot de passe chiffré (base64 simple, suffisant pour usage interne)
  confidentialite text check (confidentialite in ('public','interne','restreint','confidentiel')) default 'interne',
  nombre_fichiers integer,
  poids_approx text,
  appareil text,
  nom_dossier text,
  organisation_dossier text,
  presence_audio boolean default false,
  presence_drone boolean default false,
  fichiers_manquants text,
  transfert_confirme boolean default false,
  transfert_confirme_at timestamptz,
  commentaire text,
  prochaine_action text,
  delai_action timestamptz,
  remplace_par_id uuid references media_liens(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table media_liens enable row level security;
create policy "ml_read" on media_liens for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "ml_write" on media_liens for all using (
  exists (select 1 from profiles where id = auth.uid())
);

-- 2. Postproductions
create table if not exists media_postproductions (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id) on delete cascade,
  responsable_id uuid references profiles(id) on delete set null,
  type_travail text check (type_travail in ('selection_photo','retouche_photo','montage_video','highlight','aftermovie','interview','tiktok','reel','teaser','bande_annonce','graphisme','miniature','carrousel','autre')) default 'montage_video',
  brief text,
  format_attendu text,
  duree_attendue text,
  plateforme text,
  resolution text,
  orientation text check (orientation in ('horizontal','vertical','carre','autre')) default 'horizontal',
  musique text,
  sous_titres boolean default false,
  elements_graphiques text,
  delai timestamptz,
  nb_versions_autorisees integer default 3,
  nb_corrections_autorisees integer default 5,
  priorite text check (priorite in ('basse','normale','haute','urgente')) default 'normale',
  statut text check (statut in (
    'a_attribuer','attribuee','a_commencer','en_cours','en_attente_elements',
    'premiere_version_prep','version_prete','a_valider_interne','corrections_demandees',
    'corrections_en_cours','prete_nouvelle_validation','validee_interne',
    'a_valider_client','validee_client','prete_a_livrer','livree','archivee','annulee'
  )) default 'a_attribuer',
  validation_client_requise boolean default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table media_postproductions enable row level security;
create policy "mp_read" on media_postproductions for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "mp_write" on media_postproductions for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

-- 3. Versions
create table if not exists media_versions (
  id uuid default gen_random_uuid() primary key,
  postproduction_id uuid references media_postproductions(id) on delete cascade,
  prestation_id uuid references prestations(id) on delete cascade,
  numero integer not null,
  nom text,
  lien_id uuid references media_liens(id) on delete set null,
  auteur_id uuid references profiles(id) on delete set null,
  statut text check (statut in ('brouillon','soumise','a_valider','validee','corrections_demandees','remplacee','finale','archivee')) default 'soumise',
  validateur_id uuid references profiles(id) on delete set null,
  date_limite_validation timestamptz,
  commentaire text,
  version_precedente_id uuid references media_versions(id) on delete set null,
  created_at timestamptz default now()
);

alter table media_versions enable row level security;
create policy "mv_read" on media_versions for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "mv_write" on media_versions for all using (
  exists (select 1 from profiles where id = auth.uid())
);

-- 4. Corrections
create table if not exists media_corrections (
  id uuid default gen_random_uuid() primary key,
  version_id uuid references media_versions(id) on delete cascade,
  postproduction_id uuid references media_postproductions(id) on delete cascade,
  auteur_id uuid references profiles(id) on delete set null,
  priorite text check (priorite in ('faible','normale','haute','urgente')) default 'normale',
  type_correction text check (type_correction in ('image','cadrage','son','texte','orthographe','logo','sponsor','couleur','musique','duree','transition','sous_titre','export','autre')) default 'autre',
  description text not null,
  timecode text,
  lien_capture text,
  responsable_id uuid references profiles(id) on delete set null,
  statut text check (statut in ('nouvelle','a_traiter','en_cours','terminee','a_verifier','validee','refusee','annulee')) default 'nouvelle',
  date_limite timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table media_corrections enable row level security;
create policy "mc_read" on media_corrections for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "mc_write" on media_corrections for all using (
  exists (select 1 from profiles where id = auth.uid())
);

-- 5. Validations
create table if not exists media_validations (
  id uuid default gen_random_uuid() primary key,
  cible_type text check (cible_type in ('rushs','version','livrable')),
  cible_id uuid not null,
  prestation_id uuid references prestations(id) on delete cascade,
  validateur_id uuid references profiles(id) on delete set null,
  type_validation text check (type_validation in ('interne','client')) default 'interne',
  resultat text check (resultat in ('valide','valide_avec_reserve','corrections_requises','refuse')),
  criteres jsonb default '{}',
  commentaire text,
  preuve text,
  created_at timestamptz default now()
);

alter table media_validations enable row level security;
create policy "mval_read" on media_validations for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "mval_write" on media_validations for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

-- 6. Livrables finaux
create table if not exists media_livrables (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id) on delete cascade,
  nom text not null,
  type_livrable text check (type_livrable in ('galerie_photo','photos_finales','video_finale','highlight','aftermovie','interview','reels','tiktok','story','affiche','carrousel','miniature','dossier_complet','autre')) default 'dossier_complet',
  version_id uuid references media_versions(id) on delete set null,
  lien_id uuid references media_liens(id) on delete set null,
  format text,
  duree text,
  nb_fichiers integer,
  date_validation timestamptz,
  validateur_id uuid references profiles(id) on delete set null,
  date_expiration timestamptz,
  instructions text,
  statut text check (statut in ('a_preparer','en_preparation','a_valider','valide','pret_a_livrer','livre','consulte','lien_expirant','lien_expire','remplace','archive')) default 'a_preparer',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table media_livrables enable row level security;
create policy "mlivr_read" on media_livrables for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "mlivr_write" on media_livrables for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod','sec'))
);

-- 7. Livraisons client
create table if not exists media_livraisons (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id) on delete cascade,
  destinataire_nom text,
  destinataire_email text,
  livrables_ids uuid[] default '{}',
  message text,
  expediteur_id uuid references profiles(id) on delete set null,
  date_envoi timestamptz,
  moyen_envoi text check (moyen_envoi in ('email','portail','messagerie','manuel')) default 'email',
  statut text check (statut in ('en_preparation','envoyee','confirmee','en_attente','echec')) default 'en_preparation',
  confirmation_client_at timestamptz,
  confirmation_par text,
  preuve_confirmation text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table media_livraisons enable row level security;
create policy "mliv_read" on media_livraisons for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "mliv_write" on media_livraisons for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod','sec'))
);

-- 8. Historique
create table if not exists media_historique (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id) on delete cascade,
  auteur_id uuid references profiles(id) on delete set null,
  action text not null,
  cible_type text,
  cible_id uuid,
  ancienne_valeur text,
  nouvelle_valeur text,
  commentaire text,
  created_at timestamptz default now()
);

alter table media_historique enable row level security;
create policy "mhist_read" on media_historique for select using (
  exists (select 1 from profiles where id = auth.uid())
);
create policy "mhist_insert" on media_historique for insert with check (
  exists (select 1 from profiles where id = auth.uid())
);

-- 9. Bibliothèque partagée
create table if not exists media_bibliotheque (
  id uuid default gen_random_uuid() primary key,
  nom text not null,
  url text not null,
  categorie text check (categorie in ('logo','charte','sponsor','musique','template_canva','archive','guide','autre')) default 'autre',
  type_media text default 'document',
  fournisseur text default 'autre',
  description text,
  acces_roles text[] default '{admin,prod,photo,cm,sec}',
  ajouteur_id uuid references profiles(id) on delete set null,
  date_expiration timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table media_bibliotheque enable row level security;
create policy "mbib_read" on media_bibliotheque for select using (
  exists (
    select 1 from profiles p where p.id = auth.uid()
    and (p.role = any(acces_roles) or p.role = 'admin')
  )
);
create policy "mbib_write" on media_bibliotheque for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

-- 10. Index
create index if not exists idx_ml_prestation on media_liens(prestation_id, statut);
create index if not exists idx_ml_ajouteur on media_liens(ajouteur_id);
create index if not exists idx_ml_expiration on media_liens(date_expiration) where date_expiration is not null;
create index if not exists idx_mp_prestation on media_postproductions(prestation_id, statut);
create index if not exists idx_mp_responsable on media_postproductions(responsable_id, statut);
create index if not exists idx_mv_postprod on media_versions(postproduction_id, statut);
create index if not exists idx_mc_version on media_corrections(version_id, statut);
create index if not exists idx_mlivr_prestation on media_livrables(prestation_id, statut);
create index if not exists idx_mliv_prestation on media_livraisons(prestation_id, statut);
create index if not exists idx_mhist_prestation on media_historique(prestation_id, created_at desc);

-- 11. Triggers updated_at
create or replace function update_updated_at_generic()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_ml_upd on media_liens;
create trigger trg_ml_upd before update on media_liens
  for each row execute procedure update_updated_at_generic();

drop trigger if exists trg_mp_upd on media_postproductions;
create trigger trg_mp_upd before update on media_postproductions
  for each row execute procedure update_updated_at_generic();

drop trigger if exists trg_mc_upd on media_corrections;
create trigger trg_mc_upd before update on media_corrections
  for each row execute procedure update_updated_at_generic();

drop trigger if exists trg_mlivr_upd on media_livrables;
create trigger trg_mlivr_upd before update on media_livrables
  for each row execute procedure update_updated_at_generic();

drop trigger if exists trg_mliv_upd on media_livraisons;
create trigger trg_mliv_upd before update on media_livraisons
  for each row execute procedure update_updated_at_generic();
