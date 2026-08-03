-- ============================================================
-- SPORTVISION PORTAIL — Migration v21
-- Avis clients : après livraison d'une prestation (statut 'livrée'), le
-- client peut laisser une note sur 5 étoiles, un commentaire écrit et/ou
-- une vidéo. Un seul avis par prestation (unique), modifiable par le staff
-- (masquer sans supprimer) mais jamais par un autre client.
-- Idempotente. À exécuter après migration-portail-v20.sql.
-- ============================================================

create table if not exists avis_clients (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id) on delete cascade not null,
  client_id uuid references clients(id) on delete cascade not null,
  note integer check (note between 1 and 5) not null,
  commentaire text,
  video_url text,
  statut text check (statut in ('visible','masque')) default 'visible',
  created_at timestamptz default now(),
  unique(prestation_id)
);

alter table avis_clients enable row level security;

drop policy if exists "avis_client_select" on avis_clients;
drop policy if exists "avis_client_insert" on avis_clients;
drop policy if exists "avis_staff_all" on avis_clients;

-- Le client voit ses propres avis ; le staff voit tout.
create policy "avis_client_select" on avis_clients for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = avis_clients.client_id)
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com'))
);

-- Le client ne peut créer un avis que sur SA prestation, une fois livrée.
create policy "avis_client_insert" on avis_clients for insert with check (
  exists (
    select 1 from prestations p
    join client_users cu on cu.client_id = p.client_id
    where p.id = avis_clients.prestation_id
      and cu.id = auth.uid()
      and cu.client_id = avis_clients.client_id
      and p.statut = 'livrée'
  )
);

-- Le staff peut tout gérer (notamment masquer un avis inapproprié).
create policy "avis_staff_all" on avis_clients for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com'))
);

create index if not exists idx_avis_clients_client on avis_clients(client_id);

-- Upload de vidéos d'avis par les clients connectés, dans le même bucket que
-- les médias du Portail (portail-media, déjà public en lecture — voir
-- migration-portail-v14.sql). Chemin attendu : avis/<prestation_id>/<fichier>.
-- La vérification fine (le client est bien propriétaire, prestation livrée)
-- est déjà faite par la policy d'insertion sur avis_clients ci-dessus ; côté
-- stockage on se contente de restreindre au préfixe "avis/" et aux comptes
-- clients authentifiés, pour éviter d'exposer une écriture libre du bucket.
drop policy if exists "portail_media_client_avis_insert" on storage.objects;
create policy "portail_media_client_avis_insert" on storage.objects for insert
  with check (
    bucket_id = 'portail-media'
    and (storage.foldername(name))[1] = 'avis'
    and exists (select 1 from client_users cu where cu.id = auth.uid())
  );
