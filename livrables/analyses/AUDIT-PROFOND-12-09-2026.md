# Audit profond du 12/09/2026 — ce qui a été trouvé, ce qui a été corrigé

Seize agents de lecture ont fouillé l'OS, Club+, Connect, la vitrine, les connecteurs entre les
quatre, et la base de production. Onze rapports, environ 250 défauts remontés. Ce document ne
garde que ce qui a été **vérifié par moi-même** puis **corrigé**, et ce qui reste ouvert.

Méthode : chaque correction a un test qui était ROUGE avant et VERT après. La batterie complète
(123 suites) est repassée après chaque lot. Trois rapports ont été partiellement démentis en les
vérifiant — c'est dit plus bas.

---

## Sécurité — six failles P0

| # | Ce qu'on pouvait faire | Correctif |
|---|---|---|
| 1 | Devenir **parent confirmé d'un enfant de n'importe quel club** : ouvrir un Club+ Gratuit, s'inviter avec le `player_id` d'un enfant d'un autre club, accepter. Le lien naissait `confirme` : fiche du mineur, calendrier, photos, achats, photo de visage. | v188 + contrôle dans `clubplus-family-invite`. Les deux se doublent volontairement. |
| 2 | **Deviner un code d'équipe** : `SV-` + catégorie + 4 chiffres de `random()`, soit 13 bits, avec un oracle public sans limite de débit. 200 tirages donnaient déjà 5 doublons. Toléré tant qu'un humain validait ; depuis la v186, l'adhésion par code s'auto-valide. | v189 : tirage cryptographique (~49 bits, sans I L O 0 1), oracle limité en débit, les 2 codes de production refaits. |
| 3 | **Effacer les originaux vendus de tous les clubs**, ou remplacer l'aperçu public d'une galerie en vente. Les policies d'écriture du stockage ne regardaient aucun album. | v190. En corrigeant au passage le périmètre du photographe, qui ne connaissait que les missions alors qu'aucun album n'en a : il se voyait refuser sa propre galerie. |
| 4 | **Lire le CV de n'importe quel candidat** : la policy ne vérifiait aucun rôle. | v190 : le CV suit l'autorisation de la candidature. |
| 5 | **Forger une rétractation sur un vrai client** : `%@%.%` partait tel quel dans un `ilike`, tombait sur la première fiche venue, et la réponse rendait à un inconnu la référence réelle d'une commande. | Jokers refusés. Vérifié fermé en réel sur la fonction déployée. |
| 6 | **Fabriquer un compte confirmé sur l'adresse d'autrui** (invitation directe), puis hériter de sa fiche client via `portal-onboarding`. | Refus si l'adresse porte déjà une fiche client. Le mode direct, qui sert vraiment, est conservé. |

Au passage : envoi de devis, factures et contrats par e-mail réservé au staff financier et compte
actif — c'était un relais d'envoi signé SPF/DKIM ouvert à tout collaborateur. Et un lien
d'activation Club+ encore vivant a été révoqué en production.

---

## Argent

- **La seule facture réelle serait partie à Pennylane à 0,00 €**, en facture électronique légale et
  irrévocable : le code lisait `prix_unitaire ?? pu ?? 0` et la ligne s'appelle `montant_ht`.
  Corrigé, avec un garde-fou qui refuse tout envoi dont le détail ne redit pas le montant.
- **La remise d'un devis était refacturée au client** : les lignes restaient brutes. Elle devient
  une vraie ligne.
- Le PDF lisait le devis et la prestation, modifiables après émission : deux documents différents
  pouvaient sortir sous le même numéro. Il lit la facture émise. Une facture émise est désormais
  **immuable**, suppression comprise (v191).
- **Les relances d'impayés n'avaient jamais été installées** (migration du 06/08). Installées et
  vérifiées de bout en bout.
- **Montage par lien de match** : le site annonce 40/55/70/80 € TTC, ces montants étaient stockés
  en HT, le paiement encaissait 48/66/84/96. Même décision que le matin : le prix client ne bouge
  pas. Et le palier choisi ne partait que dans un commentaire libre : 4 matchs annoncés 80 € se
  facturaient 39,90 €.
- **Connect** : le plafond d'abonnement se contournait en cliquant « Particulier » (v197) ;
  résilier ne retirait aucun accès, un mois de Pro achetait 20 accès à vie (v198) ; en impayé,
  l'écran proposait de souscrire une **seconde** fois, et le premier prélèvement devenait
  introuvable.

---

## Ce qui ne se parlait pas

- **Les contenus livrés n'arrivaient jamais à la famille**, et pas par oubli d'écran : la table que
  la famille peut lire n'avait aucun écrivain, et un livrable ne pouvait même pas se voir accorder
  une visibilité famille. « Mes contenus » était vide par construction (v196). Le club n'était pas
  davantage prévenu d'une livraison.
