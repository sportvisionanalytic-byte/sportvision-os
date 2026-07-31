# Architecture — Connexion SportVision Portail ↔ SportVision OS

Décisions confirmées : Portail en un seul fichier HTML (même approche que l'OS), identité client dans une table `client_users` séparée de `profiles`, paiement via Stripe Checkout hébergé.

Un seul projet Supabase (`lulgezzpvrlbftbykzrc`), aucune duplication de données. Le Portail lit/écrit dans les mêmes tables que l'OS, avec des policies RLS dédiées côté client.

---

## 1. Nouvelles tables

### `client_users` — identité des comptes clients
```sql
create table if not exists client_users (
  id uuid references auth.users on delete cascade primary key,
  client_id uuid references clients(id) on delete cascade not null,
  prenom text,
  nom text,
  telephone text,
  created_at timestamptz default now()
);
alter table client_users enable row level security;

create policy "cu_self_select" on client_users for select using (auth.uid() = id);
create policy "cu_self_update" on client_users for update using (auth.uid() = id);
create policy "cu_staff_all" on client_users for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','compta'))
);
```
Aucune ligne `client_users` n'existe dans `profiles`, donc tous les checks RLS existants `exists (select 1 from profiles where id = auth.uid())` échouent naturellement pour un client. Fail-closed par défaut sur l'OS, aucune policy existante à toucher.

### `catalogue_offres` — catalogue public
```sql
create table if not exists catalogue_offres (
  id uuid default gen_random_uuid() primary key,
  slug text unique not null,
  nom text not null,
  categorie text check (categorie in ('photo','video','pack','tournoi','stage','shooting','drone','veo','contenu')) not null,
  description text,
  description_longue text,
  image_url text,
  tarif_type text check (tarif_type in ('fixe','sur_devis')) default 'fixe',
  prix_ht numeric(10,2),
  tva_pct numeric(5,2) default 20,
  duree_estimee text,
  livrables_inclus text,
  options jsonb default '[]',
  actif boolean default true,
  ordre integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table catalogue_offres enable row level security;

create policy "catalogue_public_read" on catalogue_offres for select using (actif = true);
create policy "catalogue_staff_write" on catalogue_offres for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com'))
);
```
Distinct du champ libre `prestations.type_prestation` (usage interne) : c'est le catalogue commercial affiché publiquement, avec tarifs et options structurés.

### `paiements` — ledger Stripe
```sql
create type statut_paiement as enum ('en_attente','reussi','echoue','rembourse','annule');

create table if not exists paiements (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id),
  devis_id uuid references devis(id),
  client_id uuid references clients(id),
  type_paiement text check (type_paiement in ('acompte','solde','total')) default 'acompte',
  montant numeric(10,2) not null,
  devise text default 'eur',
  statut statut_paiement default 'en_attente',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text unique,
  recu_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table paiements enable row level security;

create policy "paiements_staff" on paiements for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','compta'))
);
create policy "paiements_client_own" on paiements for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = paiements.client_id)
);
```

### `stripe_events` — idempotence webhook
```sql
create table if not exists stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz default now()
);
```

### `messages_client` — messagerie client ↔ équipe
La table `messages` actuelle relie deux `profiles`, donc inutilisable telle quelle pour un client. Table dédiée plutôt que de complexifier la messagerie interne :
```sql
create table if not exists messages_client (
  id uuid default gen_random_uuid() primary key,
  prestation_id uuid references prestations(id) on delete cascade,
  client_id uuid references clients(id) not null,
  auteur_type text check (auteur_type in ('client','staff')) not null,
  auteur_client_id uuid references client_users(id),
  auteur_staff_id uuid references profiles(id),
  contenu text not null,
  piece_jointe_url text,
  lu boolean default false,
  created_at timestamptz default now()
);
alter table messages_client enable row level security;

create policy "mc_client_own" on messages_client for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id)
);
create policy "mc_client_insert" on messages_client for insert with check (
  auteur_type = 'client'
  and exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id)
);
create policy "mc_staff_all" on messages_client for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','prod'))
);
```

---

## 2. Policies clients à ajouter sur les tables existantes

En complément (OR logique) des policies staff déjà en place, rien à retirer côté OS.

```sql
create policy "prestations_client_own" on prestations for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = prestations.client_id)
);

create policy "devis_client_own" on devis for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = devis.client_id)
);
create policy "devis_client_accept" on devis for update using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = devis.client_id)
) with check (statut in ('accepté','refusé'));

create policy "avoirs_client_own" on avoirs for select using (
  exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = avoirs.client_id)
);

create policy "media_livrables_client_own" on media_livrables for select using (
  statut in ('livre','consulte')
  and exists (
    select 1 from client_users cu join prestations p on p.id = media_livrables.prestation_id
    where cu.id = auth.uid() and cu.client_id = p.client_id
  )
);

create policy "media_livraisons_client_own" on media_livraisons for select using (
  exists (
    select 1 from client_users cu join prestations p on p.id = media_livraisons.prestation_id
    where cu.id = auth.uid() and cu.client_id = p.client_id
  )
);
```

---

## 3. Edge Functions à créer (même pattern que `send-devis-email`)

1. **`portal-onboarding`** — appelée juste après le `signUp` Supabase Auth d'un client. Cherche un `clients` existant par email (cas d'un prospect déjà en base côté OS), sinon en crée un ; crée la ligne `client_users` liée. Nécessaire car un visiteur peut déjà être un prospect connu de l'équipe.
2. **`create-checkout-session`** — reçoit `devis_id` ou `offre_id` + `type_paiement` (acompte/solde/total), calcule le montant, crée une Stripe Checkout Session, retourne l'URL de redirection.
3. **`stripe-webhook`** — écoute `checkout.session.completed` et `payment_intent.payment_failed`. Écrit dans `paiements`, met à jour `prestations.statut_financier` / `acompte_recu` / `statut`, insère un événement dans `document_events`. Idempotent via `stripe_events`.
4. **`send-notification-statut`** (optionnel, phase ultérieure) — email client à chaque changement de statut clé, réutilise le pattern Resend déjà en place.

