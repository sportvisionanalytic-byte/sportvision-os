# QA fonctionnelle — Club+, Full Communication, Connect (création de compte)

**Date** : 30/08/2026
**Méthode** : Playwright réel (clics/saisies réels, jamais `page.evaluate()`), contre la prod
(sportvision-an.fr, clubplus.sportvision-an.fr, connect.sportvision-an.fr) pour l'exploration et
la reproduction des bugs, puis contre des builds locaux (`npm run build && npm run start`, avec les
correctifs appliqués) pour re-vérifier chaque correctif avant de conclure. Vérification en base
Supabase (`lulgezzpvrlbftbykzrc`) via l'API Management (service role) pour chaque scénario. Boîte
mail réelle utilisée pour les liens de confirmation e-mail : le connecteur Gmail disponible dans
cet environnement est authentifié sur `sportvisionanalytic@gmail.com` (pas `elkanagroup0@gmail.com`
malgré le `userEmail` de session) — tous les comptes de test ont donc utilisé l'adressage `+` sur
cette boîte (`sportvisionanalytic+svqa...@gmail.com`), avec un premier essai raté sur
`elkanagroup0+...@gmail.com` (jamais confirmable, nettoyé).

Toutes les données de test ont été supprimées après coup et leur absence vérifiée en base (détail
en fin de rapport). Aucun `git push` effectué — 4 commits locaux sur cette branche, à merger après
revue.

---

## Résumé exécutif

| Parcours | Statut fonctionnel | Bug(s) trouvé(s) |
|---|---|---|
| Club+ Gratuit — formulaire d'inscription | OK | — |
| Club+ Gratuit — confirmation e-mail | **CASSÉ**, corrigé | Critique : lien de confirmation mort |
| Club+ Gratuit — plafond 1 équipe / 1 utilisateur | OK (vérifié en base) | — |
| Club+ Start/Performance — devis | OK | Bug mobile (modale bloquée), corrigé |
| Full Communication (5 pages) — devis | OK | même bug mobile que ci-dessus, corrigé |
| Connect — création de compte direct | OK (après corrections) | 2 bugs JS sur le dashboard neuf, corrigés |

**4 commits locaux**, tous avec un correctif vérifié (`tsc --noEmit` réel + re-test Playwright après
correctif, sauf mention contraire ci-dessous) :

1. `fix(clubplus): emailRedirectTo manquant sur auth.signUp() (signup-free/activation/org-activation)`
2. `fix(vitrine): bandeau cookies au-dessus de la modale devis, bouton "Envoyer" inatteignable sur mobile`
3. `fix(connect,clubplus): CSP connect-src bloque le WebSocket Supabase Realtime`
4. `fix(connect): NotificationBell montée deux fois en simultané casse l'abonnement Realtime`

---

## 1. Club+ Gratuit — inscription self-service réelle

**Parcours testé** : `club-plus.html` → clic réel sur « Créer mon compte Gratuit » →
`clubplus.sportvision-an.fr/clubplus/signup-free` → remplissage réel du formulaire (nom du club,
prénom, nom, téléphone, e-mail, mot de passe) → soumission.

**Résultat immédiat** : OK. Le formulaire se remplit et se soumet sans erreur console, l'écran
« Vérifiez vos e-mails » s'affiche correctement (`signup-free/page.tsx`, état `awaitingConfirmation`).

### Bug CRITIQUE trouvé : le lien de confirmation e-mail ne créait jamais le club

En suivant le vrai lien reçu par e-mail (Brevo → Supabase `/auth/v1/verify`), la redirection
finale atterrissait sur `clubplus.sportvision-an.fr/clubplus/auth/login?code=...` — la page de
connexion classique, avec un paramètre `code` jamais consommé. Aucune session n'était jamais créée,
`clubplus-onboarding` n'était donc jamais appelée : **le club n'était jamais créé**, quel que soit
le nombre de fois où l'utilisateur cliquait sur le lien (au second clic : `otp_expired`, le jeton à
usage unique était déjà consommé par le premier essai qui avait échoué).