- **Une galerie sans équipe — un tournoi — n'apparaissait jamais côté famille** (v195).
- **Ce qui était payé se perdait à la transition de saison** : le contrôle « êtes-vous une famille
  aujourd'hui » passait avant le contrôle du paiement. Un Pass Saison à 30 € devenait inaccessible
  le soir de la bascule (v200). Et le modèle de vente photo, entièrement par saison, n'était pas
  recopié : plus rien n'était vendable jusqu'à intervention humaine (v201).
- **Le parent signait ses autorisations et rien ne bougeait** (v193). **L'invitation « parent »
  n'envoyait jamais l'enfant**, donc aucun lien parent/enfant n'était créé. **Le parent ne pouvait
  ni payer ni retrouver sa commande** (v199).
- **La demande d'un coach ou d'une académie ne prévenait personne** (v194).
- **« Demander un complément » n'arrivait nulle part** : la note était écrite dans une table
  qu'aucun code ne lit (v205).
- **Les comptes réseaux confiés par deux vrais clubs** n'étaient lus nulle part dans l'OS.
- **Les matchs fédéraux des équipes suivantes n'étaient jamais créés** sur un plateau de jeunes, et
  les 25 rapprochements d'équipes confirmés à la main ne servaient à rien (v204).
- **Deux saisons étaient actives en même temps**, parce que toute saison naissait active (v203).

---

## Terrain et interfaces

- L'opérateur **ne pouvait pas rendre son kit** : le chemin opérateur n'appelait pas les effets de
  fin de mission. Zéro contrôle matériel depuis la création du module. Et les deux kits, réservés
  globalement sans date de retour, n'étaient plus jamais proposés.
- **392 notifications, zéro lue** : ouvrir une notification ne la marquait pas lue.
- Deux écritures sur les pôles affichaient « mis à jour » sans rien changer.
- Les rappels terrain surveillent des seuils de 4 h et tournaient une fois par jour.
- « Annuler la sélection » **annulait les demandes** au lieu de vider la sélection.
- Le retrait d'une photo des familles pouvait afficher « enregistré » sans rien retirer — le geste
  du droit à l'image était le seul des trois modes qui mentait.
- Le champ Photo du Studio était une zone de dépôt **inerte** : le club payait un crédit pour une
  demande sans photo.
- Vitrine : notes d'audit internes servies publiquement, Google Analytics absent des politiques,
  page 404 en anglais, zoom iOS sur 32 pages, « TTC » à 2,58:1 de contraste, et « une équipe est
  disponible » répondu hors zone d'intervention.
- Achat de photos : **aucune CGV, aucun vendeur identifié, aucune renonciation à la rétractation**
  avant un téléchargement immédiat.

---

## Ce que les rapports ont dit de trop

Trois points ont été démentis en les vérifiant, et méritent d'être notés pour ne pas y revenir :

1. « L'UI appelle la mauvaise fonction d'acceptation » : la fonction appelée est la plus complète
   des deux, et l'écran des autorisations liste tous les types sans avoir besoin de lignes
   amorcées. `account_status` ne sert qu'à exclure retiré/suspendu, il ne garde aucun accès.
2. « Le lecteur seul est bloqué par les policies restrictives » : mon premier test le confirmait…
   parce que je l'appelais avec cinq arguments au lieu de six. En demandant le message d'erreur
   plutôt que le verdict, le vrai état est apparu : il n'était pas bloqué du tout (v202).
3. Les timeouts 57014 vus au balayage ne sont pas des défauts d'écran : la requête rend 3 lignes en
   79 ms à chaud, mais 169 ms rien que pour planifier tant les expressions de RLS sont lourdes. Le
   test ouvre sept rôles en parallèle. Relancé seul : 7/7. À surveiller quand le parc grandira.

---

## Ce qui reste ouvert, et qui demande une décision

1. **La fusion dans `main`.** Les correctifs base et Edge Functions sont en production. Tous les
   écrans (OS, Club+, Connect, vitrine) attendent la fusion.
2. **`FAC-2026-0023`** (890 € HT) n'a ni client ni prestation : aucun club ne la verra jamais, et
   elle ne peut être ni envoyée ni relancée. À rattacher ou à annuler — c'est une pièce comptable,
   je n'y touche pas seul.
3. **L'argent Stripe des médias ne rejoint aucune écriture comptable** : ni facture, ni paiement,
   ni TVA collectée, ni FEC. La séparation est assumée pour le pilotage, mais elle a été appliquée
   jusqu'au FEC. Un remboursement réel de 4 € existe déjà sans trace comptable.
4. **Le FEC perd structurellement des factures** : il n'exporte que les factures déjà payées,
   filtrées sur la date d'émission. Une facture de septembre payée en novembre n'est dans aucun
   export.
5. **Les textes juridiques ajoutés** (Google Analytics, vendeur et rétractation dans le tunnel
   photo) sont à faire relire.
6. **Les codes d'équipe de SF Villemomble et Villeneuve ont changé.** Aucun n'avait servi, mais
   s'ils ont été partagés, il faut les rediffuser.
