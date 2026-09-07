# Tests — Galeries SportVision

Deux tests réels, à rejouer après toute modification de la chaîne média.

## `galerie-derives.test.mjs`

Vérifie la génération des dérivés **dans un vrai navigateur** : c'est la seule partie du dépôt qui
s'exécute côté client (décodage EXIF, redimensionnement, filigrane, encodage WebP) et elle ne peut
donc pas être testée depuis Node.

Le test **extrait les fonctions directement de `SportVision-OS-Full.html`** plutôt que d'en garder
une copie : il teste le code réellement livré, et il casse si quelqu'un renomme ou déplace une de
ces fonctions.

```bash
node livrables/SportVision-TV/tests/galerie-derives.test.mjs
```

La page est servie depuis `127.0.0.1` et non `about:blank`, à dessein : `crypto.subtle` n'existe
que dans un contexte sécurisé, exactement comme l'OS servi en https.

## `galerie-stockage.test.sh`

Vérifie la chaîne de stockage **sur la base et les buckets de production** : dépôt de l'original
dans le bucket privé, des dérivés dans le bucket public, dérivation de `photo_count`, et surtout
les propriétés de sécurité — un visiteur anonyme voit l'aperçu, ne récupère pas l'original, ne
peut pas le faire signer, et ne peut rien déposer.

Tout ce qui est créé est supprimé à la fin, et le script le vérifie (album, média, fichiers).

```bash
bash livrables/SportVision-TV/tests/galerie-stockage.test.sh
```

Nécessite `.env` (SUPABASE_MANAGEMENT_TOKEN) et
`livrables/SportVision-Connect/app-next/.env.local` (clés Supabase).
