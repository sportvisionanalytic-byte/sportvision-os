-- Migration : table d'affiliation multi-rôles client_affiliations.
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- `clients.cm_id` (migration-cm-tiers.sql) ne modélise qu'un seul CM par
-- client. Le besoin réel inclut : CM secondaire sur un client, accès
-- temporaire qui expire tout seul (palier CM Événement), et à terme
-- graphiste/photographe/vidéaste/Responsable Production visibles dans un
-- onglet Équipe. Cette migration ajoute une vraie table d'affiliation,
-- ADDITIVE — `clients.cm_id` reste en place comme colonne de commodité
-- ("CM principal"), synchronisée automatiquement par trigger. Aucun écran
-- déjà livré (loadCmClients, loadCmDash, loadCmCharge, _renderChargeEquipe,
-- assignerCmClient...) n'a besoin d'être retouché, ils continuent de lire
-- cm_id normalement.
--
-- La règle de visibilité par palier CM existait à deux endroits redondants :
-- en ligne dans clients_cm_select_acces/contrats_cm_select_acces
-- (migration-cm-tiers.sql), et factorisée dans contenus_visible_par_cm()
-- (migration-contenus.sql, utilisée par contenus_select/insert/update et
-- mc_cm_acces). Cette migration consolide les deux premières pour qu'elles
-- appellent la même fonction (DRY, un seul endroit à maintenir désormais),
-- et l'étend avec une clause d'affiliation valable pour TOUS les paliers
-- CM, en plus de leur règle par défaut : une ligne client_affiliations
-- active et non expirée donne accès quel que soit niveau_cm. Ça couvre à la
-- fois "CM secondaire" et "accès événement qui expire tout seul" (end_date)
-- sans dupliquer une troisième fois la logique par palier.
--
-- À exécuter APRÈS migration-cm-tiers.sql ET migration-contenus.sql
-- (redéfinit contenus_visible_par_cm, qui doit déjà exister).
--
-- Idempotente : DROP ... IF EXISTS avant chaque CREATE, peut être rejouée
-- sans effet de bord. Le backfill utilise ON CONFLICT DO NOTHING.

-- ─── 1. Table ────────────────────────────────────────────────────────────
create table if not exists client_affiliations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  user_id uuid references profiles(id) not null,
  role_on_client text not null check (role_on_client in (
    'cm_principal','cm_secondaire','lead_cm','graphiste','photographe',
    'videaste','responsable_production','administrateur'
  )),
  is_primary boolean not null default false,
  start_date date not null default current_date,
  end_date date,
  status text not null default 'actif' check (status in ('actif','expire','revoque')),
  created_at timestamptz not null default now(),
  unique(client_id, user_id, role_on_client)
);
create index if not exists idx_affil_client on client_affiliations(client_id);
create index if not exists idx_affil_user on client_affiliations(user_id);
alter table client_affiliations enable row level security;

-- ─── 2. Policies ─────────────────────────────────────────────────────────
-- Lecture : soi-même, un client déjà visible par ailleurs (onglet Équipe
-- de la fiche client), Lead CM ou admin.
drop policy if exists "affil_select" on client_affiliations;
create policy "affil_select" on client_affiliations for select using (
  user_id = auth.uid()
  or contenus_visible_par_cm(client_id, auth.uid())
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
  or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
-- Écriture : Lead CM ou admin uniquement (attribuer/retirer un client).
drop policy if exists "affil_write" on client_affiliations;
create policy "affil_write" on client_affiliations for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
  or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- ─── 3. Trigger : garde clients.cm_id synchronisé ("CM principal") ──────
-- Doit exister AVANT le backfill (étape 4) pour se déclencher dessus.
create or replace function sync_client_cm_principal()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP in ('INSERT','UPDATE') then
    if new.role_on_client = 'cm_principal' and new.is_primary and new.status = 'actif' then
      update clients set cm_id = new.user_id where id = new.client_id;
    end if;
  end if;
  if TG_OP in ('UPDATE','DELETE') then
    if (TG_OP = 'DELETE' and old.role_on_client = 'cm_principal' and old.is_primary and old.status = 'actif')
       or (TG_OP = 'UPDATE' and old.role_on_client = 'cm_principal' and old.is_primary and old.status = 'actif'
           and not (new.role_on_client = 'cm_principal' and new.is_primary and new.status = 'actif'))
    then
      if not exists (
        select 1 from client_affiliations
        where client_id = old.client_id and role_on_client = 'cm_principal' and is_primary and status = 'actif'
          and id <> old.id
      ) then
        update clients set cm_id = null where id = old.client_id and cm_id = old.user_id;
      end if;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_client_cm_principal on client_affiliations;
create trigger trg_sync_client_cm_principal
  after insert or update or delete on client_affiliations
  for each row execute function sync_client_cm_principal();

-- ─── 4. Backfill depuis clients.cm_id existant ──────────────────────────
-- Valeur reconduite à l'identique : le trigger ci-dessus ne modifiera donc
-- rien sur clients.cm_id (new.cm_id = old.cm_id), pas de conflit avec le
-- garde-fou protect_client_cm_assignment (qui ne réagit qu'aux vrais
-- changements de valeur).
insert into client_affiliations (client_id, user_id, role_on_client, is_primary, status)
select id, cm_id, 'cm_principal', true, 'actif' from clients where cm_id is not null
on conflict (client_id, user_id, role_on_client) do nothing;

-- ─── 5. Étend contenus_visible_par_cm (choke point unique) ──────────────
create or replace function contenus_visible_par_cm(p_client_id uuid, p_uid uuid)
returns boolean language sql stable security definer as $$
  select p_client_id is not null and (
    -- Seuls les rôles CM de l'affiliation donnent l'accès complet (contenus,
    -- messages_client...) que contrôle cette fonction. graphiste/photographe/
    -- videaste/responsable_production/administrateur dans client_affiliations
    -- restent purement informatifs (roster de l'onglet Équipe, via affil_select)
    -- et ne doivent pas hériter silencieusement des permissions CM.
    exists (
      select 1 from client_affiliations a, profiles p
      where a.client_id = p_client_id and a.user_id = p_uid and p.id = p_uid and p.role = 'cm'
        and a.role_on_client in ('cm_principal','cm_secondaire','lead_cm')
        and a.status = 'actif' and (a.end_date is null or a.end_date >= current_date)
    )
    or exists (
      select 1 from profiles p, clients cl
      where p.id = p_uid and cl.id = p_client_id and p.role = 'cm' and (
        (p.niveau_cm in ('cm_junior','cm_confirme','cm_full_communication') and cl.cm_id = p_uid)
        or (p.niveau_cm = 'cm_club_plus_studio' and exists (
          select 1 from contrats c where c.client_id = cl.id and c.type_contrat = 'club_plus' and c.statut = 'actif'
        ))
        or (p.niveau_cm = 'cm_evenement' and exists (
          select 1 from contrats c where c.client_id = cl.id and c.type_contrat = 'evenement' and c.statut = 'actif'
        ))
      )
    )
  );
$$;

-- ─── 6. clients_cm_select_acces / contrats_cm_select_acces : DRY ────────
-- Comportement identique à avant (même règles par palier) + la nouvelle
-- clause d'affiliation, sans dupliquer la logique une troisième fois.
drop policy if exists "clients_cm_select_acces" on clients;
create policy "clients_cm_select_acces" on clients for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
  or contenus_visible_par_cm(id, auth.uid())
);

drop policy if exists "contrats_cm_select_acces" on contrats;
create policy "contrats_cm_select_acces" on contrats for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
  or contenus_visible_par_cm(contrats.client_id, auth.uid())
);
