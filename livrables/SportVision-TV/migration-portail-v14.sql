-- ============================================================
-- SPORTVISION PORTAIL — Migration v14
-- Gestion des médias du Portail (photos/vidéos) depuis l'OS, réservée à
-- l'admin : bucket de stockage public en lecture, écriture réservée au rôle
-- admin, + table `realisations` pour la page publique "Réalisations".
-- catalogue_offres.image_url existe déjà depuis migration-portail-v1.sql
-- (colonne prévue mais jamais exploitée jusqu'ici) : cette migration ajoute
-- seulement le bucket de stockage qui permet de l'alimenter par upload.
-- Idempotente. À exécuter après migration-portail-v13.sql.
-- ============================================================

-- 1. Bucket de stockage public (lecture libre, écriture réservée à l'admin)
insert into storage.buckets (id, name, public)
values ('portail-media', 'portail-media', true)
on conflict (id) do nothing;

drop policy if exists "portail_media_public_read" on storage.objects;
create policy "portail_media_public_read" on storage.objects for select
  using (bucket_id = 'portail-media');

drop policy if exists "portail_media_admin_insert" on storage.objects;
create policy "portail_media_admin_insert" on storage.objects for insert
  with check (
    bucket_id = 'portail-media'
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "portail_media_admin_update" on storage.objects;
create policy "portail_media_admin_update" on storage.objects for update
  using (
    bucket_id = 'portail-media'
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

drop policy if exists "portail_media_admin_delete" on storage.objects;
create policy "portail_media_admin_delete" on storage.objects for delete
  using (
    bucket_id = 'portail-media'
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- 2. Galerie publique "Réalisations"
create table if not exists realisations (
  id uuid default gen_random_uuid() primary key,
  titre text not null,
  description text,
  type text check (type in ('photo','video')) not null default 'photo',
  media_url text not null,
  ordre integer default 0,
  actif boolean default true,
  created_at timestamptz default now()
);

alter table realisations enable row level security;

drop policy if exists "realisations_public_read" on realisations;
drop policy if exists "realisations_admin_write" on realisations;

create policy "realisations_public_read" on realisations for select using (actif = true);
create policy "realisations_admin_write" on realisations for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

create index if not exists idx_realisations_actif_ordre on realisations(actif, ordre);
