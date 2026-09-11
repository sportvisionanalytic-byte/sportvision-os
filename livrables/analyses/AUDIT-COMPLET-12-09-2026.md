# Audit complet SportVision, 12 septembre 2026

> Cinq audits menés en parallèle (Connect côté familles, Club+ côté coach, OS et chaîne média,
> sécurité des données, textes et cohérence produit), puis correction. Ce document dit ce qui a été
> trouvé, ce qui a été corrigé et vérifié, et ce qui reste à décider ou à faire.

---

## 1. Ce qui a été trouvé

| Audit | P0 | P1 | P2 |
|---|---|---|---|
| Connect, espaces parent et joueur | 5 | 9 | 14 |
| Club+, espace coach et calendrier | 3 | 15 | 8 |
| OS, chaîne prestation → galerie → familles | 3 | 7 | 8 |
| Sécurité des données (RLS, droits, fonctions) | 2 | 8 | 8 |
| Textes et cohérence produit | 8 | 56 | 31 |

Chaque constat a été revérifié avant correction : la moitié environ des « P0 » annoncés se sont
confirmés à l'identique, quelques-uns étaient des lectures trop rapides du code, et deux se sont
révélés plus graves que décrits.

---

## 2. Les failles de sécurité, fermées

Aucune n'était atteignable depuis un écran. Toutes l'étaient par un appel direct à l'API, ce qui
suffit : le jeton d'un compte salarié est dans son navigateur.

1. **N'importe quel compte pouvait se nommer Responsable de pôle.**
   `ensure_default_pole_affectation` était exécutable par tout compte connecté, et même par un
   visiteur. Elle donne accès aux factures, devis, contrats, rémunérations et chiffre d'affaires du
   pôle. Le test rouge montrait un opérateur s'attribuant le rôle en un appel.
2. **Un CM pouvait s'accorder « responsable ».** La colonne `cm_niveau_autonomie` n'était pas
   protégée : passer à « responsable » ouvre les contenus de tous les clients et l'auto-affectation
   de clubs. Même chose pour `niveau_operateur`, qui fixe la rémunération recommandée (45 à 80 €),
   et pour `cm_super_access` d'une agence.
3. **Un opérateur terrain lisait et supprimait les photos de tous les clubs.** Les galeries étaient
   cloisonnées par pôle, la table des photos ne l'était pas. Le test rouge a effectivement supprimé
   la photo d'un autre club avant correction.
4. **Un Responsable Production pouvait se transporter une rémunération validée** en changeant le
   titulaire de la ligne après coup : toutes les gardes « jamais juge et partie » regardaient
   `collaborateur_id`, et il a le droit de le modifier. Reproduit en conditions réelles sur une
   ligne à 500 €, puis fermé.
5. **Le jeton d'accès d'une galerie partait chez un service tiers** pour fabriquer le QR code : le
   secret qui ouvre les photos d'enfants se retrouvait dans les journaux d'un prestataire
   américain. Le QR est désormais fabriqué dans le navigateur.
6. **La médiathèque entière du club partait chez le parent.** La fonction qui la sert contourne la
   RLS par construction et n'appliquait pas la règle de visibilité famille : médias d'autres
   équipes, médias signalés ou masqués, médias montrant un joueur sans droit à l'image.

---

## 3. Les chaînes cassées, réparées

- **Les 677 matchs du club n'arrivaient nulle part côté familles.** Ni le calendrier du joueur, ni
  celui du parent ne lisaient `club_matches`. Les deux les lisent maintenant, avec leur état
  sportif.
- **Reporter ou annuler un match dans le Match Center ne prévenait personne.** Le Match Center
  écrit `status`, le calendrier lit `sport_status`, et le trigger ne recopiait que dans un sens.
  Un match annulé restait « à venir » pour les parents.
- **La notification « nouvelle galerie » envoyait le parent sur une page d'espace joueur**, qui le
  redirigeait : il ne voyait jamais les photos annoncées.
- **Une demande de rattachement parent n'avait aucune issue.** La décision existait en base depuis
  le durcissement du 10/09, mais aucune liste ne montrait les demandes et aucun écran n'appelait la
  décision. Club+ a désormais la carte, dans la fiche d'équipe.
- **Le parent invité par un club atterrissait dans l'espace joueur, vide** : son type de compte
  n'était jamais réglé.
- **Le Responsable Production ne pouvait ni valider ni transmettre une rémunération** depuis un
  poste fixe : l'écran qui porte ces boutons n'était dans aucun menu. Le circuit de paiement des
  opérateurs était bloqué à sa première étape.
- **Enregistrer une galerie détachait sa mission** : le photographe perdait l'accès et le lien du
  montage vidéo disparaissait côté familles.
- **Créer son premier match était impossible** sur un club neuf : la liste des équipes se déduisait
  des événements déjà présents.
- **Le Match Center était vide pour six rôles** du club (secrétaire, trésorier, communication,
  administratif, membre du bureau, lecture seule).

---

## 4. Ce qui a été construit

La chaîne « photos de mon enfant », de bout en bout :

- la Production rattache un joueur à une photo depuis la galerie, à la main aujourd'hui, par
  suggestion du moteur demain, avec une file « à trancher » pour les cas incertains ;
- la famille voit « 12 photos de Lucas » sur la galerie et en ouvre un aperçu de six ;
- le parent donne ou retire son accord de reconnaissance depuis la fiche de l'enfant, dépose une
  photo de référence, et le retrait efface tout, y compris le fichier ;
- une suggestion de machine n'ouvre rien tant qu'une personne ne l'a pas validée ;
- l'accord ne peut être donné que par un parent confirmé ou par un joueur majeur.

---

## 5. Ce qui reste, et qui t'appartient

1. **Prix du Montage & compilation : 39,90 € HT ou TTC ?** C'est la seule ligne affichée hors taxes
   dans une grille grand public entièrement TTC. Un parent qui lit 39,90 € paiera 47,88 €. Deux
   options : afficher 39,90 € TTC (et ramener le prix hors taxes à 33,25 €), ou afficher clairement
   « 47,88 € TTC ». À trancher, je l'applique ensuite partout d'un coup.
2. **Forme juridique : SAS ou SASU ?** L'OS imprime « SAS », le site public écrit « SASU ». Les
   deux documents partent chez le même client. Dis-moi lequel fait foi.
3. **Le serveur de reconnaissance** attend ta commande de VPS (OVH, France, ~15 à 20 € par mois).
   Le reste est prêt et ne coûte rien tant qu'il n'existe pas.
4. **L'analyse d'impact et le texte de consentement** sont écrits, à faire relire par un juriste
   avant la première photo analysée.

---

## 6. Vérifications

- 91 batteries SQL, toutes vertes, dont 12 écrites aujourd'hui, chacune rouge avant correction et
  verte après.
- Les deux applications compilent.
- Le fichier de l'OS passe le contrôle de syntaxe après chaque modification.
