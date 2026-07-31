# Setup — Mise en ligne de SportVision Portail

Durée estimée : ~30 minutes. Le Portail est un fichier statique unique, même logique de déploiement que l'OS, mais sur un site Netlify séparé et un nom de domaine différent.

---

## Étape 1 — Base de données

Dans Supabase → projet **lulgezzpvrlbftbykzrc** → **SQL Editor**, exécuter dans l'ordre (si pas déjà fait) :

1. `livrables/SportVision-TV/migration-portail-v1.sql`
2. `livrables/SportVision-TV/migration-portail-v2.sql`
3. *(optionnel mais recommandé pour tester tout de suite)* `livrables/SportVision-TV/migration-portail-seed.sql` — ajoute 7 prestations de démonstration au catalogue, à ajuster ensuite avec les vrais tarifs SportVision directement dans **Table Editor → catalogue_offres**.

---

## Étape 2 — Edge Functions

En plus des 3 fonctions Stripe (voir `SETUP-STRIPE.md`), déployer une 4ᵉ fonction :

| Nom (exactement) | Fichier source |
|---|---|
| `create-guest-request` | `livrables/SportVision-TV/supabase/functions/create-guest-request/index.ts` |

Pas de secret supplémentaire nécessaire (elle utilise les variables déjà présentes par défaut).

Récapitulatif des 4 fonctions à avoir en ligne : `portal-onboarding`, `create-checkout-session`, `stripe-webhook`, `create-guest-request`.

---

## Étape 3 — Créer le site Netlify du Portail

Le Portail doit être un **site Netlify distinct** de celui de l'OS (domaine différent), même s'il vit dans le même dépôt GitHub. Son code vit dans un dossier séparé, `livrables/SportVision-Portail/`, spécifiquement pour éviter tout conflit de configuration Netlify avec le dossier `livrables/SportVision-TV/` de l'OS (les deux sites pointant vers le même dossier de publication créait des redirections qui se marchaient dessus).

1. Netlify → **Add new site** → **Import an existing project** → sélectionner le même dépôt GitHub que l'OS
2. Dans **Project configuration → Build & deploy → Build settings** de ce nouveau site :
   - **Base directory** : `livrables/SportVision-Portail`
   - **Build command** : laisser vide
   - **Publish directory** : `.`
3. Déployer

Le `netlify.toml` propre à ce dossier gère déjà la redirection : le Portail s'affiche directement à la racine du domaine, sans rien à configurer de plus.

**Important** : ne jamais modifier le Base directory / Publish directory du site Netlify de l'OS (celui qui utilise le `netlify.toml` à la racine du dépôt) — ces deux sites doivent chacun rester sur son propre dossier isolé.

---

## Étape 4 — Nom de domaine

Netlify → ce nouveau site → **Domain management** → **Add a domain**, par exemple `portail.sportvision.fr`. Suivre les instructions DNS affichées (en général un enregistrement CNAME chez ton registrar).

Une fois le domaine actif, mettre à jour le secret `PORTAL_URL` dans Supabase → Edge Functions → Secrets avec cette adresse définitive (utilisée pour les redirections Stripe après paiement).

---

## Étape 5 — Test de bout en bout

Avec le catalogue de démo en place :

1. **Visiteur → compte** : Accueil → Nos prestations → choisir une prestation → configurateur → envoyer sans compte → créer un compte avec le même e-mail → vérifier que la demande apparaît dans "Mes demandes"
2. **Client connecté** : se connecter → Nouvelle demande → vérifier qu'elle apparaît immédiatement dans l'OS (onglet Prestations, statut "Demande reçue")
3. **Devis** : dans l'OS, créer et envoyer un devis sur cette prestation → vérifier qu'il apparaît dans Portail → Devis → cliquer Accepter → vérifier le changement de statut côté OS
4. **Paiement** : depuis le devis accepté, cliquer "Payer l'acompte" → carte de test Stripe `4242 4242 4242 4242` → vérifier le retour sur le Portail, le statut de la facture, et la mise à jour de `prestations.acompte_recu` dans l'OS
5. **Annulation** : créer une nouvelle demande de test, l'annuler depuis le Portail, vérifier que son statut passe à "Annulée" dans l'OS

Voir aussi `TESTING.md` pour la liste complète des scénarios prévus par le handoff de design (certains, comme les contrats/signature électronique et Club+, restent à construire dans une prochaine itération).

---

## Ce qui n'est pas encore construit dans cette première version

Pour rester honnête sur le périmètre livré : le configurateur actuel est simplifié par rapport à la maquette (un seul écran d'informations complémentaires générique, pas de champs spécifiques par catégorie type "adversaire"/"stade" pour un match). La messagerie est un fil unique par client plutôt que des conversations séparées par interlocuteur. Les pages Réalisations, À propos, FAQ, Aide et Notifications ne sont pas encore construites. Les contrats et la signature électronique ne sont pas implémentés. Rien de tout cela n'est bloquant pour tester le flux principal (catalogue → demande → devis → paiement → suivi), mais à prévoir pour la suite si tu veux la parité complète avec la maquette.
