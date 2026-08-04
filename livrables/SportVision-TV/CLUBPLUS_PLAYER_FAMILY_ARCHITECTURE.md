# Espace Joueur & Famille — Architecture (v1, à valider)

Document d'architecture avant migration. Aucune migration destructive n'a été lancée. Objectif : intégrer le module « Espace Joueur & Famille » dans SportVision Club+ existant (même app statique `app.html`, même projet Supabase, même Netlify), sans quatrième application ni backend indépendant.

---

## 0. Ce que l'existant impose (résumé factuel, cf. inventaire du schéma)

Faits qui contraignent toutes les décisions ci-dessous :

- **`is_club_member(club_id)`** (SECURITY DEFINER) ne vérifie que `club_members.status = 'actif'`, sans distinction de rôle. Il est utilisé comme condition SELECT sur `clubs`, `club_teams`, `club_media`, `club_creations`, `club_calendar_events`, `club_matches`, `club_requests`, `club_credit_transactions`. **Un joueur/parent ne doit jamais devenir un `club_members`** : il hériterait automatiquement de la lecture des demandes de création internes, des transactions de crédits, et de toutes les colonnes de `clubs` (dont `credits_balance`, `role_permissions`, `portail_client_id`). C'est la contrainte la plus structurante de tout ce document → §2.
- **Pas de table de saisons** : `clubs.saison` est un simple `text` mutable représentant la saison courante du club (pas d'historique). L'affiliation équipe est aujourd'hui un `jsonb` libre sur `club_members.teams`, sans table de rattachement par saison. Le module Joueur & Famille a besoin d'un historique de saisons (renouvellement §20) : ce n'est pas fourni par l'existant, il faut l'introduire (§3, `team_memberships.saison`).
- **`club_teams`** existe (id, nom, catégorie, section, coach...) mais n'est référencée par FK nulle part ailleurs : `club_media.team`, `club_creations.team`, `club_calendar_events.team`, `club_matches.team` sont tous des `text` libres (nom d'équipe recopié à la main). Conséquence directe : il n'existe **aucun mécanisme pour restreindre l'accès à une galerie par équipe** aujourd'hui — n'importe quel `club_members` actif voit tout `club_media`/`club_creations` du club. Le module Joueur & Famille ne peut pas hériter de ce comportement (§5 du prompt : « ne jamais donner accès automatiquement à toutes les galeries »), il doit ajouter une couche d'autorisation par média (§7 `media_access_rules`).
- **Pattern de bucket de stockage** réutilisable tel quel : `insert into storage.buckets(...) ... on conflict do nothing` + policies via `storage.foldername(name)` (`clubplus-media`, migration v10). Aucun nouveau bucket n'est nécessaire pour ce module — les documents d'autorisation et les imports peuvent utiliser des sous-dossiers dédiés du même bucket (`clubplus-media/family-docs/<club_id>/...`) avec une policy propre.
- **Pattern « SECURITY DEFINER function plutôt que policy UPDATE large »** déjà établi deux fois (`submit_club_request`/`update_club_request_status`, `client_decide_devis`) : c'est le patron à suivre pour toutes les transitions d'état sensibles du module (validation d'inscription, vérification d'autorisation parentale, etc.) plutôt que des policies UPDATE ouvertes.
- **`profiles`** (staff SportVision OS : admin/sec/prod/photo/cm/compta/com) et **`club_members`** (dirigeants de club) sont deux univers de rôles distincts et étanches, séparés uniquement par le fait que `handle_new_user()` ne crée une ligne `profiles` que si `raw_user_meta_data.role` est fourni à l'inscription — jamais envoyé par Club+/Portail. Le module Joueur & Famille introduit un **troisième univers de rôles** (joueur/parent), tout aussi étanche : ni `profiles`, ni `club_members`.
- **Bridge Portail (`portail_client_id`, `client_users`, vues `client_*`)** est un vrai précédent réutilisable pour la commande de prestations personnelles (§10), mais avec une limite importante identifiée en §5 de ce document : les vues `client_*` sont **lecture seule** côté client (le client accepte/refuse un devis existant via `client_decide_devis`, il ne peut pas *créer* un devis ou une commande lui-même). Le parcours « joueur commande un shooting individuel » du prompt suppose un point d'entrée self-service qui **n'existe pas encore côté Portail**. C'est un risque explicite, voir §9.

---

## 1. Rôles introduits (aucun ajout à `club_members.role`)

