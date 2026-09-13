# Avant d'ouvrir aux clubs et de lancer le Pass Photo — état au 13/09/2026

Quatre audits en lecture seule (équipes et effectifs, invitations, Pass Photo, espace Connect du
joueur), plus mes propres vérifications en base. Ce document dit ce qui est prêt, ce qui bloque, et
dans quel ordre agir. Chaque blocage a été vérifié personnellement, pas seulement rapporté.

---

## Ce qui est prêt, et qu'il ne faut pas casser

- **Stripe est configuré et éprouvé** : un vrai paiement de 4 € est passé le 10/09, avec filigrane,
  téléchargement HD signé, e-mail de commande et remboursement. Rien de nouveau à payer.
- **Le parcours d'invitation d'un coach fonctionne**, prouvé en réel : envoyée 15:03, ouverte
  15:04, acceptée 15:04, le 11/09. C'est celui qui part de la fiche d'équipe (« Inviter un
  encadrant »), pas l'autre.
- **La file d'envoi des e-mails marche** : 72 envois, 72 aboutis, zéro échec, cron toutes les
  minutes.
- **L'écran de configuration des ventes photo existe** et il est complet : OS → Médias & Ventes,
  modèle (dont Pass Saison), produits, périmètre club/équipe/événement, opérations.
- **Les trois clubs ont un contrat Full Communication actif** : aucun plafond de plan ne bloquera.
- **RCP Fontainbleau a déjà ses 33 équipes**, un administrateur et un coach actifs.

---

## Ce qui bloque, dans l'ordre

### A. Des données à corriger, sans une ligne de code

| # | Constat vérifié | Conséquence |
|---|---|---|
| A1 | **`media_club_policy` est vide pour les trois clubs** | `resolve_media_policy` répond « aucune vente » partout : aucune famille ne peut voir ni acheter quoi que ce soit. **Blocage n°1.** |
| A2 | **Aucun produit média pour RCP ni Villemomble** | Rien à vendre, même une fois la politique posée. |
| A3 | **Deux clubs « Fontainebleau » en base** : le vrai est saisi « RCP Fontain**b**leau » (sans le e), un doublon vide « RCPF Fontainebleau » porte l'orthographe correcte | Un joueur qui cherche son club tombe sur le doublon vide : sa demande d'adhésion n'y sera jamais validée, personne n'y étant. |
| A4 | **Un club de test, « ZZ Club Circuit API (test) », est visible** dans la recherche des joueurs | Un vrai joueur peut s'y inscrire. |
| A5 | **Les deux produits de test de Villeneuve sont `active` en production**, à 2 € et 4 € | Réellement achetables par les familles de ce club. |
| A6 | **RCP n'a aucun code d'équipe** | Seule l'adhésion par code s'auto-valide. Sans code, chaque joueur attend une validation manuelle. |
| A7 | **RCP a 0 joueur et 0 effectif** | Aucune famille n'existe : personne à qui vendre, personne à qui montrer des photos. |
| A8 | **« Test galerie U9 » : 61 aperçus fabriqués SANS filigrane**, dans un bucket public, galerie en accès libre | La passer en payante donnerait les 61 photos en clair, en 1600 px. L'outil de régénération existe, mais son garde-fou ne se déclenche qu'à la publication : cette galerie étant déjà publiée, rien n'alertera. |

### B. Du code à écrire, court et précis

| # | Constat vérifié | Correctif |
|---|---|---|
| B1 | **Le Pass Photo se vend mais ne livre pas.** `gallery-download` ne consulte que `media_download_grants` et `media_order_items` : le mot `media_entitlements` n'y apparaît nulle part. | Brancher `gallery-download` sur les droits d'abonnement. Tout le reste existe : signature 5 min, bucket privé, `can_access_media`. |
| B2 | **`secure_collection_ref` est NULL sur les trois galeries**, et aucun écran de l'OS ne permet de le renseigner. Connect traite « pas de lien » comme « pas de droit » et affiche « Accès indisponible ». | Ouvrir la galerie par son lien de partage plutôt que par cette référence, ou permettre de la saisir. |
| B3 | **Personne chez SportVision ne peut importer un effectif.** `match_player_candidates` exige `is_club_admin` : le CM et le compte SportVision reçoivent « Non autorisé ». Seul le président passe. | Une ligne : accepter aussi qui peut préparer le club. |
| B4 | **Le compte de Fouka n'ouvre aucun espace Club+.** `cm_espaces_clubs()` filtre sur le rôle `cm` ; son rôle est `admin` → zéro espace, alors que la RLS lui ouvre les trois clubs. | Accepter l'administrateur SportVision. Sinon : emprunter le compte CM. |
| B5 | **Le lien d'invitation de `clubplus-invite` dépose le coach sur un écran qui ne lit pas son jeton** : la racine renvoie au tableau de bord, et seul `/auth/reset` consomme le jeton. Il arrive sans mot de passe. | Une ligne : viser `/clubplus/auth/reset`. En attendant, utiliser l'autre parcours, celui qui marche. |
| B6 | **Un CSV réel sera refusé** : les en-têtes sont normalisées sans retirer les accents, « Prénom » devient `prnom` → « colonnes obligatoires manquantes ». | Décomposer les accents à la normalisation. |
| B7 | **Trois moments-clés ne préviennent personne** : une demande d'adhésion qui attend, une adhésion validée (l'écran promet pourtant « vous serez prévenu »), une galerie publiée après la validation d'un joueur. | Trois déclencheurs, même modèle que ceux déjà posés. |
| B8 | **Renommer ou archiver une équipe n'existe sur aucun écran.** La base sait tout faire, y compris propager un renommage sur onze tables. | Il ne manque que le bouton. |

### C. Des décisions qui t'appartiennent

1. **Le prix du Pass Photo n'existe nulle part** : ni en base, ni sur la vitrine, ni dans le
   catalogue. Les 30 € cités dans l'audit du 12/09 étaient un exemple de rédaction, pas un tarif.
2. **Le reversement au club (`revenue_share_pct`) n'est utilisé par aucun calcul.** Promettre un
   pourcentage à un président se solderait par un calcul à la main.
3. **Les mineurs n'ont pas de chemin propre** : la validation exige trois autorisations signées par
   un parent confirmé, et rien dans le parcours joueur ne crée ce lien ni n'invite le parent. Tant
   que ce n'est pas tranché : inviter le **parent** en désignant l'enfant, jamais le joueur mineur
   seul.

---

## Le chemin le plus court pour encaisser cette semaine

Le circuit **galerie par lien avec offres** est le seul éprouvé de bout en bout, sur un vrai
paiement : lien public, aperçus filigranés, formules, paiement, téléchargement HD, e-mail,
remboursement. Il ne dépend ni de l'effectif, ni des comptes Connect, ni du Pass Photo.

Le Pass Photo est le bon modèle commercial — récurrent, adossé au club — mais il lui manque la
livraison (B1) et l'ouverture de la galerie (B2). Ce sont deux correctifs courts, pas un chantier.
