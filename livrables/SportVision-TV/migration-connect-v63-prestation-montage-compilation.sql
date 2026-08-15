-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v63
-- Prestation "Montage Compilation" + branchement des remises Agent (montage_pct / monthly_pct).
--
-- Contexte (15/08/2026) : migration-connect-v57-abonnement-agent.sql a posé le contrat de lecture
-- connect_agent_discount(p_user_id) — DÉJÀ EN PROD, NON MODIFIÉE ICI — qui renvoie les deux
-- remises de l'abonnement payant "Agent / représentant" :
--   montage_pct : -5% permanent sur "Montage Compilation", dès le palier Starter.
--   monthly_pct : -10% une fois par période de facturation, sur UNE prestation au choix
--                 (n'importe laquelle du catalogue), palier Pro uniquement.
-- Ces deux remises n'avaient encore aucune prestation à quoi s'accrocher : "Montage Compilation"
-- n'existait pas dans `catalogue_offres`. C'est l'objet de cette migration.
--
-- Spécification produit (verbatim Fouka, conversation précédente) : le client envoie ses rushs
-- vidéo, déjà pré-découpés, jusqu'à 6 minutes maximum de rush au total. SportVision les monte en
-- une compilation. Si le rush dépasse 6 minutes, le tarif passe à 80€ (palier supérieur).
--
-- ⚠️ PRIX PROVISOIRE — À CONFIRMER AVEC FOUKA. Citation exacte : "le prix je sais pas j'ai mis ça
-- comme ça, le palier aussi" — donc le prix de base (39,90 € HT) ET le seuil de 6 minutes sont
-- des valeurs de départ, pas des tarifs validés commercialement. Les DEUX valeurs modifiables en
-- UN SEUL ENDROIT : la ligne UPDATE tout en bas de cette migration (ou directement dans Supabase
-- → Table Editor → catalogue_offres → ligne slug='montage-compilation', colonnes prix_ht et
-- tarif_palier). Le palier "80€ si rush > 6 min" est structuré en jsonb (colonne dédiée
-- `tarif_palier`, voir §1) plutôt que seulement décrit en texte, pour rester exploitable par le
-- frontend et par create-checkout-session (jamais un prix recalculé depuis un texte libre).
--
-- Ce que cette migration fait :
--   1. Ajoute `catalogue_offres.tarif_palier` (jsonb, nullable) — structure générique
--      { seuil_minutes, prix_ht_au_dela } pour un tarif à palier basé sur une durée déclarée par
--      le client. Nullable et sans effet sur les offres existantes (aucune n'en a besoin).
--   2. Ajoute `prestations.duree_rush_minutes` (integer, nullable) — durée totale de rush
--      déclarée par le client à la création de la demande (Montage Compilation uniquement, NULL
--      pour toute autre prestation). Déclaratif, jamais une détection automatique (hors scope,
--      cf. brief).
--   3. Insère la ligne catalogue "Montage Compilation" (categorie 'video' — 'montage' n'est PAS
--      une valeur autorisée par le check constraint de catalogue_offres, et le brief demande
--      explicitement 'video'). Idempotent via ON CONFLICT (slug) DO NOTHING : si cette migration
--      est rejouée après que Fouka ait déjà ajusté le prix depuis l'OS/Table Editor, on ne
--      l'écrase pas.
--
-- Ce que cette migration NE fait PAS (branché côté edge functions, pas en SQL) :
--   - La consommation de connect_agent_discount() au moment du paiement (recalcul serveur du
--     montant final, jamais un montant transmis par le client) : create-checkout-session/index.ts.
--   - La capture du champ "durée du rush" dans le wizard de commande : connect-player-
--     prestations/index.ts (action create_request) + ReservationWizardParticulier.tsx.
--   - La consommation de monthly_discount_used_at APRÈS confirmation du paiement par le webhook
--     Stripe (jamais avant, jamais côté client) : stripe-webhook/index.ts.
-- Voir l'en-tête de chacun de ces 3 fichiers pour le détail.
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor. Idempotente
-- (add column if not exists, insert ... on conflict do nothing) : peut être rejouée sans effet de
-- bord. Ne modifie ni ne redéfinit connect_agent_discount()/connect_agent_subscriptions (migration-
-- connect-v57, déjà en prod).
-- ============================================================


-- ────────────────────────────────────────────────────────────────────────
-- 1. TARIF À PALIER (catalogue_offres) — générique, réutilisable au-delà de Montage Compilation
-- ────────────────────────────────────────────────────────────────────────
--
-- Structure : { "seuil_minutes": 6, "prix_ht_au_dela": 80.00 } — au-delà de `seuil_minutes`
-- minutes de rush déclarées (prestations.duree_rush_minutes, §2), le prix de base HT de l'offre
-- (prix_ht) est remplacé par `prix_ht_au_dela` (jamais additionné). NULL pour toute offre à tarif
-- simple (l'immense majorité du catalogue) — create-checkout-session ne consulte cette colonne
-- que si elle est non NULL.
alter table catalogue_offres add column if not exists tarif_palier jsonb;

comment on column catalogue_offres.tarif_palier is
  'Tarif à palier basé sur une quantité déclarée par le client (ex. durée de rush en minutes). '
  'Structure : {"seuil_minutes": n, "prix_ht_au_dela": montant}. NULL = tarif simple (prix_ht seul).';


-- ────────────────────────────────────────────────────────────────────────
-- 2. DURÉE DE RUSH DÉCLARÉE (prestations) — déclaratif, saisi par le client à la commande
-- ────────────────────────────────────────────────────────────────────────
alter table prestations add column if not exists duree_rush_minutes integer;

comment on column prestations.duree_rush_minutes is
  'Durée totale de rush déclarée par le client (minutes) — Montage Compilation uniquement pour '
  'l''instant. Déclaratif (pas de détection automatique de durée vidéo, hors scope). NULL pour '
  'toute prestation qui ne l''utilise pas.';


-- ────────────────────────────────────────────────────────────────────────
-- 3. CATALOGUE — "Montage Compilation"
-- ────────────────────────────────────────────────────────────────────────
--
-- categorie = 'video' (imposé par le check constraint de catalogue_offres : 'montage' n'existe
-- pas dans la liste autorisée — voir migration-portail-v1.sql §3 — et le brief demande
-- explicitement 'video'). tarif_type = 'fixe' : prix_ht ci-dessous (PROVISOIRE) est la base
-- "≤ 6 min de rush" ; tarif_palier porte le palier "> 6 min" (80 € HT, PROVISOIRE lui aussi).
-- options = '[]' : aucune option additionnelle à cocher pour cette offre (contrairement à
-- match-photo/match-video qui proposent Veo/Drone en options).
insert into catalogue_offres (
  slug, nom, categorie, description, description_longue,
  tarif_type, prix_ht, duree_estimee, livrables_inclus, options, tarif_palier, actif, ordre
) values (
  'montage-compilation',
  'Montage Compilation',
  'video',
  'Envoyez vos rushs déjà pré-découpés (6 minutes de rush maximum au total), SportVision les monte en une compilation prête à partager.',
  'Vous filmez et pré-découpez vos meilleures actions, SportVision assemble le tout en une seule '
  || 'vidéo montée. Jusqu''à 6 minutes de rush au total inclus dans le tarif de base ; au-delà, '
  || 'le tarif passe automatiquement au palier supérieur (voir le récapitulatif avant paiement).',
  'fixe',
  39.90, -- ⚠️ PRIX PROVISOIRE HT — à confirmer avec Fouka avant tout lancement public de cette offre.
  '5-7 jours',
  '1 vidéo compilation montée, musique libre de droits, export HD',
  '[]',
  jsonb_build_object('seuil_minutes', 6, 'prix_ht_au_dela', 80.00), -- ⚠️ PALIER PROVISOIRE lui aussi (cf. citation Fouka en en-tête).
  true,
  50
)
on conflict (slug) do nothing;

-- ============================================================
-- FIN. Résumé des actions manuelles requises après relecture :
--
--   1. Exécuter ce fichier entier dans Supabase → SQL Editor (idempotent).
--
--   2. Valider avec Fouka le prix de base (39,90 € HT) et le seuil du palier (6 min / 80 € HT) —
--      TOUS DEUX PROVISOIRES. Pour les modifier après coup, un seul endroit :
--        update catalogue_offres
--        set prix_ht = <nouveau_prix_base_ht>,
--            tarif_palier = jsonb_build_object('seuil_minutes', <nouveau_seuil>, 'prix_ht_au_dela', <nouveau_prix_ht>)
--        where slug = 'montage-compilation';
--      (ou directement dans Supabase → Table Editor → catalogue_offres, colonnes prix_ht /
--      tarif_palier — aucun autre endroit du code ne stocke ce prix en dur.)
--
--   3. Redéployer les 3 Edge Functions modifiées par le chantier associé à cette migration
--      (voir leur en-tête pour le détail exact) :
--        connect-player-prestations, create-checkout-session, stripe-webhook
--
--   4. Aucun nouveau secret, aucun nouveau Price Stripe requis — cette prestation est un paiement
--      ponctuel (mode "payment", comme le reste du catalogue), pas un abonnement récurrent.
-- ============================================================