| Rôle | Support technique | Compte Auth |
|---|---|---|
| Joueur majeur (18+) | `player_profiles` + `user_id` renseigné | Oui, personnel |
| Joueur mineur 14–17 | `player_profiles` + `user_id` renseigné **seulement après validation** | Oui, personnel, activé conditionnellement |
| Joueur mineur < 14 | `player_profiles`, `user_id` **toujours NULL** | Non — jamais |
| Parent / représentant légal | `parent_profiles` + `user_id` obligatoire (unique) | Oui, dès la première action |
| Fiche joueur sans compte | `player_profiles` seul, `account_status = 'sans_compte'` | Non |

Ni les joueurs ni les parents ne deviennent des lignes `club_members`. Ce sont des tables et des policies entièrement séparées (§4), avec leurs propres fonctions `is_*` non réutilisées par le reste de l'app.

---

## 2. Schéma — tables nouvelles

Convention reprise de l'existant : `uuid default gen_random_uuid()` en PK, `timestamptz default now()`, `text` + `check` pour les énumérations, trigger `update_updated_at_generic()` (déjà défini, réutilisé tel quel) sur toute table mutable avec `updated_at`.

### 2.1 Identité joueur / parent

```sql
-- Fiche joueur : peut exister durablement sans compte Auth (import de 300 joueurs → 300 fiches, 0 compte).
create table player_profiles (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  user_id uuid references auth.users on delete set null,        -- NULL tant qu'aucun compte n'est activé
  prenom text not null,
  nom text not null,
  date_naissance date not null,                                  -- source de vérité pour l'âge, jamais recalculée côté client
  sexe text check (sexe in ('M','F','autre')),
  numero_licence text,
  numero_maillot text,
  photo_url text,
  account_status text check (account_status in (
    'sans_compte','invite','en_attente_activation','actif','suspendu','retire'
  )) not null default 'sans_compte',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint player_user_unique unique (user_id)                 -- un compte Auth ↔ au plus une fiche joueur
);

-- Parent : profil global (pas par club) — un parent peut avoir des enfants dans plusieurs clubs.
create table parent_profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null unique,
  prenom text,
  nom text,
  telephone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table parent_player_relationships (
  id uuid default gen_random_uuid() primary key,
  parent_id uuid references parent_profiles(id) on delete cascade not null,
  player_id uuid references player_profiles(id) on delete cascade not null,
  relation_type text check (relation_type in ('parent','tuteur_legal','autre_representant')) default 'parent',
  statut text check (statut in ('en_attente_confirmation','confirme','refuse','retire')) not null default 'en_attente_confirmation',
  confirmed_at timestamptz,
  created_at timestamptz default now(),
  unique (parent_id, player_id)
);
```

**Règle d'âge côté serveur** : fonction `sql immutable`, jamais un champ stocké recalculé côté client :

