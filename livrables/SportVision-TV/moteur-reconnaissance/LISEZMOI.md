# Le moteur de reconnaissance

Remplace `scripts/reconnaissance-automatique.mjs`, qui tournait dans un Chromium avec face-api
(SSD MobileNet + descripteur 128 dimensions, 2017). Ici, rien qu'un processus Node.

| | Ancien | Nouveau |
|---|---|---|
| Détection | SSD MobileNet v1 | SCRFD 10G (5 points de repère) |
| Empreinte | face-api, 128 dimensions | ArcFace w600k_r50, 512 dimensions |
| Exécution | navigateur + WebGL | onnxruntime-node + sharp |
| Sur 110 photos réelles | 9 visages | 283 visages |

## Les fichiers

| Fichier | Rôle |
|---|---|
| `visages.mjs` | Détecter, aligner, calculer une empreinte |
| `grappes.mjs` | Regrouper les visages d'une même personne dans une galerie |
| `moteur.mjs` | Le passage complet : file d'attente, base, marquages |
| `dossards.mjs` | Lire les numéros de maillot — **non branché**, voir l'en-tête du fichier |

## Les modèles

`modeles/detection.onnx` et `modeles/reconnaissance.onnx` viennent du paquet **buffalo_l**
d'InsightFace (`det_10g.onnx` et `w600k_r50.onnx`). Ils ne sont pas dans Git : 190 Mo qui ne
changent jamais n'ont rien à faire dans l'historique d'un dépôt.

```
https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip
```

## Lancer

```bash
node moteur.mjs              # vide la file une fois
node moteur.mjs --boucle     # attend et vide, sans fin (c'est le service)
node moteur.mjs --simuler    # mesure sans rien écrire en base
node moteur.mjs --voir       # détaille chaque photo
node moteur.mjs --album=<id> # une galerie précise
```

`--simuler` existe pour une raison précise : le 28/09, mesurer a détruit les marquages que Fouka
venait de valider à la main. Mesurer ne doit plus jamais abîmer ce qu'on mesure.

## Les seuils

Ils appartiennent à l'espace d'ArcFace et **n'ont rien à voir** avec les 0,42 / 0,55 de l'ancien
modèle. Les recopier serait refaire la faute du 28/09 : mesurer dans une unité et trancher dans une
autre, ce qui avait attribué 79 photos sur 110 au mauvais enfant. Le détail des mesures est dans
l'en-tête de `moteur.mjs`.
