# SportVision — PRODUCTION MULTI-CLUBS · V1 STABLE

**Depuis le 10 septembre 2026.** Décision de Fouka, sur la base du GO multi-clubs du même jour.

> « À partir de maintenant, je ralentirais fortement les nouvelles fonctionnalités et je laisserais
> les premiers utilisateurs réels nous dire ce qu'il faut améliorer en V1.1. »

---

## SPORTVISION MULTI-CLUBS V1 — RELEASE VALIDÉE

**10 septembre 2026, 14h05 (Paris).** Commit déployé : `16a46a7` sur `main` (OS vérifié par
`version.json`, Connect vérifié par le correctif iPhone constaté en ligne).

**Paiement live de validation** — galerie « Essai paiement réel — 10/09 », formule 2 photos :

| Étape | Constat |
|---|---|
| Stripe | `pi_3UE6aZCWWD3TQ2oU0tIZWKgd`, `livemode: true`, **1,50 € encaissés par carte** |
| Webhook | `checkout.session.completed`, `payment_intent.succeeded`, `charge.succeeded` livrés ; **1 commande, 1 droit, 2 lignes** — aucun double traitement |
| Commande | payée, attribuée au bon lien et à la bonne formule, hors statistiques (lien d'essai) |
| Droit | 1 droit invité de 30 jours couvrant exactement les 2 photos ; 3ᵉ photo refusée |
| E-mail | `galerie.commande_prete` parti via Brevo — vers `sportvisionalytic@gmail.com`, **adresse saisie avec une faute** : réception non constatée pour cet envoi (le même gabarit a été reçu le 08/09) |
| Original | téléchargeable avec le droit, **HTTP 400 en accès public** |
| ZIP | exactement 2 fichiers, archive valide |
| Remboursement | `re_3UE6aZCWWD3TQ2oU0Q5VusVw` par Stripe ; le **webhook** passe la commande en « refunded » 1 s après — aucune écriture manuelle en base |
| Droits après remboursement | expirés ; original refusé, ZIP en **410** « Cette commande a été remboursée » |
| Galerie de validation | lien désactivé, album archivé ; nouvel achat refusé ; **0 session Stripe ouverte** |

**Compte Admin** : mot de passe **conservé à la demande du propriétaire**. Seule session : navigateur
humain, 12h26, même IP que le poste du propriétaire ; les 8 sessions ouvertes par les tests ont été
révoquées.

**Trouvé et corrigé pendant le paiement réel (P1)** : sur iPhone, le formulaire de paiement se
fermait pendant la saisie de l'e-mail — champs en 14 px (zoom automatique de Safari) et voile qui
fermait tout au moindre toucher. Invisible en émulation, révélé par un vrai téléphone.

**P0 : 0 · P1 bloquant : 0 · 36/36 suites SQL · vérification JWT des fonctions : conforme.**

**Corrigé après la release, à la demande de Fouka (même jour)** : le formulaire de paiement demande
désormais de **confirmer l'adresse e-mail** — « Payer » reste inactif tant que les deux ne
correspondent pas, ce qui aurait bloqué la faute du paiement de validation — et suggère la bonne
orthographe des domaines courants (« gmial.com » → « gmail.com ? »). Le test du filigrane, qui ne
surveillait plus rien depuis l'archivage de sa galerie, fabrique désormais sa propre galerie
témoin filigranée par le code de l'OS, et rougit sur une galerie sans filigrane.

**V1 gelée : uniquement P0/P1 et retours des premiers clubs.**

---

## Ce que veut dire « V1 stable »

La plateforme est prouvée. Le prochain test n'est plus technique : c'est la **charge
opérationnelle simultanée** de plusieurs clubs, CM, coachs, joueurs, parents et productions.

**Règle de gel.** On ne touche plus au produit que pour :

- un **P0** — une donnée exposée, un paiement perdu, un accès qui s'ouvre au mauvais public ;
- un **P1** — un parcours principal qui bloque un vrai utilisateur.

Tout le reste va dans la liste V1.1, et c'est l'usage réel qui décide de son ordre.

## Montée en charge

1. **1 ou 2 nouveaux clubs**, pas davantage.
2. **Observation** : ce que les vrais utilisateurs font, où ils bloquent, ce qu'ils demandent.
3. Puis davantage — pas parce que la plateforme est fragile, mais parce que la charge
   opérationnelle se découvre à l'usage, pas en test.

## Avant le prochain onboarding massif : un paiement réel

La chaîne de paiement est prouvée jusqu'à la session Stripe et jusqu'au fichier signé. Il reste à
la voir **encaisser**, avec une vraie carte. Galerie d'essai prête, hors statistiques :

- **Lien** : fourni à Fouka le 10/09/2026 (galerie « Essai paiement réel — 10/09 », 6 images
  neutres, formule « 2 photos » à 1,50 €).
- **Geste** : choisir 2 photos, payer avec une vraie carte et une adresse e-mail relevée.
- **Vérification**, après le paiement :

  ```bash
  bash tests/galerie-paiement-multi-offres.verif.sh <adresse-utilisee> essai-paiement-reel
  ```

  Le script ne crée rien et ne modifie rien. Il retrace : débit réel → webhook → commande payée →
  droit créé → e-mail parti → original téléchargeable → photo non achetée refusée → archive ZIP
  valide → vente attribuée à la bonne formule.
- **Ensuite** : remboursement par Stripe, jamais par suppression en base.

## Avant toute modification, même un P0

Les suites se relancent en quelques minutes et ont toutes été vues rouges avant d'être vertes :

```bash
# base — 34 suites, chacune fabrique son décor et l'annule
for f in tests/*.test.sql; do …API Management… "$f"; done

# navigateur et API, sur les sites déployés
node tests/clubplus-calendrier-gros-volume.test.mjs     # 1204 événements, 390/768/1440
node tests/clubplus-matchcenter.test.mjs                # saisie → propagation, état restauré
node tests/clubplus-president-parcours.test.mjs         # 21 écrans
node tests/clubplus-president-facturation-saison.test.mjs # facturation client, transition, coach refusé
node tests/clubplus-assistant-et-echap.test.mjs         # assistant réservé au CM, Échap
node tests/connect-joueur-parent-parcours.test.mjs      # les deux parcours famille
node tests/clubplus-hydratation-deployee.test.mjs       # 18 chargements directs
node tests/os-adresse-ecrans.test.mjs                   # données personnelles des collaborateurs
bash tests/galerie-checkout.test.sh                     # chaîne de paiement, 18 contrôles
node tests/galerie-filigrane-public.test.mjs            # filigrane mesuré sur les fichiers servis (galerie témoin)
node tests/galerie-checkout-email.test.mjs              # formulaire de paiement sur iPhone : 16 px, voile, confirmation
node tests/accessibilite-pages-publiques.test.mjs       # axe WCAG AA sur 9 écrans + paiement au clavier
node tests/os-lien-invitation.test.mjs                  # invitation et lien magique de l'OS
```

## Déployer une fonction serveur

**Toujours** par :

```bash
bash scripts/deployer-fonction.sh <nom-de-la-fonction>
```

Huit fonctions tournent sans vérification JWT, volontairement (webhooks Stripe et Youtrust, achat
et téléchargement par un invité, cron). Un `supabase functions deploy` nu repasse ce réglage à
`true` : pour `stripe-webhook`, c'est la fin de tous les paiements, sans alarme. Le script relit le
réglage réel et le reproduit.

## Liste V1.1 — à ordonner par l'usage réel

| Sujet | État au 10/09/2026 |
|---|---|
| Parent, après acceptation | **Fait.** Le parent lit « Vous êtes rattaché à {enfant} » ; le joueur garde « Le club doit encore valider votre adhésion ». Contrôlé par `connect-joueur-parent-parcours`. |
| E-mails d'invitation Club+ | **Fait.** Passent par la file d'envoi (`notification_outbox`, gabarit `clubplus.invitation`, Brevo) : relance et suivi. Vérifié de bout en bout, e-mail reçu, jeton conforme. |
| Liens magiques OS | **Fait.** Un `magiclink` fait entrer directement dans l'OS, sur le bon compte, sans fenêtre de mot de passe. Contrôlé par `os-lien-invitation` (vu rouge sur la version d'avant). |
| Accessibilité | **Premier passage fait** (axe-core, WCAG 2.1 AA) sur Connect, la galerie, le paiement et quatre écrans Club+ : aucun champ sans étiquette ni bouton sans nom ; contrastes insuffisants corrigés ; fenêtre de paiement utilisable au clavier et annoncée aux lecteurs d'écran. **Non couvert** : l'OS, les écrans Club+ au-delà des quatre mesurés, un vrai lecteur d'écran (VoiceOver). |
| Assistant d'onboarding | État d'installation léger pour le président : **non construit**, volontairement. À décider quand les premiers présidents l'utiliseront. |

