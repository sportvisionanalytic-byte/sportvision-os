-- ============================================================
-- Migration v43 — Reconstruction de l'espace Joueur (Connect)
--
-- Contexte : Fouka a testé en direct l'espace Joueur et jugé qu'il ressemblait trop à une
-- version bridée du compte admin de club (menu, dashboard, vocabulaire, catalogue). Cette
-- migration porte les deux seuls changements de modèle de données nécessaires côté backend
-- pour la refonte associée (le reste — navigation, dashboard, vocabulaire — est purement
-- frontend, aucune migration requise) :
--   1. Favoris sur les contenus (nouveau, § 9 du brief).
--   2. Rattachement d'un joueur à un `client_id` (Portail/CRM), pour que la Messagerie
--      fonctionne réellement pour un compte Joueur (§ 15 du brief) — voir le rapport final de
--      l'agent pour le détail de l'investigation (le compte Joueur n'avait aujourd'hui AUCUN
--      client_id exploitable, ni pour les messages ni pour une commande personnelle : useClientId()
--      renvoyait "locked" pour organization.type === "player", donc /messages affichait un module
--      verrouillé — l'exact anti-pattern que Fouka dénonce dans son brief).
--
-- Idempotente (create table/policy if not exists, drop policy if exists avant
-- chaque create policy, create or replace function) : peut être rejouée sans effet de bord si
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- table contenu_favoris, policies cf_own_select/insert/delete, colonne
-- player_profiles.client_id et fonction player_has_client_access existent
-- déjà en base. resolve_player_client_id a été redéfinie depuis (v56) mais
-- conserve intégralement la logique posée ici. Cet en-tête disait à tort
-- "NON EXÉCUTÉE".
-- une partie a déjà été appliquée.
-- ============================================================

-- ────────────────────────────────────────────────────────────────────────
-- 1. FAVORIS SUR LES CONTENUS
-- ────────────────────────────────────────────────────────────────────────
--
-- Écart volontaire par rapport à la piste initiale (`contenu_favoris.contenu_id references
-- contenus(id)`) : la table `contenus` (migration-contenus.sql) est le planning éditorial CM
-- (posts/publications), PAS les médias qu'un joueur consulte dans "Mes contenus". Les contenus
-- réels d'un espace Joueur viennent de `club_media` et `club_creations` (migration-clubplus-
-- v7/v8.sql), agrégés côté app en un seul type `MediaAsset` dont l'id applicatif est composite
-- ("media-<uuid club_media>" ou "creation-<uuid club_creations>", voir app-next/src/lib/data/
-- club/content.ts:fetchClubMediaAssets). Une FK stricte vers `contenus(id)` n'aurait donc jamais
-- correspondu à un seul favori réel côté joueur. `media_asset_id` est du texte libre (l'id
-- composite ci-dessus), sans contrainte de clé étrangère : la table qui porte réellement le
-- contenu (club_media vs club_creations) diffère selon le préfixe, une seule FK ne peut pas
-- couvrir les deux. La RLS ci-dessous suffit à garantir qu'un utilisateur ne voit/ne modifie que
-- ses propres favoris — aucune lecture croisée n'est possible même sans FK stricte côté contenu.
create table if not exists contenu_favoris (
  id uuid primary key default gen_random_uuid(),
  media_asset_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (media_asset_id, user_id)
);

alter table contenu_favoris enable row level security;

drop policy if exists "cf_own_select" on contenu_favoris;
create policy "cf_own_select" on contenu_favoris for select using (user_id = auth.uid());

drop policy if exists "cf_own_insert" on contenu_favoris;
create policy "cf_own_insert" on contenu_favoris for insert with check (user_id = auth.uid());

drop policy if exists "cf_own_delete" on contenu_favoris;
create policy "cf_own_delete" on contenu_favoris for delete using (user_id = auth.uid());

create index if not exists idx_cf_user on contenu_favoris(user_id);

