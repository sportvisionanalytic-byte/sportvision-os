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

## `galerie-offres-par-lien.test.sql`

25 scénarios sur le modèle « une galerie, plusieurs liens, plusieurs tarifs ». Transaction annulée.

Couvre : deux liens vers le même album à 15 € et 30 €, mêmes photos des deux côtés, une seule
offre affichée sur un lien configuré, lien historique qui garde le catalogue complet, prix
indépendant de la sélection, pack avec quota et aucune photo figée à l'achat, sélection
post-paiement (trop de photos refusée, photo étrangère refusée, second choix refusé car
définitif), récapitulatif, attribution de la commande au lien, changement de prix sans effet sur
une commande payée, produit désactivé (le lien cesse de vendre au lieu de retomber sur le
catalogue), lien désactivé, et permissions par rôle.

```bash
python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' \
  livrables/SportVision-TV/tests/galerie-offres-par-lien.test.sql > /tmp/q.json
curl -s -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" -d @/tmp/q.json
```

## `galerie-permissions-tarifs.test.sql`

24 scénarios sur « qui a le droit de fixer un prix de galerie ». Transaction annulée.

Vérifie la règle rôle par rôle sur de vrais comptes de la base (fondateur, admin, responsable
production, secrétariat, photographe, CM, comptabilité), et pas seulement la fonction :
`media_pricing_staff()` d'un côté, la RLS réelle sur `media_album_links` de l'autre (lire,
créer, modifier le prix, supprimer). Vérifie aussi que le secrétariat garde tous ses autres
droits médias inchangés (`media_staff_write`, `media_upload_staff`, `media_commerce_staff`, et la
lecture du lien pour l'envoyer aux parents), que le photographe garde son album, que le CM ne voit
rien, que le responsable de pôle actif peut vraiment écrire, qu'il perd le droit dès qu'il est
retiré du pôle, qu'un simple membre ne l'a jamais, et que le chiffre d'affaires par lien reste
réservé.

```bash
python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' \
  livrables/SportVision-TV/tests/galerie-permissions-tarifs.test.sql > /tmp/q.json
curl -s -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" -d @/tmp/q.json
```

## `galerie-parcours-formules.test.sql`

27 scénarios sur le parcours « formule » de bout en bout. Transaction annulée.

Couvre : l'offre annoncée dès l'ouverture de la page (galerie complète, pack, lien historique sans
offre), les mêmes photos des deux côtés d'un album vendu à deux prix, le devis sans aucune
sélection, le prix qui ne bouge plus quand on coche des photos, la galerie complète figée à
l'achat, puis tout le choix post-paiement : l'acheteur voit l'album, la pagination, le refus au
delà du quota, l'acceptation, l'album qui cesse d'être exposé une fois le choix fait, le second
choix refusé. Vérifie aussi ce que l'écran de choix refuse de montrer (jeton inventé, commande non
payée, droit expiré, galerie complète sans objet), le produit désactivé qui ne fait pas retomber le
lien sur le catalogue public, le lien désactivé, et l'attribution du chiffre d'affaires par lien.

```bash
python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' \
  livrables/SportVision-TV/tests/galerie-parcours-formules.test.sql > /tmp/q.json
curl -s -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" -d @/tmp/q.json
```

## `galerie-formules-ui.test.mjs`

26 scénarios dans un vrai Chromium, sur la galerie EN PRODUCTION, en iPhone et en bureau.

Vérifie que le nouveau parcours est bien celui qui est servi : le prix visible sans rien avoir
coché, la formule nommée, plus aucun panier ni coche de sélection, aucun défilement horizontal, le
bouton d'achat présent jusque dans la visionneuse, le même montant sur l'écran de paiement que sur
la barre d'achat, et le récapitulatif qui reprend la formule. Vérifie aussi, en écoutant le réseau,
qu'aucun original n'est servi à la page publique et que les aperçus viennent bien du bucket public.

Deux pièges appris ici : `Intl.NumberFormat("fr-FR")` insère une espace fine insécable avant le €
(chercher « 4 € » avec une espace ordinaire ne trouve rien), et `innerText` rend les libellés de
champs en majuscules à cause du `text-transform` CSS.

```bash
node livrables/SportVision-TV/tests/galerie-formules-ui.test.mjs
```

## `galerie-apercu-limite.test.sql`

18 scénarios sur la vitrine avant achat, avec un album de 200 photos. Transaction annulée.

Ce test compte ce qui SORT DE LA BASE, pas ce qui s'affiche : c'est tout l'objet du lot, une
limite d'affichage se contourne depuis l'inspecteur du navigateur en dix secondes.

Couvre : 12 photos servies par défaut sur une demande de 200, le vrai total toujours annoncé
(c'est l'argument de vente), l'impossibilité de contourner en paginant (offset 12 ne rend rien,
les pages ne se répètent pas), la limite réglable par lien avec deux vitrines différentes sur le
même album, la vitrine choisie en réordonnant l'album, la 50e photo jamais servie sur aucune page,
et surtout : la galerie complète vend bien les 200 photos, pas seulement les 12 montrées.

```bash
python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' \
  livrables/SportVision-TV/tests/galerie-apercu-limite.test.sql > /tmp/q.json
curl -s -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" -d @/tmp/q.json
```

## `galerie-offres-multiples.test.sql`