**Incident du 10/09, 14h27 (Paris).** Un redéploiement de `clubplus-envoyer-invitation`
contenait une double déclaration : la fonction ne démarrait plus (BOOT_ERROR). Invitations Club+
par e-mail en panne **environ 40 secondes** (déployée à 14:27:00, version précédente rétablie à
14:27:41), vu par le test d'envoi lancé juste après. Cause : un
contrôle de types fait à la main qui ne vérifiait rien. Depuis, `scripts/deployer-fonction.sh`
exécute `deno check` et refuse d'envoyer une fonction qui ne compile pas.

## Décisions actées le 10/09/2026

- **4,00 € du test du 07/09 remboursés** par Stripe (`pyr_1UE4wgCWWD3TQ2oUwvOD2ZvE`). Les quatre
  commandes, leurs six lignes et leurs quatre droits restent en base ; la commande passe en
  « refunded ».
- **Téléphone** visible entre collaborateurs SportVision, jamais côté club ni famille. Adresse,
  ville, véhicule et permis réservés à l'Admin et à la Production.
- **Compte Admin** sur `contact@sportvision-an.fr` (l'ancienne adresse appartenait à un domaine
  tiers). Anciennes sessions révoquées ; le nouveau mot de passe est choisi par Fouka seul.
- **Assistant d'onboarding** réservé au CM SportVision et à l'administration.