-- ────────────────────────────────────────────────────────────────────────
-- 2. CLIENT_ID POUR UN ESPACE JOUEUR (débloque la Messagerie réelle)
-- ────────────────────────────────────────────────────────────────────────
--
-- `player_profiles` n'a aujourd'hui aucun lien vers `clients` (table CRM/Portail qui porte
-- `messages_client.client_id`, `client_prestations`, etc. — toutes NOT NULL sur client_id). Un
-- joueur ne pouvait donc échanger avec SportVision nulle part dans Connect. Même schéma que
-- `clubs.portail_client_id` (lien club → client), en plus léger : provisionné à la demande (lazy),
-- pas en masse, pour ne jamais créer de ligne `clients` fantôme pour un joueur qui n'ouvre jamais
-- Messages.
alter table player_profiles add column if not exists client_id uuid references clients(id) on delete set null;

-- Le joueur courant a-t-il accès à ce client (messages) via son propre lien player_profiles ? —
-- même patron que club_member_has_client_access() (migration-clubplus-v33.sql), SECURITY DEFINER
-- pour la même raison (utilisée à l'intérieur d'une policy RLS sur messages_client).
create or replace function player_has_client_access(target_client_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1
    from player_profiles pp
    where pp.user_id = auth.uid()
      and pp.client_id = target_client_id
  );
$$;

-- Résout (et crée si besoin) le client_id du joueur appelant. SECURITY DEFINER : l'écriture dans
-- `clients`/`player_profiles.client_id` n'est permise à aucun rôle authentifié directement (table
-- `clients` réservée au staff), seulement via cette fonction, qui vérifie elle-même que
-- l'appelant EST bien le joueur concerné (p_player_id) avant d'agir — jamais pour un autre joueur.
-- N'invente aucune donnée : `nom`/`prenom_contact`/`nom_contact` reprennent tels quels
-- player_profiles.prenom/nom (déjà saisis à la création de la fiche par le club) ; les autres
-- colonnes de `clients` (email, téléphone, ville...) restent NULL — clients.nom est la seule
-- colonne NOT NULL sans défaut sur cette table (voir supabase-schema-v2.sql).
create or replace function resolve_player_client_id(p_player_id uuid)
returns uuid language plpgsql security definer as $$
declare
  v_client_id uuid;
  v_prenom text;
  v_nom text;
begin
  select client_id, prenom, nom into v_client_id, v_prenom, v_nom
  from player_profiles
  where id = p_player_id and user_id = auth.uid();

  if not found then
    raise exception 'Joueur introuvable ou accès refusé.';
  end if;

  if v_client_id is not null then
    return v_client_id;
  end if;

  insert into clients (nom, type_client, prenom_contact, nom_contact)
  values (v_prenom || ' ' || v_nom, 'particulier', v_prenom, v_nom)
  returning id into v_client_id;

  update player_profiles set client_id = v_client_id where id = p_player_id;

  return v_client_id;
end;
$$;

-- messages_client : étend mc_client_select/mc_client_insert au joueur propriétaire du client_id
-- résolu ci-dessus — même construction que migration-clubplus-v34 pour le club (OR
-- player_has_client_access(...) en plus de la vérification client_users existante). N'importe
-- quel autre effet de la policy existante (client_users, club) reste strictement inchangé.
drop policy if exists "mc_client_select" on messages_client;
create policy "mc_client_select" on messages_client for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id)
  or (select client_id from clubs c join club_members cm on cm.club_id = c.id
      where cm.user_id = auth.uid() and cm.status = 'actif' and c.portail_client_id = messages_client.client_id
      limit 1) is not null
  or player_has_client_access(messages_client.client_id)
);

drop policy if exists "mc_client_insert" on messages_client;
create policy "mc_client_insert" on messages_client for insert with check (
  auteur_type = 'client'
  and (auteur_client_id = auth.uid() or auteur_client_id is null)
  and (
    exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id)
    or (select client_id from clubs c join club_members cm on cm.club_id = c.id
        where cm.user_id = auth.uid() and cm.status = 'actif' and c.portail_client_id = messages_client.client_id
        limit 1) is not null
    or player_has_client_access(messages_client.client_id)
  )
);

-- Remarque volontaire : la ligne "club" ci-dessus réécrit en SQL direct ce que
-- club_member_has_client_access() fait déjà (migration-clubplus-v33.sql) plutôt que d'appeler la
-- fonction, pour ne dépendre d'aucun ordre d'exécution entre fichiers de migration si celui-ci est
-- rejoué seul sur une base qui n'aurait pas encore v33/v34. Si club_member_has_client_access()
-- existe déjà (cas normal, v33 exécutée), les deux formulations sont strictement équivalentes —
-- aucune action requise pour la remplacer.