35 scénarios sur le cas tournoi : un lien, trois formules, sélection AVANT paiement. Album de
30 photos. Transaction annulée.

Couvre : trois formules sur un lien, le prix ET le quota du lien qui priment sur le catalogue
(un seul produit « pack » sert à 10 photos ici et 20 ailleurs), toutes les photos parcourables
avant achat (indispensable pour retrouver son enfant sur un tournoi), le prix qui ne bouge pas
pendant la sélection, moins que le quota permis mais jamais plus, la galerie complète sans
sélection, et toutes les manipulations : offre d'un autre lien, offre inventée, photo étrangère
à l'album, jeton invalide, prix forcé, offre désactivée, produit retiré du catalogue, lien
désactivé. Vérifie enfin les permissions par rôle (secrétariat inclus depuis le 07/09 au soir).

```bash
python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' \
  livrables/SportVision-TV/tests/galerie-offres-multiples.test.sql > /tmp/q.json
curl -s -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" -d @/tmp/q.json
```

## `galerie-offres-illimitees.test.sql`

17 scénarios prouvant qu'AUCUNE limite commerciale n'est codée. Transaction annulée.

Sept offres sur un même lien, adossées à deux produits de catalogue seulement, avec des quantités
et des prix arbitraires (5/12/25/17/50 photos à 6/9/14/17/22/35 €), dont une offre gratuite.
Vérifie que 17 veut dire 17 (18 photos refusées), qu'un lien peut ne vendre aucun album complet,
qu'un lien peut n'avoir qu'une seule offre (achetable sans la désigner), que l'ordre affiché est
celui configuré, et que la mise en avant est celle choisie — pas déduite du prix le plus élevé.

```bash
python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' \
  livrables/SportVision-TV/tests/galerie-offres-illimitees.test.sql > /tmp/q.json
curl -s -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" -d @/tmp/q.json
```

## `galerie-constructeur-offres.test.sql`

25 scénarios sur le constructeur d'offres de l'OS, joués EN TANT QUE SECRÉTARIAT (c'est lui qui
prépare les liens au quotidien). Transaction annulée.

Enregistre les sept offres du cahier des charges en une seule fois — 3 photos à 0 €, 5 à 6 €, 12 à
9 €, 17 à 17 €, 25 à 19 €, 50 à 22 €, galerie complète à 35 € — et vérifie que les quotas et les
prix ressortent exacts, que deux produits de catalogue suffisent pour sept offres, et que la mise
en avant est conservée.

Vérifie surtout l'ATOMICITÉ : cinq configurations invalides (pack sans nombre, offre sans nom,
prix négatif, pack de 0 photo, deux offres mises en avant) sont refusées, et après ces cinq refus
les sept offres d'origine sont toujours intactes. Vérifie aussi qu'une modification ne change
jamais le slug ni le jeton — des familles ont déjà le lien — et que photographe, CM et
comptabilité sont refusés.

```bash
python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' \
  livrables/SportVision-TV/tests/galerie-constructeur-offres.test.sql > /tmp/q.json
curl -s -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" -d @/tmp/q.json
```

## `galerie-claim-connect.test.sql`

20 scénarios sur le rattachement automatique d'un achat à un compte Connect. Transaction annulée.

Trois achats invités de la même adresse (deux payés, un en attente), puis : e-mail NON vérifié →
aucun rattachement ; adresse vérifiée → les DEUX commandes payées récupérées d'un coup, pas
seulement celle d'où vient l'utilisateur ; la commande non payée reste dehors ; les droits
deviennent permanents ; rejeu idempotent (0 nouvelle commande, toujours 2 et pas 4). Vérifie
ensuite l'espace Connect : UNE galerie malgré deux achats dessus, union des photos sans doublon
(8 et non 10), mais bien deux commandes distinctes. Enfin, un autre compte vérifié qui connaît
même le jeton ne récupère rien.

## `galerie-clubplus.test.sql`

10 scénarios sur ce que Club+ voit — et surtout ne voit pas. Transaction annulée.

Un album avec trois liens dont un seul confié au club : le club voit sa galerie, le bon nombre de
photos, et UN seul des trois liens. Aucun tarif ne remonte. Un club ne voit rien d'un autre club,
ne lit ni les offres ni les liens en direct, et ne peut pas fixer de prix. Un album non publié
reste invisible.

```bash
for t in galerie-claim-connect galerie-clubplus; do
  python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' \
    livrables/SportVision-TV/tests/$t.test.sql > /tmp/q.json
  curl -s -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
    -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" -d @/tmp/q.json
done
```

## `galerie-achat-connecte.test.sql`

12 scénarios sur l'achat en étant déjà connecté, et sur le fait que le parcours invité n'a pas
bougé. Transaction annulée.

Cas A (invité) : droit de 30 jours, non réclamé, commande qui n'appartient à personne — comme
avant. Cas B (Connect vérifié) : la galerie apparaît immédiatement sans aucun claim, droit
permanent dès le paiement, deux commandes mais une seule galerie, et un claim rejoué ne trouve
plus rien à rattacher. Cas C : un compte NON vérifié est refusé même en fournissant le jeton de la
commande. Cas D (offre gratuite) : commande à 0 présente et droit permanent.

Vérifié en plus contre la fonction déployée, avec une vraie session : une adresse forgée dans le
formulaire est ignorée au profit de l'adresse vérifiée du compte.
