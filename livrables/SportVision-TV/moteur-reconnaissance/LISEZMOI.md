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
| `dossards.mjs` | Lire les numéros de maillot — voir l'en-tête du fichier |

## Match ou entraînement

Depuis la v390, une galerie dit ce qui a été photographié (`media_albums.type_evenement` : match,
entrainement, plateau, tournoi, stage, autre). **Sur un entraînement et sur un stage, il n'y a pas de
dossard** : le moteur ne cherche aucun numéro et travaille par le visage seul.

La règle n'est pas écrite dans ce dossier. Le moteur demande à la base, une fois par galerie :

```
galerie_numero_utile(<galerie>)  ->  faux pour un entrainement ou un stage, vrai partout ailleurs
```

Une galerie dont le type n'est pas précisé répond **vrai** : c'est le comportement d'avant la v390,
numéro compris. Si la base ne répond pas, le moteur lit les dossards comme avant et le dit dans son
journal — rater un numéro coûte une photo non proposée, ne plus jamais en lire coûterait 7 % des
photos de tous les matchs.

### Ce que le visage seul coûte, mesuré le 01/10/2026

Détection seule sur trois galeries réelles, sans aucune empreinte calculée ni conservée :

| Galerie | Photos | Photos sans **aucun** visage | Personnes sans visage visible | Photos avec un numéro lu |
|---|---|---|---|---|
| RCPF VS PSG U16 (match) | 110 | **11,8 %** (13) | 19,1 % (48/251) | 5,5 % (6) |
| Villemomble plateau U6-U7 | 150 | 3,3 % (5) | 14,0 % (31/222) | 0 % |
| RCPF AMIENS Ecole de foot | 96 | **0 %** | 4,6 % (16/346) | 0 % |

Lecture : sur un **match**, une photo sur huit ne montre aucun visage — le numéro est la seule prise,
et il en rattrape 4 sur 13. Sur une séance d'**entraînement ou d'école de foot**, il n'y a pas de
photo sans visage : on photographie de face, de près. Le visage seul n'y perd donc **rien**, et le
numéro n'y apportait rien non plus (0 numéro lisible sur 96 photos).

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
node moteur.mjs --album=<id> # une galerie précise, même hors file
```

`--simuler` existe pour une raison précise : le 28/09, mesurer a détruit les marquages que Fouka
venait de valider à la main. Mesurer ne doit plus jamais abîmer ce qu'on mesure.

## Les seuils

Ils appartiennent à l'espace d'ArcFace et **n'ont rien à voir** avec les 0,42 / 0,55 de l'ancien
modèle. Les recopier serait refaire la faute du 28/09 : mesurer dans une unité et trancher dans une
autre, ce qui avait attribué 79 photos sur 110 au mauvais enfant. Le détail des mesures est dans
l'en-tête de `moteur.mjs`.
