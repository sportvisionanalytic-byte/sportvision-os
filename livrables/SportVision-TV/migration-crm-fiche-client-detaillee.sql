-- ============================================================================
-- migration-crm-fiche-client-detaillee.sql
-- ============================================================================
-- Suite du plan de simplification CRM (22/08/2026, demande Fouka) : après la
-- colonne Offre (3 catégories) et la fiche client centrale (frise + onglet
-- Contrats), Fouka veut une "vraie fiche client" — logo, adresse complète
-- déjà en base mais jamais affichée dans le formulaire d'édition, et un
-- organigramme (qui fait quoi dans le club : président, trésorier, coach
-- référent...), qui n'existait sous aucune forme jusqu'ici. client_contacts
-- est un journal d'interactions (appels/emails), pas un annuaire de
-- personnes — nouvelle table dédiée, même patron RLS que client_contacts.
-- ============================================================================

alter table clients add column if not exists logo_url text;

create table if not exists client_organigramme (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  role text not null,
  prenom text,
  nom text,
  email text,
  telephone text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table client_organigramme enable row level security;

create policy "corg_read" on client_organigramme for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com'])));

create policy "corg_write" on client_organigramme for all
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com'])));

-- Réutilise le bucket public existant club-logos (déjà utilisé par Club+ pour
-- les logos de club) plutôt que d'en créer un nouveau — même règle store
-- pour toute image de logo dans l'écosystème SportVision. Chemin dédié
-- clients/<client_id>-<timestamp>.<ext> pour ne jamais entrer en collision
-- avec les logos déjà uploadés côté Club+ (clubs/<club_id>...).
create policy "club_logos_clients_insert" on storage.objects for insert
  with check (
    bucket_id = 'club-logos'
    and (storage.foldername(name))[1] = 'clients'
    and exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','sec','com']))
  );
