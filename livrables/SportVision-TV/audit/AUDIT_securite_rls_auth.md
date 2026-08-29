# Audit sécurité final — RLS, Authentification, Secrets, IDOR/Uploads, Webhooks

Date : 2026-08-29 (nuit, mission autonome). Périmètre : SportVision OS + Connect + Club+, base Supabase de production (`lulgezzpvrlbftbykzrc`).

**Contexte important** : un travail de sécurité considérable existe déjà et est documenté (`SECURITY_ARCHITECTURE.md`, `THREAT_MODEL.md`, `RBAC_MATRIX.md`, `SECRETS_MANAGEMENT.md`, `AUDIT-RATE-LIMITING.md`, `CLUBPLUS_PLAYER_FAMILY_SECURITY_REVIEW.md`, et surtout `audit-pack/SPORTVISION_KNOWN_INCONSISTENCIES.md` qui documente ~50 findings dont une dizaine de failles critiques déjà trouvées et corrigées lors d'audits précédents, notamment un audit pré-lancement du 21/08 très approfondi sur les policies RLS, les vues auto-updatable, les 148 fonctions `SECURITY DEFINER`, et le storage). Cette session ne répète pas ce travail : elle vérifie en conditions réelles (vrais comptes jetables, vrais JWT, vraies requêtes REST) que ces correctifs tiennent toujours, et cherche spécifiquement ce qui a été ajouté **depuis** ces audits (donc jamais passé par la même rigueur).

---

## Corrigé

### IDOR sur 6 RPC `SECURITY DEFINER` Connect exposant des données d'un utilisateur arbitraire (CRITIQUE côté sévérité de la classe de bug, impact réel MOYEN)

- **Trouvé par requête directe sur `pg_proc`** : `connect_agent_discount(p_user_id)`, `connect_agent_effective_tier(p_user_id)`, `connect_agent_relationship_count(p_user_id)`, `connect_particulier_limit(p_user_id)`, `connect_particulier_total_sportifs_count(p_user_id)` et `connect_owner_client_id(p_owner_user_id)` sont des fonctions `SECURITY DEFINER` exposées comme endpoints RPC PostgREST (`POST /rest/v1/rpc/<nom>`), accessibles avec la seule clé `anon` publique (EXECUTE accordé à `anon`), et qui ne vérifiaient **jamais** que l'appelant (`auth.uid()`) correspondait au `p_user_id`/`p_owner_user_id` passé en paramètre. N'importe quel appelant (authentifié ou même totalement anonyme pour certaines) pouvait donc interroger le palier d'abonnement Agent, l'état de remise mensuelle, le nombre de sportifs liés/gérés, le plafond de compte ou le `client_id` interne de **n'importe quel autre utilisateur Connect**, en connaissant simplement son UUID.
- **Cause probable** : ces 6 fonctions sont toutes postérieures à l'audit systématique des 148 fonctions `SECURITY DEFINER` du 21/08 (`migration-connect-v57` pour `connect_agent_discount`, référence explicite à "pré-v67" dans `connect_particulier_limit`) — elles n'ont donc jamais reçu cette passe de revue.
- **Vérifié que le correctif ne casse rien** : grep exhaustif de tous les points d'appel réels dans `app-connect` (`agentSubscription.ts`, `particulier/sportifs/page.tsx`, `particulier/page.tsx`) et dans les 2 edge functions qui les appellent (`create-checkout-session`, `stripe-webhook` en commentaire) — **tous** passent systématiquement l'id de l'appelant authentifié lui-même, jamais un id tiers. Le correctif (exiger `auth.uid() = p_user_id`, avec un accès `is_staff()` en complément par cohérence avec le reste du code) ne change donc aucun comportement légitime.
- **Correctif appliqué en production** (`migration-audit-final-securite-idor-connect-rpc.sql`, exécuté directement via l'API Management Supabase cette nuit) : garde ajoutée en tête de chacune des 6 fonctions.
- **Vérifié en réel après correctif** (2 comptes jetables créés/supprimés, résidu à zéro) :
  - Appel `connect_owner_client_id` par le compte A avec le `p_owner_user_id` du compte B → `400 P0001 "Accès refusé."` (avant correctif : aurait retourné le `client_id` réel de B).
  - Même appel avec son propre id → `200`, comportement normal inchangé.
  - `connect_particulier_limit` avec l'id d'un autre compte → `400 Accès refusé` ; même appel sans aucun token (anon pur) → également `400 Accès refusé` (la fonction exige désormais explicitement `auth.uid() is null` → refus).

### (Rappel de contexte, pas un nouveau correctif) Vérification que les correctifs de l'audit du 21/08 tiennent toujours

Plusieurs points documentés comme corrigés le 21/08 ont été re-testés en réel cette nuit plutôt que supposés acquis :
- **6 vues auto-updatable** (`client_contrats`, `client_factures`, `client_organisation`, `client_organisation_members`, `client_prestations`, `prestations_equipe_display`, INC-036) : `REVOKE INSERT/UPDATE/DELETE` toujours en place (`information_schema.role_table_grants` vérifié directement). **2 nouvelles vues auto-updatable** créées depuis (`clubs_safe`, `v_mission_prete`) ont été vérifiées avec la même requête : **aucune** n'a de droit d'écriture accordé à `anon`/`authenticated` — le pattern de la faille INC-036 n'a pas été réintroduit.
- **Isolation cross-club Club+** (flaguée "vérifiée par lecture, pas par exécution" dans `CLUBPLUS_PLAYER_FAMILY_SECURITY_REVIEW.md` §3) : testée pour de vrai — 2 clubs + 2 comptes jetables créés, un membre du club A ne voit **aucune** ligne du club B sur `club_members`, `clubs`, ni `clubs_safe` (tableaux vides confirmés par requête REST réelle). Son propre club reste visible en entier (comportement voulu, cf. INC-046). Résidu de test supprimé, vérifié à zéro (`clubs`/`club_members` filtrés par nom `AUDIT-CLUB%` → 0 ligne restante).
- **Anti auto-promotion `club_members`** (trigger de protection `role`/`club_id`/`status`) : tentative réelle d'un membre `coach` de se passer `role='admin'` sur sa propre ligne → rejetée (`400`, message explicite "réservés à l'administrateur du club ou au staff SportVision").
- **RLS financière OS** (`paiements`, `frais`, `contrats` réservés à `admin`/`sec`/`compta`, INC-041) : compte jetable rôle `photo` créé → `GET` sur les 3 tables retourne systématiquement `[]` (RLS, pas juste la garde UI). Tentative de self-escalation `photo→admin` sur `profiles` → rejetée par trigger (même famille de protection que `club_members`).
- **148 fonctions `SECURITY DEFINER` (INC-031)** : les 5 fonctions listées comme corrigées ce soir-là (`connect_athlete_profile_coalesce_update`, `connect_declare_club`, `enqueue_notification`, `notify_client_members`, `connect_notify_by_client_id`) ont toutes `EXECUTE` toujours révoqué pour `anon`/`authenticated` — pas de régression.
- **Search_path hardening (148 fonctions, INC-031)** et **RLS activée sur toutes les tables `public`** : requête directe sur `pg_proc`/`pg_class` — 0 fonction `SECURITY DEFINER` sans `search_path` explicite, 0 table sans RLS activée. Toujours vrai.
- **Ghost edge functions (INC-037)** : `GET /functions` (48 déployées le 21/08 après nettoyage) comparé aux 46 dossiers locaux actuels — aucune fonction déployée sans dossier local correspondant (le pattern de fonction fantôme n'est pas revenu).
- **Webhooks Stripe/Youtrust** : code source relu — `stripe-webhook` utilise toujours `constructEventAsync` + `STRIPE_WEBHOOK_SECRET`, `youtrust-webhook` vérifie toujours une signature HMAC-SHA256 en **temps constant** (boucle XOR explicite, pas de comparaison de chaîne directe) avant tout traitement. Aucune régression.
- **Aucun secret dans le frontend** : grep exhaustif de `SportVision-OS-Full.html` pour `SUPABASE_SECRET_KEY`/`SUPABASE_MANAGEMENT_TOKEN`/`service_role`/`sk_live`/`sk_test`/`rk_live` → seule occurrence est un commentaire ("pas de service_role dans ce fichier, volontairement"). Seule clé présente : `sb_publishable_...` (clé publique, normal).

---

## Amélioré

- Les fonctions RPC touchées par le correctif IDOR utilisent maintenant systématiquement le même patron de garde que le reste du code Connect (`if auth.uid() is null or (...) then raise exception`), au lieu de laisser certaines fonctions sans aucune vérification — cohérence renforcée pour toute future fonction du même module (`connect_agent_*`, `connect_particulier_*`).

---

## À surveiller

- **Trigger fonctions avec `EXECUTE` accordé à `anon`** (`protect_sensitive_*`, `sync_*`, `fanout_*`, `trg_notify_*`, une soixantaine au total) : c'est le comportement par défaut de PostgreSQL (`GRANT EXECUTE ... TO PUBLIC` implicite à la création), pas une négligence spécifique. **Vérifié non exploitable** : PostgREST refuse d'exposer une fonction dont le type de retour est `trigger` ou `event_trigger` comme endpoint RPC (`404 Could not find the function`, testé en réel sur `protect_sensitive_prestation_fields`). Aucune action nécessaire, mais à garder en tête si une future fonction de ce type est un jour réécrite pour retourner autre chose que `trigger`.
- **`p?.n`/`p?.av` (nom et avatar affiché dans l'en-tête de conversation messagerie interne, `SportVision-OS-Full.html:16497`)** insérés en `innerHTML` sans passer par `esc()`, contrairement au corps des messages eux-mêmes qui passe par `_escMsgHtml()`. Champs alimentés par les profils **staff internes** (pas par un client externe) — XSS stocké théorique entre collaborateurs uniquement si un compte staff est déjà compromis ou malveillant, sévérité faible. Sur ~690 usages d'`innerHTML` dans le fichier, ceci est le seul point suspect trouvé par une recherche automatisée des interpolations non passées par `esc()`/`escJs()` qui contenait un champ texte réellement piloté par un utilisateur (le reste : IDs, booléens, nombres, libellés statiques). Non corrigé cette nuit — périmètre isolé, pas de vecteur externe, à corriger en polish si l'occasion se présente (`esc(p?.n||'Conversation')`).
- **Buckets Storage `clubplus-media` et `portail-media`** : toujours `public=true`, sans `file_size_limit` ni `allowed_mime_types` définis au niveau bucket (contrairement à `club-logos` qui a les deux, et à `sportvision-media-prive` qui a un plafond de taille). Je n'ai **pas** ajouté de restriction MIME/taille cette nuit : ces deux buckets portent la production vidéo réelle du cœur de métier SportVision, et je n'ai aucune visibilité sur la taille maximale légitime d'une vidéo livrée à un client — un plafond mal calibré casserait une vraie livraison. C'est une décision produit (quelle taille/format maximum accepter), pas un correctif technique évident. Recommandation : Fouka fixe une valeur explicite (ex. 2 Go/vidéo, formats vidéo+image+PDF courants) et je peux l'appliquer en 1 requête `PATCH` sur `storage.buckets` dès que la valeur est connue.
- **`family-docs/<player_id>/...`** (chemin storage prévu pour les documents d'autorisation parentale, sur le bucket public `clubplus-media`) : toujours aucun code d'upload nulle part dans le repo (`app-next`, `app-connect`, OS) — confirmé par grep cette nuit. Mort-né, aucune exposition réelle, cohérent avec le constat du 20-21/08 (INC-029).
- **`role_permissions` (matrice de permissions personnalisées Club+)** : toujours non appliquée nulle part dans le code, juste persistée — dette déjà documentée, pas de changement.
- **Pas de MFA, tokens de session en `localStorage` sans cookie `httpOnly`** (OS et Connect) : confirmé inchangé, c'est un chantier d'architecture (migration vers le SDK Supabase Auth JS avec gestion de session dédiée) hors de portée d'une correction ponctuelle de cette nuit. Le flux de session actuel (`checkSession()`, `SportVision-OS-Full.html:3301-3339`) est en revanche bien conçu dans ses limites : revérifie le rôle en base à chaque chargement (pas de confiance aveugle au cache local), détecte un compte désactivé ou supprimé en cours de session et déconnecte proprement (`svClear();goLogin()`), gère le refresh token avant d'abandonner — **aucune boucle de redirection identifiée**.

---

## Action externe nécessaire

- **Token GitHub personnel toujours exposé en clair dans la configuration git**, `git remote -v` confirme un token `ghp_…` embarqué directement dans l'URL du remote `origin` — **c'est exactement le même finding que `SECURITY_ARCHITECTURE.md`/`SECRETS_MANAGEMENT.md` avaient déjà signalé le 2026-08-06** ("à révoquer par Fouka en priorité"), toujours non traité 3 semaines plus tard. Je n'ai pas touché à la configuration git (hors de mes prérogatives sur ce type de fichier) ni à GitHub (pas d'accès). **À faire par Fouka en priorité** : révoquer ce token sur GitHub (Settings → Developer settings → Personal access tokens), puis reconfigurer le remote sans token dans l'URL (credential helper, ou clé SSH). (Valeur exacte du token volontairement omise ici pour ne pas la redupliquer dans l'historique git — elle est visible via `git remote -v` en local.)
- **Bucket `clubplus-media`/`portail-media` : plafond de taille/type de fichier à décider** (voir "À surveiller" ci-dessus) — nécessite une décision produit sur les formats/tailles légitimes avant toute restriction technique.
- **Stripe live jamais testé avec un vrai cycle de paiement complet** (invoice.paid, changement de crédits, résiliation) — déjà noté PARTIEL le 21/08 (INC-045), toujours vrai, nécessite soit une carte réelle soit une paire de clés TEST dédiée que je n'ai pas.

---

## Non modifié volontairement

- **Buckets `clubplus-media`/`portail-media` restés publics** : décision déjà documentée comme nécessitant un inventaire produit avant tout changement (voir `SECURITY_ARCHITECTURE.md` §5 et ci-dessus). Un chemin sensible connu (`family-docs/`) reste protégé par le fait qu'il n'a jamais été construit côté UI, pas par une restriction technique — accepté tel quel cette nuit, pas une régression.
- **MFA, cookies `httpOnly`, séparation dev/staging/prod, gestionnaire de secrets centralisé** : chantiers d'architecture identifiés de longue date (`THREAT_MODEL.md`), volontairement hors du périmètre d'une correction ponctuelle nocturne — nécessitent une décision de Fouka sur le niveau d'investissement (SDK Auth, infra secrets) plutôt qu'un correctif SQL.
- **`p?.n`/`p?.av` non échappés dans l'en-tête messagerie interne** : laissé tel quel (voir "À surveiller") — surface d'attaque interne uniquement, correction cosmétique à faible risque plutôt qu'urgente, pour ne pas multiplier les changements de UI cette nuit sur un fichier de 32 000 lignes sans re-test visuel possible.
- **Aucune migration destructive envisagée ni exécutée.** Le seul changement de schéma cette nuit est additif (garde ajoutée en tête de 6 fonctions existantes, `CREATE OR REPLACE FUNCTION`, aucune table/colonne supprimée ou modifiée).

---

## Récapitulatif des actions réelles sur la base de production

1. **1 migration SQL corrective exécutée directement en production** via l'API Management Supabase (`livrables/SportVision-TV/migration-audit-final-securite-idor-connect-rpc.sql`, commitée dans ce worktree) — 6 fonctions `SECURITY DEFINER` durcies contre l'IDOR.
2. **Comptes de test créés puis supprimés** (auth + toute donnée associée), résidu vérifié à zéro à chaque fois : 2 comptes pour le test IDOR RPC, 2 comptes + 2 clubs + 2 lignes `club_members` pour le test d'isolation cross-club, 1 compte rôle `photo` pour le test RLS financière OS. Aucune donnée réelle (client, club, prestation) touchée.
3. **Aucune autre modification de schéma ou de données réelles.**
