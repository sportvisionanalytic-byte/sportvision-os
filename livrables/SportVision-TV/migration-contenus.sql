-- Migration : vraie table `contenus` pour le rôle Community Manager,
-- remplace le détournement de `notifications` (type='contenu').
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- "Contenus"/"Publications" côté CM lisaient/écrivaient la table générique
-- notifications, avec les détails du contenu tassés dans un JSON (message),
-- sans client_id. Impossible de savoir pour quel client un contenu a été
-- produit, impossible de le scoper par portefeuille CM comme
-- migration-cm-tiers.sql l'a fait pour "Mes clients".
--
-- Cette table est volontairement séparée de `notifications` plutôt que d'y
-- ajouter une condition par type dans sa policy RLS existante
-- ("notifs_acces", supabase-schema-v2.sql) : cette policy gouverne aussi
-- les notifications type='tache', la retoucher aurait risqué de casser les
-- notifications de tâches existantes pour un bénéfice nul.
--
-- ─── Modèle de statut ────────────────────────────────────────────────────
-- brouillon → a_valider_interne → a_valider_client → valide → programme →
-- publie, avec une branche corrections (depuis a_valider_interne ou
-- a_valider_client, revient à brouillon) et archive en état terminal manuel
-- depuis publie. Pas de vrai Kanban drag-and-drop dans cette itération :
-- un tableau + bouton "étape suivante", même pattern que crmAvancerStatut
-- déjà utilisé pour clients.statut.
--
-- ─── Visibilité (RLS) ────────────────────────────────────────────────────
-- Même règle de périmètre par palier CM que clients_cm_select_acces
-- (migration-cm-tiers.sql), transitive via client_id. Un contenu sans
-- client (client_id NULL — ex: communication SportVision elle-même, palier
-- cm_interne) n'est visible que par son créateur, le Lead CM et l'admin.
-- Suppression volontairement plus restrictive que l'édition collaborative :
-- créateur, Lead CM ou admin uniquement, pour éviter qu'un CM supprime le
-- travail d'un collègue par erreur — l'édition/création elle, reste
-- collaborative (tout CM qui voit le client peut créer/modifier son
-- contenu, ex: un Junior prépare, un Confirmé valide).
--
-- Idempotente : DROP ... IF EXISTS avant chaque CREATE, peut être rejouée
-- sans effet de bord. À exécuter dans Supabase → SQL Editor, après
-- migration-cm-tiers.sql (dépend de profiles.niveau_cm et clients.cm_id).

-- ─── 1. Table ────────────────────────────────────────────────────────────
create table if not exists contenus (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  cm_id uuid references profiles(id) not null,
  titre text not null,
  description text,
  plateforme text,
  type_contenu text,
  statut text not null default 'brouillon' check (statut in (
    'brouillon','a_valider_interne','a_valider_client','corrections',
    'valide','programme','publie','archive'
  )),
  hook text,
  legende text,
  cta text,
  hashtags text,
  sponsor text,
  date_prevue date,
  date_publication date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_contenus_client on contenus(client_id);
create index if not exists idx_contenus_cm on contenus(cm_id);

alter table contenus enable row level security;

-- ─── 2. Fonction de visibilité par palier (factorise select/insert/update) ─
create or replace function contenus_visible_par_cm(p_client_id uuid, p_uid uuid)
returns boolean language sql stable security definer as $$
  select p_client_id is not null and exists (
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
  );
$$;

-- ─── 3. Policies ─────────────────────────────────────────────────────────
drop policy if exists "contenus_admin_all" on contenus;
create policy "contenus_admin_all" on contenus for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

drop policy if exists "contenus_select" on contenus;
create policy "contenus_select" on contenus for select using (
  cm_id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
  or contenus_visible_par_cm(client_id, auth.uid())
);

drop policy if exists "contenus_insert" on contenus;
create policy "contenus_insert" on contenus for insert with check (
  cm_id = auth.uid() and (
    client_id is null
    or contenus_visible_par_cm(client_id, auth.uid())
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
  )
);

-- with check explicite obligatoire ici : sans lui, Postgres réutilise le
-- using ci-dessus tel quel sur la ligne APRÈS modification. Comme c'est un
-- OR, un CM propriétaire (cm_id = auth.uid()) pourrait sinon réaffecter
-- client_id vers un client hors de son périmètre sans jamais repasser par
-- contenus_visible_par_cm, tant que cm_id reste le sien — contournant tout
-- le cloisonnement par portefeuille. Le with check force à revalider le
-- nouveau client_id (et interdit à un non-Lead de réattribuer cm_id).
drop policy if exists "contenus_update" on contenus;
create policy "contenus_update" on contenus for update using (
  cm_id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
  or contenus_visible_par_cm(client_id, auth.uid())
) with check (
  (cm_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead'))
  and (client_id is null or contenus_visible_par_cm(client_id, auth.uid()) or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead'))
);

drop policy if exists "contenus_delete" on contenus;
create policy "contenus_delete" on contenus for delete using (
  cm_id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
);
