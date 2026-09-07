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

## `galerie-publique.test.mjs`

Parcours réel de la galerie publique dans Chromium, sur la vraie base et les vraies photos :
iPhone 13, iPad, desktop 1440 et petit écran 320 px.

Couvre : ouverture sans compte, lien invalide / jeton absent / galerie inexistante, affichage des
seules photos publiables, absence de tout chemin d'original dans la page, réservation de la place
des vignettes, sélection et désélection, bascule automatique vers le pack le plus avantageux,
panier, visionneuse (compteur, aperçu 1600 px, swipe tactile réel via le protocole Chrome, flèches
clavier, Échap), persistance de la sélection après visionneuse et après rechargement, nombre de
colonnes par format d'écran, absence de débordement horizontal.

```bash
# 1. lancer l'app localement
cd livrables/SportVision-Connect/app-connect && npm run build && npx next start -p 3311

# 2. dans un autre terminal, avec le lien d'une galerie publiée
SLUG=villneuve-cup-u18 TOKEN=... SHOTS=/tmp \
  node livrables/SportVision-TV/tests/galerie-publique.test.mjs
```

Les captures d'écran sont écrites dans `$SHOTS` : elles servent à juger le rendu, pas seulement à
vérifier que ça marche.

## `galerie-tarifs.test.sql`

17 scénarios sur le **moteur de prix**, qui vit en base et nulle part ailleurs : c'est le même code
qui affiche un total à l'écran et qui facture. Tout tourne dans une transaction annulée.

Couvre : tarif unitaire, bascule automatique vers le pack dès qu'il devient plus avantageux,
combinaison pack + unités, pack qui déborde volontairement, album complet qui devient optimal,
absence d'album complet, galerie vendue uniquement en album complet (aucune économie annoncée sans
référence unitaire), pack sans taille configurée (ignoré, jamais appliqué au hasard), égalité de
prix (le plus petit produit gagne), devis ferme, photo étrangère à l'album, mauvais jeton.

```bash
python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' \
  livrables/SportVision-TV/tests/galerie-tarifs.test.sql > /tmp/q.json
curl -s -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" -d @/tmp/q.json
```

## `galerie-checkout.test.sh`

Chaîne de paiement complète, sur la vraie base et les fonctions réellement déployées. **Aucun
paiement n'est encaissé** : on vérifie que la commande est créée au bon prix, que ce prix ne peut
pas être forcé depuis le client, puis on place la commande dans l'état que produit le webhook pour
tester la livraison. Tout est supprimé à la fin, et le script le vérifie.

Couvre : session Stripe créée, prix calculé en base, commande invitée sans compte ni bénéficiaire
inventé, montant forcé par le client ignoré, mauvais jeton, photo étrangère à la galerie, e-mail
invalide, récapitulatif de commande, signature d'un original acheté, photo non achetée refusée,
jeton invalide, droit expiré, commande non payée.

```bash
bash livrables/SportVision-TV/tests/galerie-checkout.test.sh
```

## `galerie-paiement-reel.verif.sh`

À lancer **après** un vrai achat, pour constater la chaîne de bout en bout. Ne crée rien, ne
modifie rien : il ne fait que vérifier, et dit précisément où ça casse si ça casse.

Retrace, dans l'ordre : commande passée à `paid` avec son `payment_intent`, montant débité, droit
de téléchargement créé par le webhook et sa durée, e-mail parti (ou encore en file), original
réellement téléchargeable via une URL signée, photo NON achetée refusée, et rattachement à un
compte Connect quand il existe.

```bash
bash livrables/SportVision-TV/tests/galerie-paiement-reel.verif.sh <slug-de-la-galerie>
```
