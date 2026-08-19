# SportVision OS — Audit Pack

Document technique + produit + métier, préparé pour un audit externe strict. Pas de discours marketing : chaque affirmation est sourcée (fichier:ligne quand c'est pertinent) et classée selon un niveau de confiance (voir § Légende). Ce document est **en cours de construction** — voir l'avancement en tête de chaque section.

## Légende — niveau de confiance

- **CONFIRMÉ** : vérifié en lisant le code source réel et/ou en interrogeant la base de données réelle.
- **PARTIELLEMENT CONFIRMÉ** : le code existe et fait ce qui est décrit, mais une dépendance (migration non exécutée, edge function jamais redéployée, contrat/donnée réelle absente) limite ou empêche son fonctionnement en production actuelle.
- **À TESTER** : le code semble exister mais n'a pas été exercé en conditions réelles pendant la préparation de ce pack.
- **NON IMPLÉMENTÉ** : décrit dans un document de cadrage (master doc, cahier des charges) mais absent du code.

---

## 0. Périmètre de ce document

SportVision est un écosystème de 4 applications réelles (+ 2 legacy encore déployées, voir § 5.2) qui partagent **un seul projet Supabase** (réf. `lulgezzpvrlbftbykzrc`) — une seule base Postgres, un seul service Auth, un seul Storage, un seul jeu d'edge functions :

1. **Vitrine publique** (`livrables/SportVision`) — pages HTML statiques, domaine `sportvision-an.fr`.
2. **Connect** (`livrables/SportVision-Connect/app-connect`) — Next.js, espace personnel joueur/particulier.
3. **Club+** (`livrables/SportVision-Connect/app-next`) — Next.js, espace club/organisation professionnel. Historiquement appelé "Connect" tout court dans certains commentaires plus anciens du code — les deux ont été séparés le 12/08/2026.
4. **SportVision OS** (`livrables/SportVision-TV/SportVision-OS-Full.html`) — backoffice interne staff, fichier HTML/JS vanilla unique (~24 900 lignes, aucun framework, aucun build step).

**Full Communication n'est pas une 5ᵉ application.** C'est un contrat commercial (`type_contrat='full_communication'` dans la table `contrats`, exposée en lecture via la vue `client_contrats`) qui, une fois actif pour un club, change dynamiquement son `planCode` dans Club+ et débloque un dashboard dédié (`FullCommunicationDashboard.tsx`). Voir § 5.3 pour le détail exact du mécanisme — **CONFIRMÉ**, ce n'est jamais un champ statique sur `clubs`.

---

## 5. Architecture globale — CONFIRMÉ

### 5.1 Stack technique par application

| Application | Frontend | Build/déploiement | Domaine |
|---|---|---|---|
| Vitrine | HTML/CSS/JS statique | Netlify — `publish=.` (dossier `livrables/SportVision`), redirects 1:1 explicites par page | `sportvision-an.fr` |
| Connect | Next.js | Netlify — `base=livrables/SportVision-Connect/app-connect`, `publish=.next`, plugin `@netlify/plugin-nextjs` explicite | non documenté dans le repo (probable `connect.sportvision-an.fr`, voir § 5.2) |
| Club+ | Next.js | Netlify — `base=livrables/SportVision-Connect/app-next`, `publish=.next`, même plugin explicite | non documenté dans le repo |
| SportVision OS | HTML/JS vanilla, un seul fichier | Netlify — `publish=livrables/SportVision-TV` **à la racine du repo**, redirect catch-all `/` → `/SportVision-OS-Full.html` | non documenté dans le repo (déploiement observé : `sportvision-os.netlify.app`) |

**Backend commun aux 4 apps** : Supabase (réf. `lulgezzpvrlbftbykzrc`) — Postgres (RLS activée table par table, voir § 58), Auth (email/password + magic links), Storage (buckets publics/privés, voir § 34), 37 Edge Functions Deno (voir § 6 du rapport d'architecture, repris ci-dessous en § 17-19).

**Paiements** : Stripe (checkout sessions créées par edge functions dédiées : `create-checkout-session`, `create-clubplus-subscription-checkout`, `create-agent-subscription-checkout`, `create-funding-contribution-checkout`, `create-guest-payment-checkout`, `create-team-contribution-checkout`), webhook centralisé `stripe-webhook`.

**Emails transactionnels** : edge functions dédiées par type de document (`send-devis-email`, `send-facture-email`, `send-facture-pennylane`, `send-signature-request`, `notify-account-change`).

**Signature électronique** : Youtrust (**pas Yousign**, malgré un cahier des charges d'origine qui citait Yousign — corrigé et documenté explicitement dans `ARCHITECTURE-CONNECT.md:224` pour éviter toute confusion future).

**Comptabilité** : intégration Pennylane (`send-facture-pennylane`).

**Cron/jobs** : `dispatch-notifications` (worker du "Communication Hub"), appelée uniquement par pg_cron avec un secret partagé vérifié côté serveur.

**SB_URL codé en dur** dans plusieurs fronts statiques (ex. `reserver.html:686` : `https://lulgezzpvrlbftbykzrc.supabase.co`) — pas de variable d'environnement pour la vitrine (fichiers HTML statiques, pas de build step qui permettrait l'injection).

### 5.2 Note importante — déploiements legacy encore présents dans le repo

Deux applications supplémentaires ont un `netlify.toml` actif dans le repo :

- `livrables/SportVision-Club-Plus/netlify.toml` — ancienne app Club+ en HTML unique (`SportVision-Club-Plus.html`). D'après les commentaires du code actuel (`session.ts` Club+ et `clubplus-invite`), cette app a été **absorbée par l'actuel Club+ (app-next)**.
- `livrables/SportVision-Connect/app/netlify.toml` — ancienne app Connect vanilla (`index.html` + `modules/*.js`), citée comme ancêtre historique dans les commentaires de app-next.

**PARTIELLEMENT CONFIRMÉ** : le code source de ces deux legacy est toujours présent et leur `netlify.toml` toujours actif, ce qui signifie qu'ils **peuvent encore être déployés et servir du trafic réel** si le site Netlify correspondant existe toujours côté hébergeur — ce pack ne peut pas confirmer depuis le code seul si ces sites sont encore en ligne ou ont été désactivés côté Netlify. **Point à vérifier manuellement par Fouka dans le dashboard Netlify avant tout audit de sécurité qui suppose une seule version active par app.**

### 5.3 Mécanisme Full Communication (précision demandée explicitement)

Full Communication n'existe **jamais** comme un plan stocké sur `clubs.plan` ni comme un booléen dédié. Le mécanisme réel (`session.ts` Club+, fonction `buildClubActiveContext`) :

1. Le club a une colonne `clubs.portail_client_id` qui, si renseignée, le relie à un `client_id` côté portail/OS (le "compte client" historique, distinct du compte Club+).
2. À chaque chargement de contexte, Club+ interroge la vue `client_contrats` (jamais la table `contrats` directement — elle n'a de policy RLS que pour le staff) filtrée sur `client_id = clubs.portail_client_id AND type_contrat='full_communication' AND statut='actif'`.
3. Si une ligne existe : `ctx.subscription.planCode` devient `"full_communication"` au lieu du plan dérivé de `clubs.plan` (free/start/performance), et l'interface bascule sur `FullCommunicationDashboard.tsx`.
4. Si le club n'a jamais été relié à un `portail_client_id`, ou n'a pas de contrat actif de ce type, il retombe silencieusement sur son plan Club+ normal.

**PARTIELLEMENT CONFIRMÉ avec historique de bug documenté** : le commentaire du code (`session.ts:238-250`) rapporte explicitement qu'un audit UI/UX à 5 agents le 11/08/2026 a établi qu'**aucun club Full Communication réel n'avait jamais pu obtenir `isFullCommunication=true`** avant correction (mauvais dashboard affiché, mauvaise navigation) — le bug est corrigé dans le code actuel, mais ceci illustre que "le composant existe" et "le workflow a déjà fonctionné en production" sont deux affirmations différentes, à vérifier séparément pour chaque zone du produit (voir § 89 du prompt d'origine — principe appliqué dans tout ce document).

### 5.4 Schéma textuel (architecture réelle, pas idéalisée)

```
                     Vitrine (sportvision-an.fr, HTML statique)
                            │  fetch direct (SB_URL en dur)
                            ▼
                  Edge Functions (Supabase, Deno)
        create-guest-request · create-guest-rdv · check-disponibilite
                            │
                            ▼
                    Postgres (RLS) + Auth + Storage
                    ▲                          ▲
                    │                          │
      ┌─────────────┴──────────┐   ┌───────────┴─────────────┐
      │   Connect (app-connect)│   │      Club+ (app-next)   │
      │ Espace joueur/         │   │ Espace club/organisation│
      │ particulier            │   │  (7 types génériques +  │
      │                        │   │   type "club" avec plan)│
      └─────────────┬──────────┘   └───────────┬──────────────┘
                     │  edge functions dédiées (onboarding, invite,
                     │  activation par token) — jamais d'écriture
                     │  directe organizations/memberships sans
                     │  validation staff
                     ▼
              SportVision OS (backoffice staff, seul point qui
              valide/active réellement une organisation, gère
              production/finances/RH interne)
                     │
                     ▼
        Full Communication = contrat (`contrats`/`client_contrats`)
        rattaché à un club existant via `portail_client_id`,
        jamais une app séparée
```

Ce schéma diffère du schéma "idéal" à 5 branches suggéré dans le prompt d'audit : dans le code réel, **aucune structure/organisation Connect ou Club+ n'est jamais créée sans passer par une validation staff côté OS** (via un token d'activation généré après revue), sauf le plan gratuit self-service (`clubplus-onboarding`). Le flux "Vitrine → OS direct" existe aussi en parallèle pour les demandes ponctuelles (réservation sans compte).

---

*(Suite du document en cours de rédaction — sections 6 à 90 du plan d'audit demandé, en attente des recherches sur : inventaire complet des écrans/rôles/statuts OS, schéma de base de données + policies RLS. Ce fichier sera complété et republié.)*
