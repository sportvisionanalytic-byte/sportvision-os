# Gestion des secrets — SportVision OS & Connect

État réel constaté (2026-08-06), métadonnées uniquement — aucune valeur secrète dans ce document ni ailleurs dans le dépôt.

## 1. Inventaire (noms de variables, `.env` racine vs `.env.example`)

`ANTHROPIC_API_KEY, OPENAI_API_KEY, GMAIL_API_KEY, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, INSTAGRAM_ACCESS_TOKEN, FACEBOOK_PAGE_ACCESS_TOKEN, YOUTUBE_API_KEY, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY`

`.env` correspond 1:1 à `.env.example`, correctement gitignoré, jamais commité (vérifié via `git ls-files`).

Secrets supplémentaires utilisés par les Edge Functions (`Deno.env.get(...)`, configurés séparément dans le dashboard Supabase, pas dans le `.env` racine — normal, ce sont deux environnements d'exécution différents) : `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `YOUTRUST_WEBHOOK_SECRET`, `YOUTRUST_API_KEY` (probable, à confirmer), `PENNYLANE_API_KEY` (probable, à confirmer), `CLUBPLUS_URL`.

## 2. Ce qui est déjà correct

- Aucun secret trouvé côté client (les 4 apps HTML n'exposent que la clé publishable Supabase — safe by design, gated par RLS).
- Aucun secret codé en dur trouvé dans les 17 Edge Functions (tout passe par `Deno.env.get`).
- `.env` gitignoré et jamais tracké.

## 3. Ce qui manque

- **Pas de gestionnaire de secrets centralisé** (1Password/Doppler/Vault) : gestion manuelle par fichier `.env` local + saisie manuelle dans le dashboard Supabase pour les Edge Functions. Pas de traçabilité de qui a accès à quoi.
- **Pas de séparation test/live** : `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` sont les clés live directement (`sk_live_`/`pk_live_` dans `.env.example` en valeur d'exemple — confirmer qu'aucune vraie clé live n'a jamais été commitée par erreur dans un ancien commit, via `git log -p -- .env` si le fichier a un jour été suivi).
- **Pas de rotation documentée** : aucune métadonnée (responsable, date de dernière rotation) associée aux secrets.
- **Un secret déjà exposé, action requise en priorité** : `.git/config` contenait un token GitHub personnel en clair dans l'URL du remote (`https://ghp_...@github.com/...`). Ce n'est pas un secret applicatif mais un accès complet au dépôt — à révoquer sur GitHub par Fouka, puis reconfigurer le remote (credential helper, sans token dans l'URL).
- **Pas de scan de secrets automatique** (pas de `.github/`, donc pas de Secret Scanning/Push Protection GitHub, pas de Trivy/gitleaks en local ou CI).

## 4. Recommandation minimale avant tout renforcement supplémentaire

1. Révoquer le token GitHub exposé (fait par Fouka, hors de ma portée).
2. Ajouter un scan de secrets basique en pré-commit ou CI dès qu'un `.github/` existe (P1, dépend de la décision CI/CD).
3. Documenter qui a accès au dashboard Supabase et au dashboard Stripe (organisationnel, pas technique).
4. Différer la séparation test/live et le gestionnaire de secrets centralisé à une décision budget/architecture explicite (cf. plan de remédiation) — ne pas les improviser sans validation.
