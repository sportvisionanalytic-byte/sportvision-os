# Test manuel de SportVision Connect — checklist 5-10 min

But : je n'ai pas d'outil de navigateur, donc je n'ai jamais pu cliquer réellement dans Connect. Ce que j'ai vérifié (code, syntaxe, cohérence des appels) n'est pas équivalent à un vrai test. Cette checklist couvre en priorité tout ce qui a été ajouté/modifié pendant le retrait du Portail (2026-08-07) — c'est là que le risque de bug réel est le plus élevé.

URL : `livrables/SportVision-Connect/app/index.html` (en local) ou l'URL Netlify/domaine réel de Connect en production.

Coche au fur et à mesure. Si une étape échoue, note ce qui s'est passé exactement (message d'erreur, écran bloqué...) et dis-le-moi — je corrige.

---

## 1. Compte et connexion (base, pas modifié aujourd'hui mais prérequis pour la suite)

- [ ] Créer un compte test (e-mail que tu peux consulter, ex. avec un `+test` : `toi+test1@gmail.com`)
- [ ] Vérifier que le compte se crée sans erreur et qu'on atterrit bien dans l'app

## 2. Mot de passe oublié (nouveau aujourd'hui)

- [ ] Depuis l'écran de connexion, cliquer "Mot de passe oublié ?"
- [ ] Entrer l'e-mail du compte test, envoyer
- [ ] Vérifier qu'un message générique "vérifiez votre boîte mail" s'affiche (que le compte existe ou non, le message doit être identique — c'est voulu, pas un bug)
- [ ] Revenir à l'écran de connexion, recliquer "Mot de passe oublié ?" **une seconde fois** → vérifier qu'on retombe bien sur un formulaire vide (pas le message de confirmation resté affiché — c'est le bug que j'ai trouvé et corrigé, à confirmer que le correctif tient)
- [ ] Chercher l'e-mail reçu (vérifier aussi les spams — l'expéditeur Brevo est encore sur l'adresse Gmail temporaire, cf. mémoire "Communication Hub", possible d'atterrir en spam)
- [ ] Cliquer le lien dans l'e-mail → doit arriver sur Connect (pas le Portail) avec l'écran "Choisir un nouveau mot de passe"
- [ ] Définir un nouveau mot de passe → vérifier qu'on est bien connecté ensuite, pas renvoyé à l'écran de login

## 3. Suppression de compte (nouveau aujourd'hui)

- [ ] Sur le compte test, aller dans le module "Compte"
- [ ] Vérifier que le bouton "Supprimer mon compte" est visible, avec le texte d'avertissement
- [ ] Cliquer, confirmer → vérifier qu'on est bien déconnecté et ramené à l'écran de connexion
- [ ] Essayer de se reconnecter avec ce compte → doit échouer (compte supprimé)

## 4. Liens Portail → Connect côté Club+ (nouveau aujourd'hui)

Depuis `livrables/SportVision-Club-Plus/app.html`, connecté avec un compte club :

- [ ] Sidebar (desktop) : bouton "← SportVision Connect" → doit ouvrir Connect, pas un message "bientôt disponible"
- [ ] Menu "Plus" (mobile) : même bouton → même vérification
- [ ] Paramètres → Intégrations : l'entrée doit dire "SportVision Connect" avec un badge vert "Disponible", plus "SportVision Portail"/orange "À venir"
- [ ] Documents (devis/factures/contrats) : si un document n'a pas de PDF téléchargeable, le bouton "Ouvrir" doit ouvrir Connect, pas un toast "bientôt sur le Portail"

## 5. E-mails automatiques (nouveau aujourd'hui, plus dur à tester seul)

Si tu passes une vraie commande test avec paiement (même un petit montant Stripe en mode test) :

- [ ] L'e-mail de bienvenue reçu après inscription doit afficher "CONNECT" (pas "PORTAIL") et le bouton doit pointer vers Connect
- [ ] L'e-mail de reçu de paiement doit afficher "CONNECT" et pointer vers Connect

---

## Si quelque chose casse

Dis-moi précisément : quelle étape, quel message d'erreur ou quel écran bloqué, et si possible une capture d'écran. Je corrige et je repasse par le même processus (relecture code + resynchronisation avec le repo) avant de te redemander de retester.
