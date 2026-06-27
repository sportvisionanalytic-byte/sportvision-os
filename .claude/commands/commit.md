# /commit

> Sauvegarde l'état actuel du workspace dans Git.

---

## Mission

Quand je lance `/commit`, effectue la séquence suivante :

### Étape 1 : Vérifier l'état du repo

Exécute `git status` et `git diff --stat` pour voir ce qui a changé.

### Étape 2 : Rédiger un message de commit

Analyse les fichiers modifiés et génère un message de commit clair en français, en suivant ce format :

```
type: description courte de ce qui a changé
```

Types disponibles :
- `ajout` — nouveau fichier ou nouveau livrable
- `update` — mise à jour d'un fichier existant (contexte, commande, etc.)
- `suppression` — fichier supprimé
- `fix` — correction d'une erreur

Exemples :
- `ajout: pitch club partenaire v1`
- `update: CONTEXT.md avec nouveau club signé`
- `ajout: template devis captation vidéo`

### Étape 3 : Exécuter le commit

Lance les commandes suivantes dans l'ordre :

```bash
git add -A
git commit -m "[message généré]"
```

Le fichier `.env` est protégé par `.gitignore` et ne sera jamais inclus.

### Étape 4 : Confirmer

Affiche un résumé de ce qui a été sauvegardé :

```
Sauvegarde effectuée.

Fichiers inclus : [liste]
Message : [message du commit]
```

---

## Règles importantes

- Ne jamais inclure `.env` dans le commit
- Si rien n'a changé, signale-le simplement sans créer de commit vide
- Le message de commit est toujours en français
- Pas de tirets longs (em dashes) dans les réponses
