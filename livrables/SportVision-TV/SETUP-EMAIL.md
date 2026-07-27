# Setup — Envoi d'emails depuis l'OS

Durée estimée : ~10 minutes. Aucun code à écrire, juste de la configuration.

---

## Étape 1 — Créer un compte Resend (gratuit)

1. Va sur [resend.com](https://resend.com) → **Sign up** (compte gratuit)
2. Une fois connecté, va dans **API Keys** → **Create API Key**
3. Nomme-le "SportVision OS", donne-lui les droits "Full access"
4. **Copie la clé** (ex: `re_abc123...`) — tu ne pourras plus la revoir après

> Limite gratuite : 3 000 emails/mois, 100/jour. Largement suffisant.

---

## Étape 2 — Déployer l'Edge Function dans Supabase

1. Va sur [supabase.com](https://supabase.com) → ton projet **lulgezzpvrlbftbykzrc**
2. Menu gauche → **Edge Functions** → **Create a new function**
3. Nom de la fonction : **`send-devis-email`** (exactement, sans tiret final)
4. Remplace tout le code par le contenu du fichier :
   `livrables/SportVision-TV/supabase/functions/send-devis-email/index.ts`
5. Clique **Deploy**

---

## Étape 3 — Ajouter les secrets

Dans Supabase → **Edge Functions** → **Secrets** (ou Settings > Secrets) :

| Nom | Valeur |
|-----|--------|
| `RESEND_API_KEY` | La clé Resend copiée à l'étape 1 |
| `FROM_EMAIL` | `SportVision <ton-email@resend-domain.com>` *(optionnel)* |

> Sans `FROM_EMAIL`, les emails partent depuis `onboarding@resend.dev` (fonctionne pour les tests).
> Pour envoyer depuis `@sportvision.fr`, il faut vérifier le domaine dans Resend (DNS).

---

## Étape 4 — Tester

1. Ouvre l'OS → onglet **Devis** (ou **Documents**)
2. Sur n'importe quel devis, clique le bouton **✉**
3. Renseigne ton propre email en destinataire pour tester
4. Clique **Envoyer**

Si tu vois "Email envoyé avec succès !" → tout fonctionne.

---

## Domaine personnalisé (optionnel — pour envoyer depuis @sportvision.fr)

1. Dans Resend → **Domains** → **Add Domain** → entre `sportvision.fr`
2. Resend te donne des entrées DNS à ajouter chez ton registrar (OVH, Namecheap…)
3. Une fois vérifié (~24h), change `FROM_EMAIL` en : `SportVision <contact@sportvision.fr>`

---

## En cas d'erreur

| Message | Cause | Solution |
|---------|-------|----------|
| "Edge Function non déployée" | La fonction n'existe pas encore | Faire l'étape 2 |
| "RESEND_API_KEY non configurée" | Secret manquant | Faire l'étape 3 |
| "Erreur Resend" | Clé invalide ou domaine non vérifié | Vérifier la clé Resend |
