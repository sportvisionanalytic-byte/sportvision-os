# QA fonctionnelle — Réservation → Compte Connect → Achat

Campagne du 30/08/2026. Périmètre : `reserver.html` (tunnel 4 étapes), `demande-de-devis.html` +
modale RDV, et surtout le rattachement compte↔prestation promis par la FAQ vitrine
(`a-propos.html`) entre une demande envoyée sans compte et la création d'un compte SportVision
Connect avec le même e-mail.

Méthode : Playwright (clics/saisies réels, jamais `page.evaluate()`), desktop 1440×900 et mobile
390×844, plus des appels réels aux edge functions et à la base (API Supabase, service role +
Management API) pour vérifier les écritures et reproduire le bug central avant/après correctif.
Comptes/clients/prestations de test créés via l'API Admin Supabase (pattern des campagnes
précédentes), tous nettoyés en fin de mission (vérifié : requête finale = 0 ligne).

## Résumé

| Sujet | Statut |
|---|---|
| Rattachement compte Connect ↔ prestation existante (le point le plus important) | **Bug critique trouvé, corrigé et vérifié en réel** |
| Tunnel `reserver.html` (4 étapes, pré-remplissage, options contextuelles, prix, récap, soumission) | Conforme — aucun bug bloquant trouvé |
| `demande-de-devis.html` + modale RDV | **1 bug trouvé et corrigé** (CTA sticky mobile bloqué par le bandeau cookies) |
| État de succès (pas d'`alert()`) | Conforme sur les 3 formulaires (réservation, devis, RDV) |

---

## 1. Rattachement compte Connect ↔ prestation — bug critique corrigé

### Ce que dit la FAQ (`a-propos.html`)
> "Non. Les prestations ponctuelles se demandent directement, sans créer de compte au préalable.
> Un espace SportVision Connect vous est ensuite proposé pour créer votre accès et récupérer vos
> contenus."

### Bug trouvé

`connect_resolve_beneficiary_client_id(p_kind, p_ref_id)` (fonction SQL `SECURITY DEFINER`,
migration-connect-v51) résout le `client_id` d'un compte Connect personnel (Espace particulier,
ou joueur/sportif sans club). Pour la branche "pas de `player_profiles`, pas de `client_id`
encore rattaché à `connect_profile_settings`" — c'est-à-dire exactement le cas d'un tout nouveau
compte particulier — la fonction allait chercher l'e-mail de l'utilisateur (`auth.users.email`)
**uniquement pour construire un libellé d'affichage**, puis créait **systématiquement** une
nouvelle ligne `clients`, sans jamais vérifier si une ligne `clients` existait déjà pour cet
e-mail. Pire : l'`insert` ne renseignait même pas la colonne `email` sur la nouvelle fiche.

Toutes les autres portes d'entrée du système (`create-guest-request`, `create-guest-rdv`,
`portal-onboarding`, `clubplus-onboarding`) utilisent déjà `find_or_create_client_by_email()`
(recherche par e-mail avec verrou anti-course, avant toute création) — seule cette fonction,
utilisée par le nouveau Connect personnel, avait été écrite avec un `insert` à l'aveugle.

### Reproduction en réel (avant correctif)

1. Appel réel à `create-guest-request` (comme `reserver.html`) avec l'e-mail de test
   `qa-rattachement-30aug-01@sportvision-test.invalid` → référence `SV-2026-0100`, client créé :
   `id 6fd0a8db…`, `email` correctement renseigné.
