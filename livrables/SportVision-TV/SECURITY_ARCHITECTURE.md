# Architecture de sécurité — SportVision OS & Connect

État réel constaté au 2026-08-06, par audit direct du code (pas une architecture cible). À revoir après chaque changement structurel.

## 1. Composants

| Composant | Rôle | Techno |
|---|---|---|
| `SportVision-OS-Full.html` | Admin interne : contrats, finances, staff, planning | Page unique, JS vanilla, appels Supabase directs |
| `SportVision-Portail.html` | Espace client (devis, factures, avis) | Idem |
| `SportVision-Club-Plus` (`app.html` / `SportVision-Club-Plus.html`) | Espace club/famille (multi-tenant) | Idem |
| `SportVision-Portail-App` | Wrapper Capacitor iOS/Android autour du Portail | Capacitor |
| `supabase/functions/*` (17 fonctions) | Opérations sensibles : Stripe, Youtrust, Pennylane, invitations, suppression de compte | Deno Edge Functions, `service_role` |
| Supabase (projet unique `lulgezzpvrlbftbykzrc`) | Auth (GoTrue), Postgres + RLS, Storage | — |

Il n'existe **aucun serveur applicatif classique** (pas de Next.js/Node persistant) : les 4 frontends parlent directement à Supabase, et les Edge Functions ne couvrent que les flux qui exigent un secret (clé Stripe, clé Youtrust, service_role).

## 2. Authentification et session

- Pas de SDK Supabase Auth JS (`supabase.auth.*` inutilisé). Les 4 apps font des `fetch()` bruts vers l'endpoint GoTrue (`/auth/v1/token?grant_type=password` / `grant_type=refresh_token`).
- Tokens d'accès/rafraîchissement stockés en `localStorage` (`svp_tok`/`svp_ref`/`svp_uid` côté Portail, `svcp_tok`/`svcp_ref`/`svcp_uid` côté Club-Plus). Aucun cookie `httpOnly`.
- **Conséquence** : un XSS stockée sur n'importe laquelle des 4 apps donne un accès complet à la session (vol de token en `localStorage`), sans protection `httpOnly`/`SameSite`. Aucun mécanisme de rotation de session automatique (pas de SDK = pas d'auto-refresh géré, c'est fait à la main).
- Pas de MFA, pour aucun rôle, sur aucune des 4 apps.

## 3. Autorisation

- Contrôle d'accès porté presque entièrement par **RLS Postgres** (pas de couche applicative serveur intermédiaire), avec des fonctions `SECURITY DEFINER` (`is_club_member`, `is_club_admin`) pour éviter la récursion RLS.
- Deux clés de cloisonnement distinctes et non liées entre elles :
  - `club_members.club_id` pour le multi-tenant Club-Plus.
  - `client_users.client_id` pour le cloisonnement Portail.
  - Le côté OS interne (`profiles.role`) n'est pas multi-tenant : une seule organisation (SportVision).
- Détail des rôles : voir `RBAC_MATRIX.md`.

## 4. Paiements et signatures

- Stripe et Youtrust sont appelés exclusivement depuis les Edge Functions (jamais de clé secrète côté client — confirmé, zéro `sk_`/service_role trouvé dans les 4 HTML).
- Vérification de signature cryptographique sur corps brut : ✅ Stripe (`constructEventAsync`), ✅ Youtrust (HMAC-SHA256 comparaison à temps constant).
- Idempotence : ✅ Stripe (`stripe_events`), ✅ Youtrust depuis cette session (`youtrust_events`, cf. `migration-youtrust-events-idempotence.sql`).
- Un `webhook_events` générique (provider/provider_event_id, `migration-communication-hub.sql`) existe déjà dans le schéma et couvre nominalement stripe+youtrust — **pas encore utilisé par les deux webhooks actuels**, qui ont chacun leur table dédiée. À consolider en P1 si ce module "communication hub" est bien déployé (à confirmer).

## 5. Stockage de fichiers

- Deux buckets Storage, **tous deux publics** : `clubplus-media`, `portail-media`. Aucune URL signée, aucun bucket privé.
- Upload générique côté client (`sbUpload()`, `SportVision-OS-Full.html`) qui renvoie systématiquement une URL publique.
- **Action requise avant tout autre chantier de stockage** : inventorier quels types de documents transitent par ces buckets (galeries publiques vs autorisations parentales/pièces d'identité) avant de basculer quoi que ce soit en privé — voir la décision ouverte dans le plan de remédiation.

## 6. Environnements

- Un seul environnement : un projet Supabase, une paire de clés Stripe (live), pas de séparation dev/staging/prod.
- Secrets gérés à la main via `.env` (non versionné, cohérent avec `.env.example`) et `Deno.env.get(...)` dans les Edge Functions. Pas de gestionnaire de secrets centralisé.
- Aucun `.github/` : pas de CI, pas de scan de secrets automatique, pas de branch protection.
