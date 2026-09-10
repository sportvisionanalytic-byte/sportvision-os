# Edge Functions — procédure de déploiement

## Règle obligatoire

```bash
bash scripts/deployer-fonction.sh <nom-de-la-fonction>
bash tests/fonctions-verification-jwt.test.sh
```

**Jamais `supabase functions deploy` nu.** Règle posée le 10/09/2026, au passage de SportVision en
PRODUCTION MULTI-CLUBS — V1 STABLE.

## Pourquoi

Huit fonctions tournent en production **sans vérification JWT**, et c'est voulu :

| Fonction | Qui l'appelle, sans jeton Supabase |
|---|---|
| `stripe-webhook` | Stripe, à chaque paiement et remboursement |
| `youtrust-webhook` | Youtrust, à chaque signature |
| `create-gallery-checkout` | un parent qui achète sans compte |
| `gallery-download`, `gallery-download-zip` | le lien de téléchargement reçu par e-mail |
| `dispatch-notifications` | le cron d'envoi des e-mails |
| `federation-sync-matchs` | le cron de synchronisation fédérale |
| `clubplus-onboarding` | le parcours d'inscription Club+ |

Aucun fichier du dépôt ne mémorise ce réglage, et `supabase functions deploy <nom>` le repasse par
défaut à `true`. Pour `stripe-webhook`, cela veut dire : Stripe reçoit un 401 à chaque paiement, les
commandes restent « en attente », les droits ne sont jamais créés, les parents paient sans rien
recevoir — **et aucune alarme ne sonne**, puisque Stripe se contente de réessayer.

`scripts/deployer-fonction.sh` relit le réglage réel en production avant de déployer, le reproduit,
puis vérifie qu'il n'a pas bougé. `tests/fonctions-verification-jwt.test.sh` passe au rouge si l'une
des huit fonctions a été redéployée avec la vérification réactivée, quelle qu'en soit la cause.

## Pourquoi pas un `config.toml`

C'est la solution habituelle, mais le CLI lit aussi ce fichier pour `supabase config push`, qui pousse
les réglages d'**authentification**. Un `config.toml` minimal ferait qu'un `config push` distrait
remettrait les valeurs par défaut en production : l'URL du site et la liste blanche des redirections,
donc tous les liens d'invitation et de réinitialisation de mot de passe.

## Ajouter une fonction publique

Si une nouvelle fonction doit être appelée sans jeton (webhook d'un tiers, lien public), la déployer
une première fois avec `--no-verify-jwt`, puis l'ajouter à la liste attendue dans
`tests/fonctions-verification-jwt.test.sh` et au tableau ci-dessus. Le script de déploiement
préservera ensuite ce réglage de lui-même.