2. Création d'un compte Supabase Auth réel avec le **même e-mail** (API Admin, `email_confirm:
   true`), connexion réelle (mot de passe), obtention d'un JWT réel.
3. Appel de la RPC `connect_resolve_beneficiary_client_id(kind:"self")` avec ce JWT — exactement
   ce que fait `connect-player-prestations` (action `list_orders`, utilisée par le tableau de
   bord "Mes commandes") au premier chargement.
4. Résultat : la RPC renvoie un **second** `client_id` (`94b6853e…`), différent du premier.
   Vérification en base : deux lignes `clients` pour la même personne, et la nouvelle a
   **`email = NULL`** — impossible à retrouver par la suite par un quelconque rapprochement par
   e-mail. La prestation `SV-2026-0100` reste invisible depuis ce nouveau compte.

### Correctif

Migration `migration-connect-v87-fix-rattachement-client-guest-vers-connect.sql` : remplace les
deux `insert into clients` à l'aveugle par un appel à `find_or_create_client_by_email(v_email,
…)`, avec le message de bienvenue automatique (`messages_client`) désormais posé uniquement si la
fiche est réellement neuve (`_created`), pour ne pas polluer le fil de discussion d'un client déjà
existant. Signature et valeur de retour de la fonction inchangées — aucun appelant à modifier.

**Exécutée et vérifiée en réel sur la base de production** (API Management Supabase, comme les
campagnes précédentes) — pas seulement écrite dans le repo.

### Vérification après correctif (nouveau couple client/compte de test)

1. `create-guest-request` avec `qa-rattachement-30aug-02@sportvision-test.invalid` → référence
   `SV-2026-0101`, client `9d74fb49…`.
2. Compte Connect réel créé avec le même e-mail, connexion réelle.
3. RPC `connect_resolve_beneficiary_client_id(kind:"self")` avec le JWT réel → renvoie
   **exactement** `9d74fb49…` (le même client, pas un doublon).
4. Appel réel à `connect-player-prestations` (action `list_orders`, l'appel exact du tableau de
   bord) avec ce même JWT → renvoie bien la prestation `SV-2026-0101` ("Pack Match Complet",
   160 € estimé) dans la liste des commandes du compte.

**Confirmation explicite : le rattachement compte ↔ prestation fonctionne désormais** pour le
parcours décrit par la FAQ (demande sans compte → création de compte Connect avec le même
e-mail → prestation visible dans "Mes commandes").

Toutes les données de test (clients, prestations, `connect_profile_settings`, comptes
`auth.users`) ont été supprimées après vérification ; requête finale de contrôle = 0 ligne.

### Second problème trouvé sur le même parcours : le CTA "Créer mon espace Connect" n'amenait nulle part d'utile

L'écran de succès de `reserver.html`/`demande-de-devis.html` propose un vrai bouton (pas
d'`alert()`) : `https://connect.sportvision-an.fr/?signup=1&email=<email du visiteur>`. Mais côté
Connect :

- La page racine `/` ne lisait jamais `searchParams`.
- Le middleware d'authentification (`middleware.ts`, route `/` absente de `PUBLIC_PATHS`)
  interceptait la requête **avant** que la page ne s'exécute et redirigeait systématiquement tout
  visiteur non connecté vers `/auth/login`, en perdant `signup`/`email` en pratique (ils
  survivaient dans l'URL mais `/auth/login` ne les lit pas : il ne lit que `next`/
  `confirmation`).
- Résultat : un visiteur qui clique "Créer mon espace Connect" atterrit sur l'écran de connexion
  et doit cliquer "Créer mon compte" puis **retaper lui-même** l'adresse e-mail qu'il venait de
  saisir trois minutes plus tôt.

**Corrigé** (fichiers `livrables/SportVision-Connect/app-connect/src/lib/supabase/middleware.ts`
et `src/app/signup/signup-context.tsx`) : le middleware redirige maintenant directement vers
`/signup?email=…` quand `signup=1` et `email` sont présents sur `/`, et le contexte du tunnel
d'inscription pré-remplit le champ e-mail depuis ce paramètre (sans jamais écraser un tunnel déjà
en cours, repris depuis le `localStorage`).

Vérifié en réel : build de production (`npm run build`, `tsc --noEmit`, 0 erreur), serveur Next
lancé en local avec les vraies clés Supabase, navigation Playwright réelle —
`http://localhost:4321/?signup=1&email=X` atterrit bien sur `/signup` avec le champ e-mail
pré-rempli à `X` ; sans le paramètre `signup`, le comportement historique (`/auth/login`) est
inchangé. Capture d'écran : le champ "Adresse e-mail" de l'étape "Compte" affiche bien l'e-mail
transmis.

---

## 2. Tunnel `reserver.html` — 4 étapes

### Pré-remplissage contextuel (`?besoin=XXX`)

Les **15 slugs** utilisés ailleurs sur le site (`grep` exhaustif sur les 37 pages HTML :
`match-photo`, `match-video`, `pack-match`, `camera-isolee`, `montage-compilation`,
`match-filme-drone`, `combo-drone-photo`, `match-camera-veo`, `combo-veo-photo`, `shooting`,
`couverture-tournoi`, `couverture-stage`, `creation-contenu`, `coach-preparateur`, `media-day`)
ont été testés un par un en réel (navigation Playwright) : chacun sélectionne la bonne carte et
avance directement à l'étape 2, avec le bon libellé d'étape. 0 échec.