---

## 4. Point important sur le moment de création de la "commande"

Le parcours décrit crée la commande dans l'OS après paiement (étape 7). Recommandation : créer la ligne `prestations` **dès la demande** (étape 3-4), en statut `demande_reçue` (état déjà prévu dans l'enum `statut_prestation`), pas seulement après paiement. Sinon, toute demande non convertie en paiement (devis refusé, abandon de panier) reste invisible côté OS et l'équipe perd la visibilité commerciale. Le paiement ne fait que faire progresser le statut existant, il ne crée pas la ligne.

---

## 5. Structure du Portail (fichier HTML unique)

Pages / sections (SPA, routing par hash comme probablement l'OS) :

- Accueil commerciale (public)
- Catalogue — lit `catalogue_offres`, public, sans auth
- Fiche offre détaillée (public)
- Réservation / configurateur (date, lieu, options) → crée `prestations` + `devis` en `demande_reçue`
- Demande de devis sur-mesure
- Compte client (Supabase Auth email/mot de passe ou magic link + `portal-onboarding`)
- Suivi commandes — `prestations` du client, statut mappé en libellés simplifiés (5-6 au lieu des 29 internes)
- Devis & factures — liste `devis`, bouton accepter → `create-checkout-session`
- Messagerie — `messages_client`
- Contenus livrés — `media_livrables` / `media_livraisons` où statut livré
- Historique des prestations passées

---

## 6. Roadmap par phases

1. **Fondations backend** : migration SQL (tables + policies ci-dessus), testable indépendamment, aucun impact sur l'OS existant.
2. **Edge Functions** : onboarding, checkout, webhook Stripe.
3. **Portail public** : accueil, catalogue, fiche offre (aucune auth requise).
4. **Portail compte client** : inscription/connexion, réservation, devis, paiement Stripe.
5. **Portail suivi** : commandes, messagerie, livraisons, factures.
6. **Ajustements OS** : afficher l'origine "Portail" sur les prestations entrantes, notifications internes à l'équipe sur nouvelle demande/paiement reçu.

---

## Non traité ici (hors périmètre de cette demande)

SportVision Club+ (plateforme d'abonnement pour la communication des clubs) est un produit distinct, non concerné par cette architecture.

---

## Addendum — intégration du dossier de handoff (design + specs Portail)

Un dossier de handoff complet a été fourni (`SportVision Access.dc.html`, `ROUTES.md`, `PERMISSIONS.md`, `INTEGRATIONS.md`, `DESIGN-SYSTEM.md`, `DATABASE.md`, `API.md`, `CLUB-PLUS-ARCHITECTURE.md`, `TESTING.md`). Ce qui suit reconcilie ce dossier avec la structure réelle de SportVision OS déjà auditée plus haut.

### Le fichier `.dc.html` est une maquette, pas du code à exécuter

Le README du dossier est explicite : ce fichier est un prototype haute-fidélité produit par un outil de design propriétaire (runtime `support.js`, balises `sc-if`/`sc-for`), à traiter uniquement comme référence visuelle, de contenu et de comportement. Il ne doit pas être exécuté tel quel ni sa logique réutilisée. Le choix déjà validé (Portail en un seul fichier HTML, même approche que l'OS) reste donc valable : on reconstruit la même UX en JS natif comme le fait déjà l'OS, sans dépendre de ce runtime. Pas de changement de stack nécessaire malgré la recommandation générique du README ("React/Next.js/Vue ou le stack standard de l'équipe") : ce n'est qu'une des options qu'il laisse ouvertes, et la cohérence avec l'OS prime.

### Le schéma `DATABASE.md` du dossier est générique, pas la réalité de l'OS

`DATABASE.md` propose des tables génériques en anglais (`requests`, `quotes`, `contracts`, `invoices`, `payments`, `deliverables`, `conversations`, `organizations`...) qui ne correspondent pas à ce qui existe réellement dans SportVision OS. Créer ces tables telles quelles reviendrait à dupliquer des données déjà gérées ailleurs, ce que la consigne interdit explicitement. Table de correspondance :

| Concept du dossier | Existe déjà dans l'OS | Action |
|---|---|---|
| `users`, `profiles` (staff) | `auth.users` + `profiles` | Aucune, déjà en place |
| `organizations`, `organization_members` | `clients` (un club = une ligne) | Couvert par `client_users` (plusieurs comptes clients → un seul `client_id`), pas besoin d'une table `organizations` séparée |
| `requests`, `request_status_history` | `prestations` (statut initial `demande_reçue`) + `historique` | Aucune nouvelle table : une "demande" est une `prestations` en tout début de statut, tracée par `historique` (générique, déjà prévu pour ça) |
| `prestations`, `prestation_status_history` | `prestations` + `historique` | Aucune, déjà en place |
| `quotes`, `quote_items` | `devis` (lignes en `jsonb`) | Aucune, déjà en place |
| `contracts`, `signature_requests` | `contrats` (existe mais pensé pour les abonnements récurrents, pas les contrats de mission) | Étendre `contrats` : ajouter `prestation_id`, `statut_signature`, `signataire_nom`, `signe_at`, plutôt que créer une table séparée |
| `invoices`, `invoice_items` | **Rien** — financier géré via des champs sur `prestations` + `avoirs` | **Nouvelle table `factures`** (numérotation, lignes, montants) — nécessaire, l'OS n'a jamais eu de vraie facturation structurée |
| `payments`, `payment_events` | Rien pour les paiements ; `document_events` existe pour le journal | **Nouvelle table `paiements`** (déjà prévue plus haut) ; `payment_events` → réutiliser `document_events` (son `event_type` inclut déjà `'paiement'`) |
| `documents`, `document_versions` | `document_events`, `document_sequences` | Aucune nouvelle table : la page "Documents" du Portail est une vue combinée devis + contrats + factures, pas une table à part |
| `deliverables`, `deliverable_versions`, `deliverable_validations` | `media_livrables`, `media_versions`, `media_validations`, `media_livraisons` | Aucune, déjà en place, presque 1:1 |
| `conversations`, `messages` | `messages` (staff ↔ staff uniquement) | **Nouvelle table `messages_client`** (déjà prévue), pas de table `conversations` séparée : la conversation est implicite par `client_id` |
| `notifications` | `notifications` (staff uniquement) | Pas de nouvelle table stockée côté client : le fil de notifications du Portail est calculé à la volée (derniers événements sur devis/paiements/messages/livraisons), pour éviter un état dupliqué qui se désynchronise |
| `appointments` | Rien | **Nouvelle table `rendez_vous`** (client_id, type, date/heure demandée, statut à confirmer/confirmé/annulé) |
| `subscriptions`, `usage_quotas` | `contrats` (déjà pensé pour ça) | Hors périmètre (Club+), rien à faire maintenant au-delà de colonnes réservées |
| `audit_logs` | Rien | **Nouvelle table `audit_logs`** — nécessaire pour la règle obligatoire du dossier : le mode "voir en tant que client" côté staff doit être audité, jamais une simple bascule silencieuse |

### Correction importante de sécurité : ne pas exposer les tables brutes au Portail

`PERMISSIONS.md` est strict : le Portail ne doit jamais exposer marges, coûts internes, notes internes, affectations d'équipe. Or les policies RLS proposées plus haut (`prestations_client_own`, `devis_client_own`) autorisent le `SELECT` sur la **ligne entière** : RLS filtre les lignes, pas les colonnes. Un client obtiendrait donc aussi `notes_internes`, `responsable_prod_id`, `responsable_prestation_id`, `remise_approuvee_par`, `contrat_signe` sur `prestations`, et les marges internes sur `devis` si elles y étaient un jour ajoutées.

Correction : le Portail ne doit jamais lire les tables `prestations`/`devis` directement. Créer des vues dédiées exposant uniquement les colonnes autorisées, avec leurs propres policies :

```sql
create view client_prestations as
select id, reference, statut, client_id, date_prestation, heure_debut, heure_fin, lieu,
       sport, equipes, description_besoin, livrables_demandes,
       montant_ttc, acompte_montant, acompte_recu, statut_financier, created_at
from prestations;

alter view client_prestations set (security_invoker = true);
-- RLS sur prestations continue de s'appliquer via security_invoker ; ajouter la policy client dessus
```

Même principe pour `client_devis` (masquer `remise_approuvee_par`) et `client_contrats`.

### Colonnes de préparation Club+ (à ajouter maintenant, sans construire Club+)

Conformément à `CLUB-PLUS-ARCHITECTURE.md` : ajouter dès cette migration des colonnes nullables non utilisées pour l'instant, plutôt que de les rajouter plus tard en migration séparée :

```sql
alter table clients add column if not exists club_plus_actif boolean default false;
alter table clients add column if not exists club_plus_plan text;
```

### Plan de migration net (ce qui reste à créer réellement)

`client_users`, `catalogue_offres`, `factures`, `paiements`, `stripe_events`, `messages_client`, `rendez_vous`, `audit_logs`, + extension de `contrats` (colonnes signature) + 2 colonnes Club+ sur `clients` + vues `client_prestations`/`client_devis`/`client_contrats`/`client_factures`. C'est un ajout net, aucune table existante de l'OS n'est modifiée dans sa structure de façon cassante.
