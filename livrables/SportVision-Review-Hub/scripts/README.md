# Scripts de seed Review (Phase 2)

Trois scripts, à lancer dans cet ordre, avec `SUPABASE_MANAGEMENT_TOKEN` exporté
dans l'environnement (jamais commit) :

1. `generate-personas-data.py` — génère `personas.json` localement (UUIDs déterministes
   pour cette exécution + mots de passe aléatoires forts). **Ce fichier contient des
   secrets (mots de passe) : ne jamais le committer.** Régénérer = nouveaux mots de passe
   pour tous les personas.
2. `provision-personas.py` — lit `personas.json`, crée/rafraîchit les clubs, équipes,
   `auth.users` réels et lignes métier sur le projet Supabase Review. Idempotent
   (`ON CONFLICT DO NOTHING`/`DO UPDATE`) — rejouable sans dupliquer les données.
3. `rls-tests.py` — se connecte avec chaque persona (vrai `signInWithPassword`) et
   exécute la matrice de tests RLS via de vraies requêtes REST signées. Écrit le
   résultat dans `/tmp/review-rls-results.json`.

## Garde-fou anti-production (Phase 2, point 11 — à durcir avant un vrai bouton reset)

Chaque script est câblé en dur sur `PROJECT_REF = "ffjktzmsezfrwmrtlhzo"` (le projet
Supabase **Review**, jamais la production). Avant de construire un bouton de reset
utilisable en un clic, ajouter une vérification explicite qui refuse de s'exécuter
si le ref ne correspond pas exactement à ce projet.

## Après re-génération des mots de passe

Si `generate-personas-data.py` est relancé, les mots de passe des `auth.users`
Review changent. Il faut alors aussi mettre à jour la variable d'environnement
Netlify `REVIEW_PERSONA_PASSWORDS` du site `sportvision-review-hub` (JSON
`{ "persona_key": "mot_de_passe", ... }`) pour que la fonction serveur
`persona-session` (mécanisme « Voir comme ») reste synchronisée.