**Reproduction tracée** (requête HTTP brute, hors navigateur, pour isoler la cause) :
```
Brevo redirect  → https://lulgezzpvrlbftbykzrc.supabase.co/auth/v1/verify?token=pkce_...&type=signup
                   &redirect_to=https://clubplus.sportvision-an.fr/          ← PAS /clubplus/auth/callback
Supabase verify → 303 → https://clubplus.sportvision-an.fr/?error=otp_expired...
```

**Cause** : `signup-free/page.tsx` appelait `supabase.auth.signUp({ email, password })` **sans**
l'option `emailRedirectTo`. Sans cette option, Supabase retombe sur l'origine de la requête
(`https://clubplus.sportvision-an.fr/`), jamais sur `/clubplus/auth/callback` (la route qui
échange réellement le code PKCE contre une session, `auth/callback/route.ts`). Le même bug avait
déjà été identifié et corrigé le 14/08/2026 côté `app-connect` (`signup/club/page.tsx`, commentaire
explicite dans le code) — mais **jamais reproduit côté `app-next`** avant cet audit.

En cherchant tous les appels `auth.signUp()` du projet `app-next`, **deux autres parcours avaient
exactement le même bug** : `activation/page.tsx` (compte invité par un token d'activation) et
`org-activation/page.tsx` (demande d'ouverture de structure après revue staff). Aucun des trois
parcours de création de compte Club+ ne pouvait donc jamais confirmer un e-mail réel.

**Correctif** (commit `b7847a8`) : ajout de
`options: { emailRedirectTo: \`${window.location.origin}/clubplus/auth/callback\` }` aux trois
appels `auth.signUp()`. Vérifié avec un vrai `tsc --noEmit` (node_modules réel installé pour
l'occasion) : zéro erreur sur tout le projet.

**Limite de cette vérification** : je n'ai **pas** pu re-tester ce correctif de bout en bout en
conditions réelles (créer un compte, cliquer le vrai lien, arriver sur le dashboard) car cela
nécessite un déploiement (donc un `git push`), hors de mon rôle — je ne merge/pousse jamais. La
confiance dans le correctif repose sur : (a) la reproduction exacte de la cause via une requête
HTTP tracée, (b) le fait que le même correctif, au même endroit du code, avec la même URL de base
(`${window.location.origin}/.../auth/callback`), est déjà démontré fonctionner en production côté
Connect depuis le 14/08. **Recommandation : après merge et déploiement, refaire un vrai signup
Club+ Gratuit avec un e-mail réel pour confirmer que le club se crée bien.**

### Plafonds du plan Gratuit (1 équipe, 1 utilisateur)

Comme le compte de test n'a jamais pu être confirmé (bug ci-dessus), je n'ai pas pu tester le
plafond d'équipe depuis l'UI réelle (`/clubplus/teams`, bouton « Créer une équipe » — ce chemin UI
existe bien, ajouté le 19/08 après un retour utilisateur). J'ai donc vérifié le mécanisme
directement en base, avec un vrai club de test :

```sql
insert into clubs (id, nom, plan) values (..., 'QA Test Club Free Trigger', 'free');
insert into club_teams (id, club_id, name) values (..., 'Equipe A');        -- OK
insert into club_teams (id, club_id, name) values (..., 'Equipe B ...');    -- ERROR
```
Résultat exact du 2ᵉ insert :
```
ERROR: P0001: Plafond d'équipes atteint pour ce plan (1 équipe(s) maximum).
Passez à une formule supérieure pour créer davantage d'équipes.
```
**Confirmé : le trigger `check_club_teams_limit()` applique bien la limite de 1 équipe pour le plan
`free`.** Club et équipes de test supprimés immédiatement après.

Pour le plafond utilisateur (1 max), vérifié par lecture de code : `clubplus-invite/index.ts`
ligne 97, `MAX_USERS_BY_PLAN = { free: 1, club: 5, performance: null }`, appliqué côté serveur avant
l'envoi de toute invitation (ligne 175).

### Nettoyage

Le compte `elkanagroup0+svqafree0830@gmail.com` (premier essai, mauvaise boîte mail) et
`sportvisionanalytic+svqafree0830@gmail.com` (second essai) ont été supprimés via l'API admin
Supabase. Aucun club/`club_members` n'a jamais été créé pour ces deux essais (cohérent avec le bug
ci-dessus — vérifié par requête SQL, 0 résultat). Club de test du plafond d'équipes supprimé.

---

## 2. Club+ Start / Performance — parcours devis

Testé en réel sur `club-plus.html`, boutons « Demander Club+ Start » et « Demander Club+
Performance ».

- **Contexte pré-rempli** : confirmé exact. `data-devis-context="Club+ Start (49 € TTC/mois)"` /
  `"Club+ Performance (129 € TTC/mois)"`, repris tel quel dans le champ commentaire (« Intéressé
  par : Club+ Start (49 € TTC/mois) ») et dans le titre de la modale.
- **Soumission** : OK, edge function `create-guest-request` répond `200` avec une référence
  (`SV-2026-0102` pour Start, `SV-2026-0105` pour Performance), écran de confirmation affiché.
- **Aucun paiement déclenché** : confirmé par lecture du code de `create-guest-request/index.ts` —
  la fonction ne fait qu'un `insert` dans `prestations` (statut `demande_reçue`) et n'appelle
  jamais Stripe, ni aucune fonction de paiement. C'est bien un devis, pas un achat : comportement
  voulu, pas une supposition.

### Bug trouvé : bouton d'envoi inatteignable sur mobile (bandeau cookies)

En testant sur viewport mobile (390×844), le clic sur « Envoyer ma demande » timeout : Playwright
rapporte que le bandeau cookies (`#cookie-banner`) intercepte le clic. Cause : `.sv-overlay` (la
modale devis/RDV) est à `z-index:2000`, `.cookie-banner` à `z-index:2500` — tant que le visiteur
n'a pas fait de choix cookies (premier passage), le bandeau reste au-dessus de la modale et masque
le bas du formulaire, y compris le bouton d'envoi, sur les petits écrans.

**Correctif** (commit `bb4adc8`) : `.sv-overlay` passe à `z-index:2550` (au-dessus du bandeau
cookies, en dessous du header/menu mobile) sur les 7 pages de mon périmètre. Re-testé après
correctif : soumission mobile réussie (`SV-2026-0105`, `SV-2026-0107` obtenues après le fix).

**Note** : la même CSS dupliquée existe sur 28 pages de la vitrine au total (grep `.sv-overlay{`) ;
je n'ai corrigé que les 7 de mon périmètre (Club+, Connect, Full Communication ×5) pour ne pas
empiéter sur le périmètre des autres agents QA en parallèle. Le même bug affecte probablement
`index.html`, `accompagnements*.html`, `prestation-*.html`, etc.

---

## 3. Full Communication — devis sur les 5 pages

Testé en réel, une soumission complète par page :

| Page | Bouton | Contexte (`data-devis-context`) | Référence obtenue |
|---|---|---|---|
| `full-communication.html` | Demander mon audit | `Full Communication` | SV-2026-0106 |
| `full-communication-clubs.html` | Demander mon audit | `Full Communication — Clubs` | SV-2026-0107 |
| `full-communication-coachs.html` | Parler de mon activité | `Full Communication — Coachs & préparateurs` | SV-2026-0108 |
| `full-communication-academies.html` | Parler de mon académie | `Full Communication — Académies` | SV-2026-0109 |
| `full-communication-evenements.html` | Obtenir mon devis | `Full Communication — Tournois & événements (délégation complète)` | SV-2026-0110 |

Les 5 soumissions : `200`, commentaire pré-rempli correctement avec le contexte, référence
affichée, zéro erreur console. Le bug mobile (bandeau cookies, voir section 2) affectait aussi ces
5 pages — corrigé dans le même commit.

**Point mineur relevé, non corrigé** : sur les 4 pages variantes (clubs/coachs/académies/
événements), la modale n'a pas d'élément `#devis-title` — le titre reste toujours statique
(« Demander un devis ou une démonstration ») quel que soit le bouton cliqué, contrairement à
`club-plus.html`/`full-communication.html` qui affichent un titre dynamique
(« Demander mon audit Full Communication »). Fonctionnellement la demande part bien avec le bon
contexte (visible dans le commentaire envoyé), c'est un décalage de polish entre deux générations
de la même modale, pas un bug bloquant — signalé mais non corrigé (périmètre visuel plus que
fonctionnel).

---

## 4. Connect — création de compte personnel direct

**Parcours testé** : `connect.html` → clic réel sur « Se connecter à Connect » →
`connect.sportvision-an.fr` (redirige vers `/auth/login`, non connecté) → « Inscrire ma structure »
→ *(en fait le lien correct est « Pas encore de compte ? Inscrire »)* → tunnel `/signup` (identité)
→ `/signup/profil` (choix « Particulier ») → `/signup/sport` (besoin « Découvrir SportVision », donc
**sans réservation préalable**, conforme à la demande) → `/signup/club` (écran simplifié
« Créer mon compte », pas d'étape club pour un profil particulier) → `/signup/verify`.

Tunnel entièrement rempli avec de vraies saisies Playwright (prénom, nom, e-mail, mot de passe ×2),
**zéro erreur console** sur les 4 écrans.

**Confirmation e-mail réelle** : lien récupéré dans la vraie boîte mail (Gmail, via le connecteur
disponible), suivi avec le même contexte de navigateur (pour conserver le `localStorage` du
`pendingOnboarding`, indispensable — voir plus bas). Résultat : redirection correcte
`/auth/callback?code=...` → `/particulier`, compte utilisable, session active. Ce parcours-là
fonctionnait déjà correctement (contrairement à Club+ Gratuit) : `signup/club/page.tsx` passe bien
`emailRedirectTo` depuis le 14/08.

### Bug trouvé n°1 : CSP bloque le WebSocket Realtime → erreur JS sur le dashboard neuf

Sur le dashboard fraîchement créé (`/particulier`, aucun sportif, aucune prestation), erreur
console au chargement :
```
Connecting to 'wss://lulgezzpvrlbftbykzrc.supabase.co/realtime/v1/websocket?...'
violates the following Content Security Policy directive: "connect-src 'self'
https://lulgezzpvrlbftbykzrc.supabase.co". The action has been blocked.
```
**Cause** : `next.config.js` (app-connect) autorise `https://...supabase.co` en `connect-src` mais
pas `wss://...supabase.co` — une entrée `https://` n'autorise pas automatiquement son équivalent
WebSocket. Le SDK Supabase Realtime (`NotificationBell.tsx`, badge de notifications) en a besoin.

**Correctif** (commit `e199845`) : ajout de `wss://lulgezzpvrlbftbykzrc.supabase.co` à `connect-src`.
Vérifié : header CSP relu en HTTP après rebuild (`curl -sD -`), contient bien la nouvelle valeur.

La **même CSP, dupliquée à l'identique**, existe côté `app-next` (Club+, `lib/supabase/realtime.ts`
l'utilise aussi pour les pages Messages/Publications/Notifications/Services) — corrigée en miroir
dans le même commit, mais **non re-testée en direct** (hors du périmètre strict de cette mission,
même code donc même diagnostic).

### Bug trouvé n°2 (démasqué par le correctif n°1) : NotificationBell montée deux fois en simultané

Une fois le WebSocket débloqué par le correctif CSP, une **nouvelle** erreur est apparue (le
navigateur n'atteignait jamais ce code avant, la CSP bloquait la connexion en amont) :
```
cannot add `postgres_changes` callbacks for realtime:member-notifications-<userId>
after `subscribe()`.
```
**Cause** : `<NotificationBell/>` est rendue **deux fois en même temps** sur toute page connectée —
une fois dans le header mobile (`ParticularShell.tsx`/`AppShell.tsx`, masqué en CSS avec
`lg:hidden`), une fois dans `Topbar.tsx` (desktop, masqué en CSS avec `hidden lg:flex`). Le CSS
`hidden` ne démonte rien : les deux instances s'exécutent toujours, tentent de s'abonner au même
canal Realtime (`member-notifications-${userId}`), et la 2ᵉ tentative d'ajouter un listener sur un
canal déjà souscrit par la 1ʳᵉ est refusée par `realtime-js`. **Ce bug touche potentiellement tout
compte Connect connecté**, pas seulement les comptes neufs — je l'ai simplement rencontré en
premier en testant un compte vide comme demandé.

**Correctif** (commit `b898bf7`) : canal Realtime partagé par `user_id` (singleton au niveau module,
avec comptage de listeners), entièrement contenu dans `NotificationBell.tsx` — aucun changement
dans `AppShell`/`ParticularShell`/`Topbar`. Chaque instance montée s'abonne au même canal partagé au
lieu d'en recréer un.

**Vérification du correctif combiné (CSP + NotificationBell)** : build de production local
(`npm run build && npm run start`), connexion réelle avec le compte de test déjà confirmé,
**zéro erreur console**, dashboard rendu correctement (capture d'écran : état vide propre,
« Ajoutez votre premier sportif », « Réserver une prestation »).

### Nettoyage

`connect_profile_settings` (1 ligne) supprimée, compte auth `sportvisionanalytic+svqaconnect0830@gmail.com`
supprimé via l'API admin. Vérifié : aucune ligne restante dans `memberships`, `player_profiles`,
`parent_profiles`, `clients` pour cet utilisateur/e-mail.

---

## Vérification finale — aucune donnée de test résiduelle

```sql
select 'clubs' t, count(*) from clubs where nom ilike '%QA%'                              -- 0
union all select 'club_teams', count(*) from club_teams where name ilike '%QA%'            -- 0
union all select 'club_members', count(*) from club_members where prenom ilike '%QA%'      -- 0
union all select 'prestations', count(*) from prestations p join clients c ...             -- 0
union all select 'clients', count(*) from clients where email ilike '%svqa%'               -- 0
```
Comptes `auth.users` contenant `svqa` : liste vide (vérifié via `listUsers` + filtre).

---

## Confirmations explicites demandées par la mission

- **Club+ Gratuit — inscription** : formulaire OK. **Confirmation e-mail cassée, corrigée dans le
  code de cette session, mais non re-vérifiée en conditions réelles post-déploiement** (nécessite
  un push, hors de mon rôle). **À revérifier par Fouka après merge.**
- **Club+ Gratuit — plafonds** : 1 équipe max confirmé en base (trigger réel, rejet exact). 1
  utilisateur max confirmé par lecture de code (`clubplus-invite`).
- **Club+ Start/Performance — devis** : fonctionne, aucun paiement déclenché (confirmé par le code,
  pas une supposition). Bug mobile trouvé et corrigé, re-vérifié après correctif.
- **Full Communication (5 pages) — devis** : les 5 fonctionnent, contexte correct à chaque fois.
- **Connect — création de compte direct sans réservation** : fonctionne de bout en bout en
  conditions réelles (signup → e-mail réel → confirmation → dashboard). 2 bugs JS trouvés sur le
  dashboard neuf, corrigés et re-vérifiés (zéro erreur console après correctif).