```sql
create or replace function sv_age_bracket(p_date_naissance date)
returns text language sql immutable as $$
  select case
    when p_date_naissance is null then null
    when age(p_date_naissance) < interval '14 years' then 'moins_14'
    when age(p_date_naissance) < interval '18 years' then '14_17'
    else 'majeur'
  end;
$$;
```
Utilisée dans les fonctions RPC (§6) et dans les policies RLS — jamais dans une colonne mise en cache côté `player_profiles` (un anniversaire changerait silencieusement la tranche d'âge sans écriture explicite ; recalculer à la lecture évite toute désynchronisation).

### 2.2 Rattachement équipe / saison

```sql
-- Historique par saison — n'existe pas dans l'app actuelle (club_members.teams est un jsonb non historisé).
create table team_memberships (
  id uuid default gen_random_uuid() primary key,
  player_id uuid references player_profiles(id) on delete cascade not null,
  team_id uuid references club_teams(id) on delete cascade not null,
  club_id uuid references clubs(id) on delete cascade not null,   -- dénormalisé pour policies simples ; vérifié par trigger = club_teams.club_id
  saison text not null,                                            -- même convention texte que clubs.saison
  statut text check (statut in (
    'active','en_attente_renouvellement','archivee','quittee_equipe','quittee_club'
  )) not null default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (player_id, team_id, saison)
);

create or replace function check_team_membership_club()
returns trigger language plpgsql as $$
begin
  if new.club_id <> (select club_id from club_teams where id = new.team_id) then
    raise exception 'team_id n''appartient pas à club_id';
  end if;
  return new;
end;
$$;
create trigger trg_tm_check_club before insert or update on team_memberships
  for each row execute procedure check_team_membership_club();
```

### 2.3 Invitations, code équipe, demandes d'adhésion

```sql
create table team_invite_codes (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  team_id uuid references club_teams(id) on delete cascade not null,
  code text unique not null,                -- généré serveur, ex. SV-U18-8264
  actif boolean default true,
  expire_at timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

create table player_invitations (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  team_id uuid references club_teams(id) on delete set null,
  email text not null,
  prenom text, nom text, date_naissance date,     -- connue dès l'invitation pour orienter le bon parcours d'âge
  invited_by uuid references auth.users on delete set null,
  statut text check (statut in ('envoyee','acceptee','expiree','annulee')) not null default 'envoyee',
  resulting_request_id uuid,                       -- FK ajoutée après création de membership_requests (ordre des tables)
  created_at timestamptz default now()
);

create table parent_invitations (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  player_id uuid references player_profiles(id) on delete cascade,   -- rattachée à une fiche joueur existante si connue
  email text not null,
  prenom text, nom text,
  invited_by uuid references auth.users on delete set null,
  statut text check (statut in ('envoyee','acceptee','expiree','annulee')) not null default 'envoyee',
  created_at timestamptz default now()
);

create table membership_requests (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  team_id uuid references club_teams(id) on delete set null,
  requested_by_user_id uuid references auth.users on delete set null,  -- compte qui agit (joueur 18+/14-17, ou parent si <14)
  player_id uuid references player_profiles(id) on delete cascade,
  parent_id uuid references parent_profiles(id) on delete set null,
  source text check (source in ('invitation','spontanee','code_equipe')) not null,
  invite_code_id uuid references team_invite_codes(id) on delete set null,
  statut text check (statut in (
    'a_verifier','autorisation_manquante','en_attente_parent','pret_a_valider',
    'validee','refusee','doublon_signale','transferee_admin'
  )) not null default 'a_verifier',
  validation_mode text check (validation_mode in ('standard','controle','double')),
  educateur_confirme_par uuid references auth.users on delete set null,
  educateur_confirme_at timestamptz,
  admin_valide_par uuid references auth.users on delete set null,
  admin_valide_at timestamptz,
  refus_motif text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table player_invitations add constraint fk_pi_request foreign key (resulting_request_id) references membership_requests(id) on delete set null;

create table membership_request_events (
  id uuid default gen_random_uuid() primary key,
  request_id uuid references membership_requests(id) on delete cascade not null,
  event_type text not null,     -- 'creee','info_demandee','relance_parent','transferee_admin','acceptee','refusee','doublon_signale'
  acted_by uuid references auth.users on delete set null,
  note text,
  created_at timestamptz default now()
);
```

Mode de validation par club (§9 du prompt) : plutôt qu'une nouvelle table, une colonne `clubs.membership_validation_mode text check (... in ('standard','controle','double')) default 'standard'`, lue à la création de la `membership_request` pour fixer `validation_mode` (dénormalisé sur la demande pour ne jamais changer les règles d'une demande déjà en cours si l'admin modifie le réglage du club après coup).

### 2.4 Autorisations parentales

```sql
create table authorization_types (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,   -- creation_compte, acces_clubplus, traitement_donnees, consultation_medias,
                                -- droit_image, diffusion_interne, diffusion_reseaux, diffusion_sportvision,
                                -- telechargement, communications, projet_collectif, commandes_paiements
  label text not null,
  description text,
  obligatoire boolean default true,
  actif boolean default true
);

create table authorization_versions (
  id uuid default gen_random_uuid() primary key,
  authorization_type_id uuid references authorization_types(id) not null,
  club_id uuid references clubs(id) on delete cascade,   -- NULL = texte SportVision par défaut, sinon override club
  version_label text not null,
  texte text not null,
  actif boolean default true,
  created_at timestamptz default now()
);

create table parental_authorizations (
  id uuid default gen_random_uuid() primary key,
  player_id uuid references player_profiles(id) on delete cascade not null,
  parent_id uuid references parent_profiles(id) on delete set null,
  authorization_type_id uuid references authorization_types(id) not null,
  version_id uuid references authorization_versions(id) not null,
  statut text check (statut in (
    'non_transmise','en_attente','transmise','a_verifier','valide',
    'incomplete','refusee','expiree','retiree','remplacee'
  )) not null default 'non_transmise',
  methode text check (methode in ('deja_detenue','import_document','signature_numerique')),
  support_autorise text[],           -- sous-ensemble de 'interne_clubplus','reseaux_club','supports_sportvision'
  finalite text,
  document_url text,                  -- import du parent, ou PDF généré pour la méthode 3
  date_signature timestamptz,
  date_debut date,
  date_expiration date,
  preuve jsonb,                       -- méthode 3 uniquement : {ip, user_agent, lu_le, email_verifie, version_texte}
  verified_by uuid references auth.users on delete set null,
  verified_at timestamptz,
  retrait_motif text,
  retrait_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (player_id, authorization_type_id, version_id)
);

create table authorization_events (
  id uuid default gen_random_uuid() primary key,
  authorization_id uuid references parental_authorizations(id) on delete cascade not null,
  event_type text not null,   -- creee, document_importe, signature_numerique, verifiee, refusee, retiree, remplacee, relance_envoyee
  acted_by uuid references auth.users on delete set null,
  note text,
  created_at timestamptz default now()
);
```

Note : `authorization_events` seul ne suffit pas pour la « preuve de lecture » de la méthode 3 (§5, signature numérique) — c'est `parental_authorizations.preuve jsonb` qui la porte (capturée au moment de la signature, immuable ensuite).

### 2.5 Favoris

```sql
create table favorite_collections (
  id uuid default gen_random_uuid() primary key,
  owner_user_id uuid references auth.users on delete cascade not null,
  player_id uuid references player_profiles(id) on delete cascade not null,   -- pour quel enfant (cas parent multi-enfants)
  name text not null,
  created_at timestamptz default now()
);

-- Pas de FK native possible vers club_media OU club_creations (référence polymorphe) : contrôle par trigger.
create table player_favorites (
  id uuid default gen_random_uuid() primary key,
  owner_user_id uuid references auth.users on delete cascade not null,
  player_id uuid references player_profiles(id) on delete cascade not null,
  collection_id uuid references favorite_collections(id) on delete set null,
  media_ref_type text check (media_ref_type in ('club_media','club_creations')) not null,
  media_ref_id uuid not null,
  created_at timestamptz default now(),
  unique (owner_user_id, player_id, media_ref_type, media_ref_id)
);

create or replace function check_favorite_media_exists()
returns trigger language plpgsql as $$
begin
  if new.media_ref_type = 'club_media' and not exists (select 1 from club_media where id = new.media_ref_id) then
    raise exception 'media introuvable';
  elsif new.media_ref_type = 'club_creations' and not exists (select 1 from club_creations where id = new.media_ref_id) then
    raise exception 'creation introuvable';
  end if;
  return new;
end;
$$;
create trigger trg_fav_check before insert on player_favorites
  for each row execute procedure check_favorite_media_exists();
```

### 2.6 Règles d'accès média + signalements

```sql
-- Sans cette table, aucun club_media/club_creations n'est visible côté joueur/famille (fail-closed).
create table media_access_rules (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  media_ref_type text check (media_ref_type in ('club_media','club_creations')) not null,
  media_ref_id uuid not null,
  team_id uuid references club_teams(id) on delete cascade,
  consultation_only boolean default false,
  telechargement_autorise boolean default true,
  partage_autorise boolean default false,
  expire_at timestamptz,
  visible_parent boolean default true,
  visible_joueur boolean default true,
  lie_mineurs boolean default false,      -- si true : nécessite droit_image valide pour le joueur concerné
  created_at timestamptz default now(),
  unique (media_ref_type, media_ref_id)
);

create table media_reports (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  media_ref_type text check (media_ref_type in ('club_media','club_creations')) not null,
  media_ref_id uuid not null,
  reported_by uuid references auth.users on delete set null,
  player_concerned_id uuid references player_profiles(id) on delete set null,
  motif text check (motif in (
    'joueur_present_retrait','enfant_present','mauvaise_equipe','contenu_inapproprie','droit_image','erreur','autre'
  )) not null,
  message text,
  statut text check (statut in (
    'recu','a_verifier','media_masque','infos_demandees','retrait_accepte','retrait_refuse','termine'
  )) not null default 'recu',
  refus_motif text,
  handled_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### 2.7 Projet collectif d'équipe

```sql
create table team_projects (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  team_id uuid references club_teams(id) on delete cascade not null,
  catalogue_offre_id uuid references catalogue_offres(id) not null,   -- réutilise le catalogue Portail, pas de doublon
  titre text not null,
  objectif text,
  montant_cible numeric(10,2) not null,
  montant_collecte numeric(10,2) not null default 0,
  date_evenement date,
  date_limite date,
  part_conseillee numeric(10,2),
  contribution_min numeric(10,2),
  responsable_id uuid references auth.users on delete set null,
  conditions_non_atteint text,
  statut text check (statut in (
    'brouillon','attente_validation_club','valide','ouvert','objectif_atteint',
    'paiement_complementaire_necessaire','confirme','annule','rembourse','prestation_realisee','livre'
  )) not null default 'brouillon',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table team_project_contributions (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references team_projects(id) on delete cascade not null,
  contributor_type text check (contributor_type in ('joueur_majeur','parent','club','sponsor')) not null,
  contributor_user_id uuid references auth.users on delete set null,
  player_id uuid references player_profiles(id) on delete set null,   -- pour quel enfant, si contributor_type='parent'
  montant numeric(10,2) not null,
  statut text check (statut in ('en_attente','paye','rembourse','echoue')) not null default 'en_attente',
  portail_paiement_ref text,     -- référence externe (Stripe/Portail), pas de re-stockage du paiement lui-même
  created_at timestamptz default now()
);

create table team_project_events (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references team_projects(id) on delete cascade not null,
  event_type text not null,
  acted_by uuid references auth.users on delete set null,
  note text,
  created_at timestamptz default now()
);
```

### 2.8 Renouvellement de saison

```sql
create table season_membership_renewals (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  from_saison text not null,
  to_saison text not null,
  player_id uuid references player_profiles(id) on delete cascade not null,
  from_team_membership_id uuid references team_memberships(id) on delete set null,
  action text check (action in ('renouvele','deplace','archive','mis_en_attente','quitte_club')) not null,
  new_team_id uuid references club_teams(id) on delete set null,
  processed_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);
```

### 2.9 Table volontairement **non créée** : `player_access_status`

Le prompt d'origine la liste, mais son contenu (actif/suspendu/retiré/quitté équipe/quitté club/compte supprimé/autorisation retirée) est déjà porté par `player_profiles.account_status` + `team_memberships.statut` + `parental_authorizations.statut`. Une table de statut séparée dupliquerait un état déjà présent ailleurs et pourrait diverger (c'est le même écueil déjà visible dans l'existant avec `club_teams.members`, un compteur dénormalisé non garanti à jour — à ne pas reproduire). À la place : `player_access_events` (audit des changements de statut, qui/quand/pourquoi), consultée pour l'historique plutôt que pour l'état courant.

```sql
create table player_access_events (
  id uuid default gen_random_uuid() primary key,
  player_id uuid references player_profiles(id) on delete cascade not null,
  event_type text not null,   -- 'suspendu','accès_retiré','déplacé','archivé','réactivé'
  motif text,
  acted_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);
```

---

## 3. Notifications — dépendance non couverte par l'existant

Aucune table de notifications n'existe dans Club+/Portail/OS aujourd'hui (l'app actuelle n'a que des badges statiques côté démo). §23 du prompt demande des notifications joueur/parent/éducateur/admin. Proposition minimale pour ce module (in-app uniquement, pas d'e-mail/push en v1, ce qui reste cohérent avec le fait que le seul e-mail transactionnel existant passe par Supabase Auth pour les invitations) :

```sql
create table family_notifications (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  recipient_user_id uuid references auth.users on delete cascade not null,
  type text not null,        -- cf. liste §23 du prompt, une valeur par cas d'usage
  ref_type text,             -- 'membership_request','parental_authorization','media_report','team_project',...
  ref_id uuid,
  lu boolean default false,
  created_at timestamptz default now()
);
```
Écrite par les fonctions RPC (`notify_player`/`notify_parent`/`notify_coach` du §28 deviennent des appels internes `insert into family_notifications`, pas des fonctions HTTP séparées). E-mail/push réels restent un chantier ultérieur, hors périmètre de cette phase.

---

## 4. Fonctions RLS — nouvelles, non partagées avec `is_club_member`

```sql
create or replace function is_own_player(p_player_id uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from player_profiles where id = p_player_id and user_id = auth.uid());
$$;

create or replace function is_confirmed_parent_of(p_player_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from parent_player_relationships ppr
    join parent_profiles pp on pp.id = ppr.parent_id
    where ppr.player_id = p_player_id and pp.user_id = auth.uid() and ppr.statut = 'confirme'
  );
$$;

-- Vrai si l'appelant (joueur lui-même OU parent confirmé) a un rattachement actif à cette équipe.
create or replace function is_family_of_team(p_team_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from team_memberships tm
    join player_profiles p on p.id = tm.player_id
    where tm.team_id = p_team_id and tm.statut = 'active'
      and (p.user_id = auth.uid() or is_confirmed_parent_of(p.id))
  );
$$;

-- Éducateur/responsable d'équipe : réutilise club_members (univers dirigeants) mais reste distinct de is_club_member
-- côté RLS joueur/famille — un éducateur passe par CETTE fonction pour agir sur les demandes, jamais l'inverse.
create or replace function is_team_educateur(p_team_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from club_members cm, club_teams ct
    where ct.id = p_team_id and cm.club_id = ct.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in ('coach','resp_equipe')
      and (cm.teams @> to_jsonb(ct.name::text) or cm.role = 'admin')
  );
$$;
```

`is_club_admin(club_id)` (déjà existante) est réutilisée telle quelle pour toutes les actions administrateur du module — aucune nouvelle fonction nécessaire à ce niveau.

### 4.1 Lecture de l'identité club par un joueur/parent (colonnes limitées)

RLS filtre des lignes, pas des colonnes : `clubs_member_select` (`is_club_member`) exposerait `credits_balance`, `role_permissions`, `portail_client_id` à un joueur si on le laissait passer par elle. Solution : une vue dédiée, même patron que les vues `client_*` de Portail (propriétaire de la vue, pas `security_invoker`, contrôle d'accès dans le `where`) :

```sql
create view club_family_identity as
select c.id, c.nom, c.ville, c.discipline, c.saison, c.logo_url, c.ecusson_url
from clubs c
where exists (
  select 1 from team_memberships tm join player_profiles p on p.id = tm.player_id
  where p.club_id = c.id and tm.statut = 'active'
    and (p.user_id = auth.uid() or is_confirmed_parent_of(p.id))
);
```

---

## 5. RLS par table (résumé, patron réutilisé de l'existant : SELECT ouvert au périmètre autorisé, INSERT/UPDATE via fonctions SECURITY DEFINER plutôt que policies larges quand l'action est sensible)

| Table | SELECT | INSERT/UPDATE | DELETE |
|---|---|---|---|
| `player_profiles` | soi-même (`user_id=auth.uid()`), parent confirmé, éducateur/admin du club | via RPC uniquement (jamais de policy INSERT directe, même logique que `club_members`) | admin club |
| `parent_profiles` | soi-même, admin du club d'un enfant lié | soi-même (update profil), création via RPC | — |
| `parent_player_relationships` | parent concerné, admin/éducateur du club du joueur | RPC (`link_parent_to_player`) | admin |
| `team_memberships` | joueur/parent concerné, `is_team_educateur`, `is_club_admin` | RPC (`request_team_membership` → `validate_team_membership`, `move_player_to_team`) | — |
| `membership_requests` | demandeur, `is_team_educateur(team_id)`, `is_club_admin` | RPC | — |
| `parental_authorizations` | joueur/parent concerné, `is_club_admin`, éducateur **uniquement le statut agrégé** pas `document_url`/`preuve` (colonne sensible → exposée seulement via une vue `authorization_status_for_coach` sans `document_url`/`preuve`, même logique de vue-filtrante que §4.1) | RPC | — |
| `media_access_rules` | `is_club_member` (dirigeants) + `is_family_of_team(team_id)` | admin/éducateur | admin |
| `club_media` / `club_creations` (lecture famille) | **nouvelle policy additive** `select using (is_club_member(club_id) or exists (select 1 from media_access_rules r where r.media_ref_id = id and is_family_of_team(r.team_id) and ((visible_joueur and is_own_player_via_team) or (visible_parent and is_confirmed_parent...))))` — s'ajoute aux policies existantes, ne les remplace pas | inchangé | inchangé |
| `player_favorites` / `favorite_collections` | propriétaire uniquement | propriétaire | propriétaire |
| `media_reports` | auteur, admin, éducateur (lecture seule, pas modification) | auteur (insert), admin (update statut) | — |
| `team_projects` | `is_family_of_team`, `is_club_member` | éducateur/admin (create+validate), RPC pour changement de statut | admin |
| `team_project_contributions` | contributeur, admin, éducateur de l'équipe | RPC (`create_team_contribution_checkout`) | — |
| `family_notifications` | destinataire uniquement | RPC (écriture serveur) | destinataire (marquer lu) |

Point d'attention spécifique retenu du prompt (§27) : « Un joueur U18 ne doit jamais accéder aux médias U15 » — garanti par construction puisque `is_family_of_team` exige un `team_memberships` actif sur *cette* équipe précise, pas sur le club en général (contrairement à `is_club_member` qui est club-large). C'est la différence de conception fondamentale entre l'univers dirigeants (accès club-large) et l'univers famille (accès équipe-restreint) de ce module.

---

## 6. Fonctions RPC (SECURITY DEFINER) — liste et garde-fous

Toutes vérifient, dans cet ordre : identité (`auth.uid()`), âge recalculé via `sv_age_bracket()` (jamais une valeur transmise par le client), club/équipe cohérents, permissions du rôle appelant, autorisation parentale valide si mineur concerné, écriture d'un événement d'audit, retour d'erreur explicite (`raise exception` avec message clair, pattern déjà utilisé par `client_decide_devis`).

- `create_player_invitation`, `create_parent_invitation` — vérifie que l'appelant est admin, ou éducateur restreint à ses équipes (`is_team_educateur`).
- `request_team_membership` — parcours spontané ou suite invitation ; ne rend jamais de donnée interne tant que non validée (§7 du prompt).
- `validate_team_membership`, `reject_team_membership` — bloque `validate` si mineur sans autorisation parentale `valide` (bouton désactivé côté client, mais **la garde réelle est ici, côté serveur**, jamais uniquement dans l'UI).
- `request_parental_authorization`, `submit_parental_authorization`, `verify_parental_authorization`, `withdraw_parental_authorization` — `withdraw` déclenche en cascade : `media_access_rules` réévaluées (aucune suppression physique, mais journalisation + notification), `player_access_events`.
- `create_team_invite_code`, `rotate_team_invite_code` — génère le code serveur (jamais côté client), format `SV-<CATEGORIE>-<4 chiffres aléatoires>`.
- `link_parent_to_player` — crée `parent_player_relationships` en `en_attente_confirmation`, jamais `confirme` directement.
- `activate_minor_player_account` (14–17) — recalcule l'âge, exige une autorisation `creation_compte` + `acces_clubplus` valides, crée le compte Auth via `admin.auth.admin.inviteUserByEmail` (même pattern que `clubplus-invite`), passe `player_profiles.account_status` à `actif`.
- `create_player_account_at_majority` — bascule un profil `14_17` déjà actif vers l'autonomie de paiement à 18 ans (pas de nouveau compte, juste levée des restrictions de paiement liées à `sv_age_bracket`).
- `renew_season_membership`, `move_player_to_team` — écrit `season_membership_renewals`, crée/ferme les `team_memberships` en conséquence.
- `suspend_player_access` — admin ou éducateur (demande), effective seulement côté admin.
- `report_media` — insert `media_reports`, notifie club (`notify_coach`/`notify_player` internes via `family_notifications`).
- `create_team_project`, `approve_team_project` — création par éducateur/resp. équipe/admin/président (mappé sur `club_members.role`), validation par `is_club_admin` uniquement.
- `create_team_contribution_checkout` — **dépend du risque §9** ci-dessous, voir alternative proposée.
- `sync_personal_service_to_portal` — voir §9.

---

## 7. Interfaces / routes (mapping avec l'existant)

Club+ est une SPA mono-fichier (`app.html`) pilotée par `S.view`/`switchView`/`renderContent`, pas de routeur d'URLs séparé — donc les « routes » du prompt (`/mon-equipe/demandes-acces`, `/joueurs-et-familles`, `/rejoindre-un-club`) deviennent de nouvelles valeurs de `S.view` plutôt que de vraies URLs, cohérent avec l'existant (aucune vue actuelle n'a d'URL dédiée). Le site public (`SportVision-Club-Plus.html`) reçoit un nouvel écran `rejoindre-un-club` à côté de Connexion/Inscription (parcours spontané, §7 du prompt) — pas une inscription dirigeant.

Nouvelles vues app.html, réutilisant le patron `tplX()`/`realX`/`loadRealX()`/`xSource()` déjà en place pour les 17 modules existants :
- Dirigeants : `tplFamillesDemandes` (dans le tableau de bord coach), `tplJoueursEtFamilles` (page admin avec les 11 sous-onglets du §12).
- Joueur : `tplEspaceJoueurAccueil`, calendrier/livrables/services filtrés par `is_family_of_team`, `tplFavoris`.
- Parent : `tplMaFamille` (sélecteur d'enfant, §14), déclinaisons des mêmes vues livrables/calendrier/services avec `player_id` courant en contexte.

---

## 8. Intégration Portail / OS

- **Documents/factures** : aucun changement — un joueur/parent n'a pas accès aux vues `client_*` (réservées au bridge club↔client de la migration v12, qui concerne les dirigeants). Hors périmètre de ce module.
- **Projet collectif** (§19) : `team_projects.catalogue_offre_id` référence `catalogue_offres` (Portail) directement — pas de duplication de catalogue, cohérent avec `club_bookings` existant.
- **Prestation personnelle** (§18) — voir risque §9 ci-dessous, c'est le point d'intégration Portail le plus incertain du module.

---

## 9. Risques et dépendances à trancher avant migration

1. **Commande personnelle self-service vers Portail (§18 du prompt) n'a pas d'équivalent côté Portail aujourd'hui.** Le Portail actuel ne permet au client que d'*accepter/refuser* un devis déjà créé par un membre du staff (`client_decide_devis`) — il n'existe aucun flux où un client crée lui-même un devis/une commande. Deux options :
   - **(a)** Construire un vrai flux self-service côté Portail (nouvelle RPC `client_create_prestation_request` ou équivalent) — travail Portail, hors périmètre Club+, à cadrer séparément.
   - **(b)** Réutiliser tel quel le circuit **`club_bookings`** déjà existant côté Club+ (staff-driven : `recue → qualifiee → confirmee → ...`), en l'ouvrant simplement aux joueurs/parents comme demandeurs (au lieu des seuls dirigeants), sans passer par Portail du tout. Plus rapide, cohérent avec l'existant, mais dévie du texte du prompt (« Club+ → Portail → formulaire prérempli »).
   Recommandation : démarrer avec **(b)** en phase 10 (déjà l'infrastructure existe), basculer vers **(a)** si le volume le justifie. À valider avec toi avant la phase 10.
2. **Paiement des projets collectifs et prestations mineures** : `team_project_contributions.portail_paiement_ref` suppose un moyen de paiement déjà branché (Stripe via Portail ?). Aucun module de paiement direct n'a été identifié dans l'inventaire Club+/Portail lu ici — à confirmer où vit réellement l'intégration Stripe avant la phase 11.
3. **Notifications e-mail/push** : v1 proposée en in-app uniquement (`family_notifications`). Les mentions « e-mail envoyé », « relance au parent » du prompt supposent un envoi réel — à confirmer si Supabase Auth (déjà utilisé pour les invitations) suffit ou s'il faut un fournisseur transactionnel dédié (le repo a un `SETUP-EMAIL.md`, à vérifier).
4. **Textes juridiques des autorisations** : `authorization_types`/`authorization_versions` sont prêtes à recevoir un texte, mais le texte lui-même doit être validé juridiquement avant toute activation en production — la structure ne préjuge pas du contenu.
5. **`media_access_rules` doit être peuplée rétroactivement** pour tout `club_media`/`club_creations` existant, sinon aucune galerie actuelle ne devient visible côté joueur/famille au déploiement (comportement fail-closed voulu, mais implique une action de rattrapage — soit un outil admin de « publier vers Espace Joueur », soit une règle par défaut par équipe à la première consultation).
6. **`role_permissions` (v12)** reste non appliqué (documenté comme tel dans la migration v12) : les nouvelles fonctions `is_team_educateur`/`is_club_admin` de ce module n'en tiennent pas compte non plus, cohérent avec l'état actuel — mais si un jour la matrice est appliquée, il faudra revoir toutes les fonctions RLS de ce module en même temps que celles de l'existant.

---

## 10. Phases de développement (reprend l'ordre du prompt, ajusté aux dépendances identifiées)

1. Tables `player_profiles`/`parent_profiles`/`parent_player_relationships`/`team_memberships` + fonction `sv_age_bracket`.
2. Fonctions RLS (`is_own_player`, `is_confirmed_parent_of`, `is_family_of_team`, `is_team_educateur`) + policies sur les tables de la phase 1.
3. `team_invite_codes`, `player_invitations`, `parent_invitations`, `membership_requests`, `membership_request_events` + RPC associées.
4. `authorization_types`, `authorization_versions`, `parental_authorizations`, `authorization_events` + RPC ; blocage serveur des activations mineures sans autorisation valide.
5. Interfaces éducateur (`tplFamillesDemandes`) et admin (`tplJoueursEtFamilles`).
6. Espace joueur mobile (`tplEspaceJoueurAccueil` + nav bas).
7. Espace parent multi-enfants (`tplMaFamille` + sélecteur).
8. `media_access_rules`, extension policies `club_media`/`club_creations`, `player_favorites`/`favorite_collections`, vue calendrier/livrables filtrée.
9. `media_reports` + interface de signalement/masquage.
10. Décision §9.1 tranchée, connexion services personnels (`club_bookings` élargi ou nouveau flux Portail).
11. `team_projects`, `team_project_contributions`, `team_project_events` (après décision paiement §9.2).
12. `season_membership_renewals` + interface « Préparer la nouvelle saison ».
13. Tests RLS croisés (club A / club B, U15 / U18, mineur sans autorisation) + revue de conformité avant mise en production.

---

## 11. Ce que ce document ne tranche pas

Les points 1 et 2 de la section « Risques » ci-dessus (flux de commande Portail, paiement des projets collectifs) sont des décisions produit, pas seulement techniques — je propose de les trancher avec toi avant de commencer la phase 10/11, le reste (phases 1 à 9) peut démarrer sans attendre puisqu'il ne dépend d'aucun système externe non confirmé.
