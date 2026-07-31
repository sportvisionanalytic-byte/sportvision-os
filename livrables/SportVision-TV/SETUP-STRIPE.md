# Setup — Paiements Stripe pour SportVision Portail

Durée estimée : ~20 minutes.

---

## Étape 1 — Récupérer tes clés Stripe

1. Va sur [dashboard.stripe.com](https://dashboard.stripe.com)
2. Reste en **mode test** pour l'instant (bouton en haut à droite) — on passera en mode live une fois que tout fonctionne
3. **Développeurs** → **Clés API**
4. Copie la **Clé secrète** (`sk_test_...`)

---

## Étape 2 — Déployer les 3 Edge Functions dans Supabase

Dans Supabase → ton projet **lulgezzpvrlbftbykzrc** → **Edge Functions** → **Create a new function**, pour chacune des 3 fonctions :

| Nom de la fonction (exactement) | Fichier source |
|---|---|
| `portal-onboarding` | `livrables/SportVision-TV/supabase/functions/portal-onboarding/index.ts` |
| `create-checkout-session` | `livrables/SportVision-TV/supabase/functions/create-checkout-session/index.ts` |
| `stripe-webhook` | `livrables/SportVision-TV/supabase/functions/stripe-webhook/index.ts` |

Colle le contenu du fichier correspondant, **Deploy**.

**Important pour `stripe-webhook` uniquement** : dans les settings de cette fonction, désactive **"Verify JWT"** (Stripe n'envoie pas de token Supabase, il a sa propre signature).

---

## Étape 3 — Ajouter les secrets

Supabase → **Edge Functions** → **Secrets** (partagés par toutes les fonctions du projet) :

| Nom | Valeur |
|-----|--------|
| `STRIPE_SECRET_KEY` | La clé secrète copiée à l'étape 1 (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Voir étape 4 ci-dessous |
| `PORTAL_URL` | L'adresse du Portail une fois en ligne (ex : `https://portail.sportvision.fr`) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont déjà disponibles automatiquement dans toutes les Edge Functions du projet, rien à ajouter.

---

## Étape 4 — Créer le webhook côté Stripe

1. Stripe Dashboard → **Développeurs** → **Webhooks** → **Ajouter un point de terminaison**
2. URL : `https://lulgezzpvrlbftbykzrc.supabase.co/functions/v1/stripe-webhook`
3. Événements à écouter : `checkout.session.completed` et `payment_intent.payment_failed`
4. Une fois créé, Stripe affiche une **clé de signature** (`whsec_...`) → copie-la dans le secret `STRIPE_WEBHOOK_SECRET` (étape 3)

---

## Étape 5 — Tester

Avec la clé Stripe en mode test, utilise une carte de test (`4242 4242 4242 4242`, n'importe quelle date future, n'importe quel CVC) depuis le parcours de paiement du Portail. Vérifie dans Supabase → Table Editor :
- une ligne dans `paiements` passe de `en_attente` à `reussi`
- la `prestations` liée voit `acompte_recu` ou `statut_financier` mis à jour
- une ligne apparaît dans `stripe_events` et `document_events`

---

## Passage en production

Une fois les tests validés : bascule Stripe en mode **Live**, régénère une clé secrète live (`sk_live_...`) et un webhook live avec sa propre clé de signature, remplace les deux secrets `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` dans Supabase par les versions live. Ne mélange jamais une clé test avec un webhook live ou l'inverse.

---

## En cas d'erreur

| Message | Cause | Solution |
|---------|-------|----------|
| "Signature invalide" | Mauvais `STRIPE_WEBHOOK_SECRET`, ou "Verify JWT" encore actif sur la fonction | Vérifier le secret et désactiver Verify JWT sur `stripe-webhook` |
| "STRIPE_SECRET_KEY non configurée" | Secret manquant | Refaire l'étape 3 |
| "Compte client introuvable" | Le client n'est pas passé par `portal-onboarding` avant de payer | Vérifier que l'onboarding s'exécute bien à l'inscription |
| "Non autorisé" sur create-checkout-session | Le devis/la prestation ne correspond pas au client connecté | Vérifier le `client_id` transmis côté Portail |
