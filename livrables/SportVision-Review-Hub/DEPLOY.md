# Déploiement des 4 sites Review — règle anti-confusion

Incident du 10/09/2026 : un `netlify deploy` lancé depuis le dossier du Hub a
écrasé temporairement OS Review, parce que le sous-dossier `os-review/`
n'avait pas son propre `.netlify/state.json` et héritait silencieusement du
lien Netlify du dossier **parent**. Corrigé, mais la cause reste réelle : le
CLI Netlify remonte au premier `.netlify/state.json` trouvé en parcourant les
dossiers parents, pas seulement le dossier courant.

## Les 4 sites, isolés

| Site | Dossier local | Site ID |
|---|---|---|
| `sportvision-review-hub` | `livrables/SportVision-Review-Hub/` | `276c3ce3-3144-4d25-93d7-3d15f815f199` |
| `sportvision-os-review` | `livrables/SportVision-Review-Hub/os-review/` (sous-dossier du Hub) | `2b15e728-0c3e-4c5a-a14e-b6eec0f556bc` |
| `sportvision-clubplus-review` | `livrables/SportVision-Connect/app-next/` | `254530ef-e6de-4f61-8f4b-98587f9f0f9a` |
| `sportvision-connect-review` | `livrables/SportVision-Connect/app-connect/` | `e2c607fb-ff2c-4f8a-95db-e559a5e53378` |

Aucun n'est relié à un dépôt GitHub (pas de `repo:` dans `netlify sites:list`)
— déploiement manuel uniquement, jamais de build automatique déclenché par un
push.

## Règle avant tout `netlify deploy`

1. `cd` dans le bon dossier.
2. **Toujours** `netlify status` et lire la ligne `Current project:` avant de
   déployer — jamais supposer que le dossier courant a son propre lien.
3. Si `Current project` ne correspond pas au site attendu (cas particulier
   d'un sous-dossier d'un site déjà lié, comme `os-review/`), écrire
   directement `.netlify/state.json` avec le bon `siteId` plutôt que
   `netlify link` (qui peut écrire dans le lien du parent si le sous-dossier
   n'a pas encore le sien).
4. Ne jamais lancer `netlify deploy` depuis un dossier parent immédiatement
   après avoir travaillé dans un sous-dossier lié à un autre site — revérifier
   `Current project` à chaque changement de dossier.