### Options contextuelles par besoin (préoccupation spécifique du fondateur)

Vérifié en réel qu'une réservation "Match filmé drone" **n'affiche pas** l'option "Plans drone ou
Véo complémentaires" en doublon — seules "Reel vertical" et "Livraison express" apparaissent.
Testé aussi : "Match photo" (drone/reel/express), "Pack Match Complet" (union
drone/reel/express/interview — comportement documenté dans le code comme correctif d'un trou de
granularité antérieur), "Montage & compilation" (aucune option terrain, cohérent avec une
prestation 100% à distance).

### Prix affichés vs catalogue réel

Les 8 prix fixes codés en dur dans `reserver.html` (ex. "160 € TTC" pour Pack Match Complet, "180
€ TTC" pour Combo Véo + Photo) ont été comparés au `prix_ht`/`tva_pct` réels de
`catalogue_offres` en base : tous concordent (TTC = HT × 1,2, arrondi cohérent). Pas de dérive de
prix trouvée.

### Soumissions réelles testées (4 besoins différents, clics/saisies réels)

- **Match photo** (desktop) : option drone cochée, récap "Prestation : 120 € TTC / Plans drone …
  : +40 € TTC / Total estimé : 160 € TTC", soumission réussie (`SV-2026-0103`), écran de succès
  réel avec référence et lien Connect généré avec le bon e-mail encodé.
- **Pack Match Complet** (desktop) : badge disponibilité réel affiché ("équipe disponible"),
  récap "160 € TTC + 40 € = 200 € TTC" correct, soumission réussie (`SV-2026-0104`).
- **Match filmé drone** (desktop) : options contextuelles vérifiées (reel/express uniquement, pas
  de doublon drone — voir ci-dessus), récap cohérent.
- **Montage & compilation** (**mobile** 390×844) : aucune option affichée (cohérent), aucun champ
  lieu affiché (cohérent, prestation à distance), récap "Tarif : sur devis — Aucun paiement
  maintenant." Bouton "Envoyer ma demande" et "Précédent" bien empilés pleine largeur sous
  640px, aucun recouvrement.

Deux soumissions (drone, montage) ont ensuite été bloquées par le rate-limit anti-abus de
`create-guest-request` (5 demandes/heure/IP) — **comportement attendu**, pas un bug : les 4
campagnes QA parallèles de cette nuit partagent la même IP sortante (`109.215.248.136`,
confirmé en base : 10 entrées `guest_rate_limits` cumulées avant même mes propres appels). Le
message d'erreur s'affiche correctement dans le composant dédié (pas d'`alert()`, pas de crash).

### Validation des champs (réel, novalidate)

Testé en réel sur "Caméra isolée" (champs joueur obligatoires spécifiques à ce besoin) : message
d'erreur correct si nom/numéro manquants, passage normal une fois complétés. Testé aussi :
soumission vide ("Prénom, nom et e-mail sont obligatoires"), e-mail invalide ("Merci de renseigner
une adresse e-mail valide"), case CGV non cochée ("Merci de cocher…"). **Aucune `alert()` native
du navigateur déclenchée à aucun moment** — uniquement des composants d'erreur dans la page.

### Écriture en base (`create-guest-request`)

Payload inspecté et confirmé conforme au code : `find_or_create_client_by_email` (RPC atomique,
verrouillée par e-mail) pour `clients`, résolution serveur de `offre_id` depuis `catalogue_offres`
(jamais un id fourni par le visiteur), recalcul serveur des frais de déplacement (API adresse.data.
gouv.fr), insertion `prestations` avec `statut: demande_reçue`, `montant_ht/ttc` volontairement
NULL (calculé plus tard au paiement). E-mail de confirmation envoyé (Resend, best-effort).

---

## 3. `demande-de-devis.html` + modale RDV

- **Formulaire devis** : soumission réelle testée, appelle en réalité `create-guest-request` (même
  edge function que le tunnel de réservation — cohérent, le devis est un besoin "sur devis" comme
  un autre). Une tentative a été bloquée par le même rate-limit partagé (voir ci-dessus), pas un
  bug.
- **Modale RDV** : soumission réelle complète et réussie — appel réel à `create-guest-rdv`, écran
  de succès affiché dans un vrai composant ("✓ Demande de rendez-vous envoyée…"), pas d'`alert()`.
- **CTA sticky mobile — bug trouvé et corrigé** : le bouton "Aller au formulaire" (ajouté le
  30/08, visible seulement entre le hero et le formulaire) est positionné en `position:fixed;
  bottom:14px` avec `z-index:1500`. Le bandeau cookies RGPD (affiché par défaut à **tout premier
  visiteur**) occupe le bas de l'écran en mobile avec `z-index:2500` et capte tous les clics dans
  cette zone. Résultat : pour n'importe quel premier visiteur mobile n'ayant pas encore répondu au
  bandeau cookies, le CTA sticky était non seulement masqué visuellement mais **totalement
  inutilisable** (clic Playwright réel : timeout, "cookie-banner-actions intercepts pointer
  events"). Corrigé en masquant aussi ce CTA tant que le bandeau cookies est affiché (même logique
  que le masquage déjà existant pour ne jamais recouvrir le formulaire), ré-évalué à chaque
  ouverture/fermeture du bandeau. Revérifié en réel après correctif : CTA invisible tant que le
  bandeau est ouvert, visible et cliquable dès qu'il est fermé, clic réel réussi, scroll jusqu'au
  formulaire confirmé.

---

## Bugs trouvés et corrigés (résumé avec preuve)

| # | Bug | Gravité | Fichier(s) | Preuve |
|---|---|---|---|---|
| 1 | Duplication de fiche `clients` (sans e-mail) à la création d'un compte Connect personnel avec un e-mail déjà connu — casse la promesse centrale de la FAQ | **Critique** | `connect_resolve_beneficiary_client_id` (SQL, migration-connect-v87) | Reproduit en réel avant/après avec 2 couples client/compte de test, `client_id` identique après correctif, `list_orders` confirme la prestation visible |
| 2 | CTA "Créer mon espace Connect" perd `signup`/`email` (middleware intercepte avant la page) | Élevée — casse le parcours recommandé par la FAQ | `app-connect/src/lib/supabase/middleware.ts`, `src/app/signup/signup-context.tsx`, `src/app/page.tsx` | Build + `tsc --noEmit` propres, serveur local réel, Playwright : redirection vers `/signup?email=…` avec champ pré-rempli |
| 3 | CTA sticky mobile "Aller au formulaire" inutilisable tant que le bandeau cookies est ouvert (premier visiteur) | Moyenne | `demande-de-devis.html` | Clic Playwright réel : timeout avant correctif ("intercepts pointer events") ; clic réussi après correctif |

## Non-bugs écartés après investigation (pour éviter un faux signal)

- **Double en-tête visible sur une capture mobile pleine page** : artefact connu du mode
  `fullPage: true` de Playwright/Chromium avec un élément `position:fixed` (le header apparaît une
  fois par segment de capture assemblé) — pas un comportement réel pour un utilisateur qui fait
  défiler la page. Vérifié en re-capturant en mode viewport simple.
- **Tarification "Montage & compilation" à paliers (39,90 € à 80 € HT selon le volume)** : le
  catalogue `catalogue_offres` n'a qu'un prix fixe unique (33,33 € HT) pour ce slug — à première
  vue une incohérence. Investigation : ce comportement est **volontaire**. Pour la vitrine, ce
  besoin est explicitement traité "sur devis" (absent de `OFFRES_PRIX_FIXE` dans `reserver.html`,
  écran "Aucun paiement… devis personnalisé") — le staff chiffre manuellement à partir du texte
  libre transmis. La tarification à paliers automatique existe bien ailleurs, mais dans
  `create-checkout-session`, pilotée par des colonnes structurées dédiées
  (`duree_rush_minutes`/`mode_livraison_montage`/`nombre_matchs_lien`, migration-connect-v63) —
  utilisées uniquement par le tunnel de réservation **authentifié** de Connect (in-app), pas par
  le tunnel visiteur. Cohérent, pas de bug.

## Nettoyage des données de test

Tous les comptes/clients/prestations/rendez-vous de test (préfixes `qa-rattachement-30aug-*` et
`qa30aug-*`, domaine `@sportvision-test.invalid`) ont été supprimés en fin de mission : `clients`,
`prestations`, `rendez_vous`, `connect_profile_settings`, `messages_client`, comptes
`auth.users`. Requête de contrôle finale après suppression : **0 ligne restante**.
