# Setup — Connexion WhatsApp (Meta Cloud API)

Durée estimée : ~20 minutes. Gratuit (Meta Cloud API, pas de prestataire tiers).

Important : ceci connecte l'envoi/réception de **messages** WhatsApp à l'OS. Les **appels**
ne sont pas possibles — Meta ne les expose pas via l'API Business, uniquement dans l'app
WhatsApp elle-même.

Ton app "WhatsApp Business" actuelle (celle sur ton téléphone) ne suffit pas : il faut
activer la "WhatsApp Business Platform" (l'API), un produit différent mais gratuit,
géré depuis Meta for Developers.

---

## Étape 1 — Créer une app Meta for Developers

1. Va sur [developers.facebook.com](https://developers.facebook.com) → connecte-toi avec ton compte Facebook/Meta
2. **My Apps** → **Create App**
3. Type d'app : **Business**
4. Nom de l'app : "SportVision OS" (ou ce que tu veux)
5. Associe-la à ton compte **Meta Business** (crée-en un sur [business.facebook.com](https://business.facebook.com) si tu n'en as pas déjà un pour SportVision)

## Étape 2 — Ajouter le produit WhatsApp

1. Dans le tableau de bord de l'app → **Ajouter un produit** → **WhatsApp** → **Configurer**
2. Meta te donne automatiquement un **numéro de test** gratuit pour commencer (tu peux passer à ton vrai numéro professionnel plus tard, ça demande une vérification supplémentaire)
3. Note ces 3 informations, visibles dans **WhatsApp → Démarrage rapide** :
   - **Phone Number ID**
   - **WhatsApp Business Account ID**
   - **Temporary access token** (valide 24h — à l'étape 4 on le remplace par un token permanent)

## Étape 3 — Générer un token permanent

Le token temporaire expire en 24h, il faut un token permanent pour la production :

1. Meta Business Settings → **Utilisateurs système** → **Ajouter** → crée un utilisateur système "SportVision OS" avec le rôle **Admin**
2. Assigne-lui l'app "SportVision OS" et le compte WhatsApp Business avec les permissions **whatsapp_business_messaging** et **whatsapp_business_management**
3. Génère un **token** pour cet utilisateur système, durée **Jamais** (permanent)
4. **Copie ce token** — c'est celui qu'on utilisera dans Supabase

## Étape 4 — Déployer les Edge Functions dans Supabase

Deux fonctions seront nécessaires (je les écrirai une fois que tu as les identifiants ci-dessus) :
- `send-whatsapp-message` : envoyer un message depuis l'OS
- `whatsapp-webhook` : recevoir les messages entrants des clients/collaborateurs

Pour le webhook, Meta exige une URL publique HTTPS qui répond à sa vérification — l'URL
d'une Edge Function Supabase déployée convient parfaitement
(`https://lulgezzpvrlbftbykzrc.supabase.co/functions/v1/whatsapp-webhook`).

## Étape 5 — Secrets à ajouter dans Supabase

| Nom | Valeur |
|-----|--------|
| `WHATSAPP_PHONE_NUMBER_ID` | Depuis l'étape 2 |
| `WHATSAPP_ACCESS_TOKEN` | Le token permanent de l'étape 3 |
| `WHATSAPP_VERIFY_TOKEN` | Une chaîne que tu inventes toi-même (ex: un mot de passe aléatoire), utilisée par Meta pour vérifier le webhook |

---

## Ce qu'il me faut de toi pour que je code la suite

Une fois les étapes 1 à 3 faites, donne-moi :
1. Le **Phone Number ID**
2. Le **WhatsApp Business Account ID**
3. Confirmation que le token permanent est généré (pas besoin de me le copier ici en clair si tu préfères — tu peux directement l'ajouter comme secret Supabase, je saurai l'utiliser)
4. **À qui ces messages doivent servir** : plutôt communication avec les clients (clubs/parents, intégré à la fiche client CRM), plutôt communication interne (équipe, en plus de la messagerie actuelle), ou les deux ?

---

## En cas de blocage

| Problème | Cause probable |
|----------|-----------------|
| Pas de compte Meta Business | Créer un compte sur business.facebook.com, gratuit |
| "Vérification business requise" pour un vrai numéro | Normal pour sortir du numéro de test — peut prendre quelques jours, le numéro de test suffit pour développer/tester en attendant |
| Token qui expire après 24h | Tu as utilisé le token temporaire au lieu du token permanent (étape 3) |
