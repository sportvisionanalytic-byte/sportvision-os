# Audit Finance / Rémunération opérateur / Matériel / Formation

Session autonome, nuit du 29/08/2026. Périmètre : `livrables/SportVision-TV/SportVision-OS-Full.html`
(rémunération équipe, module Finance/Comptabilité, Matériel & Kits, Centre de formation).
Toutes les vérifications marquées « testé en réel » ont été faites directement sur la base
Supabase de production via l'API REST/Management (données de test créées puis supprimées,
vérifié après coup — voir détail dans chaque section).

## Corrigé

### 1. « Charges du mois » comptait des dépenses simplement *prévues* comme des charges réelles
`loadComptaDash()` (tuile "Marge brute" du dashboard Finance) sommait la table `expenses` du
mois **sans filtrer sur `statut`**, alors que `expenses.statut` a 4 valeurs possibles
(`prevue`, `engagee`, `payee`, `comptabilisee`) et que **toutes les autres lectures** de charges
réelles du module (`loadComptaResultat`, `loadComptaRentabilite`, `loadComptaTva`, la vue SQL
`v_rentabilite_missions`) filtrent explicitement `statut=in.(engagee,payee,comptabilisee)` pour
exclure les dépenses "prévues" (simple prévision, rien d'engagé). Résultat : une dépense prévue
mais jamais engagée gonflait "Charges du mois" et donc faussait "Marge brute" à la baisse, alors
qu'aucun argent n'a été ni ne sera forcément dépensé — exactement la confusion "dépense prévue
≠ charge réelle" citée dans la mission. Corrigé en alignant le filtre sur celui déjà établi
partout ailleurs (`livrables/SportVision-TV/SportVision-OS-Full.html` ~ligne 21969).

### 2. « Charges du mois » ne réappliquait pas la règle "mission annulée ⇒ pas de nouvelle charge de rémunération"
Même tuile : la rémunération équipe du mois (`remData`) était sommée sans tenir compte du statut
de la prestation parente. Or `loadComptaRem()` (page Rémunérations) applique déjà une règle
précise et volontaire : une mission annulée/refusée après acceptation d'un collaborateur ne doit
**jamais faire apparaître une nouvelle charge à payer**, sauf si le paiement était déjà
validé/transmis/payé avant l'annulation (travail déjà effectué = somme réellement due). Le
dashboard n'appliquait pas cette même règle et pouvait donc compter, dans "Charges du mois", une
rémunération "acceptée" sur une mission annulée alors qu'elle ne sera jamais versée. Corrigé en
reprenant exactement la même logique de filtrage que `loadComptaRem` (ligne ~21991-21999).
Aucun impact réel constaté aujourd'hui : 0 ligne `prestations_equipe` au statut `acceptée` en
base au moment de l'audit (vérifié en réel), donc bug dormant mais réel structurellement — se
serait déclenché dès la première mission annulée après acceptation d'équipe.

Les deux corrections ont été vérifiées par `node --check` (script extrait des balises
`<script>`) — syntaxe valide, aucune régression introduite.

## Amélioré

Rien à signaler dans cette catégorie au-delà des deux corrections ci-dessus (pas de refonte
visuelle ni d'ajout de fonctionnalité — hors scope de cette mission, déjà fait dans une passe
précédente selon la consigne).

## À surveiller

### Missions remboursées : `v_rentabilite_missions` et le compte de résultat ne soustraient pas les remboursements
`prestations.statut_financier` a une valeur `remboursée` (enum `statut_facture`), mais la vue
`v_rentabilite_missions` (source de `loadComptaResultat`/`loadComptaRentabilite`) calcule
`revenu_ht = montant_ht` sans regarder `statut_financier` du tout — une mission facturée puis
intégralement remboursée au client continuerait donc à compter comme du chiffre d'affaires plein
dans le compte de résultat. **Impact réel actuel : nul** — vérifié en base, 0 ligne
`prestations` avec `statut_financier='remboursée'` aujourd'hui, et aucun code JS ne positionne
jamais ce statut (état prévu dans l'enum mais jamais atteint par aucun flux applicatif actuel).
Je n'ai pas touché à la vue SQL : corriger correctement demanderait de trancher une règle
métier (remboursement total vs partiel, quel mois imputer la perte) que je ne peux pas déduire
du code — à traiter le jour où ce statut est réellement utilisé, pas avant.

### KPI "Marge brute" du dashboard mélange trésorerie (cash encaissé) et charges engagées (accrual)
La tuile "Marge brute" = `CA encaissé (mois)` (missions au statut `payée`, donc trésorerie réelle)
moins "Charges du mois" (rémunérations dues par date de prestation + frais validés + dépenses
engagées, donc base d'engagement). Ce n'est ni une vraie trésorerie ni un vrai résultat
comptable — c'est un indicateur hybride. Le libellé est honnête ("CA - charges", pas
"Bénéfice" ni "Trésorerie"), donc ce n'est pas une confusion de nommage, mais l'indicateur peut
dériver assez fort d'un mois sur l'autre si une grosse mission est payée en M+2 alors que sa
rémunération équipe est comptée en M. Le vrai résultat économique existe déjà et est correct :
page "Résultat" (`loadComptaResultat`, `compte de résultat`) qui utilise le CA facturé
(accrual, `v_rentabilite_missions`) de bout en bout, pas le cash encaissé. Je n'ai pas retouché
le dashboard : le calcul est volontaire et documenté dans le code (commentaire existant), c'est
un choix de simplicité d'affichage plus qu'un bug — mais à garder en tête si le montant affiché
semble "bizarre" un mois donné.

## Action externe nécessaire

Aucune. Pas de credential manquant, pas de décision produit bloquante identifiée dans ce
périmètre.

## Non modifié volontairement

### Le blocage de mission pour formation obligatoire non terminée est volontairement un avertissement, pas un blocage dur
Vérifié dans le code (`ajouterMembreEquipe`, ~ligne 12597-12622) : avant de confirmer
l'affectation d'un collaborateur à une mission, l'OS vérifie ses formations obligatoires
(`eqovFormationsRequises(role)` = les 3 universelles `sv-culture`/`sv-securite`/`sv-comportement`
+ `photo-bases` pour les rôles concernés) via `formation_inscriptions.statut='terminee'`. Si des
formations obligatoires manquent, une **confirmation** apparaît ("⚠️ … n'a pas terminé …
Confirmer quand même cette affectation ?") mais admin/prod peuvent passer outre. Ce n'est donc
**jamais bloquant**, uniquement informatif — exactement la même philosophie et la même décision
fondateur (2026-08-06, documentée dans le commentaire du code juste au-dessus) que la détection
de conflit de planning qui la précède dans la même fonction. Ce n'est pas un oubli : le code
explique explicitement que "le staff garde la main". Je n'ai rien changé ici, conformément à la
consigne de ne jamais changer une règle métier sans certitude absolue — et la certitude ici va
dans l'autre sens (c'est déjà le comportement voulu).

### Barèmes de rémunération et coefficients — conformes point par point à la spec, rien à corriger
Vérifié dans le code (`OPERATOR_BASE_RATES`, `MISSION_MULTIPLIERS`, `computeMissionPay`, ligne
~11073-11079) :
- `OPERATOR_BASE_RATES = {1:45, 2:50, 3:55, 4:65, 5:80}` — ★45€ / ★★50€ / ★★★55€ / ★★★★65€ / ★★★★★80€, conforme.
- `MISSION_MULTIPLIERS = {standard:1, double:1.25, journee:1.6}` — conforme.
- `computeMissionPay(niveau,format) = round(base*multiplier*100)/100` — un seul point d'entrée,
  utilisé partout où un montant est proposé automatiquement (suggestion dans la modale équipe,
  `ajouterMembreEquipe`) ; aucune formule dupliquée/divergente trouvée ailleurs dans le fichier
  (recherche de toute occurrence de `45*`, `50*`, `55*`, `65*`, `80*`, `*1.25`, `*1.6` hors ces
  deux constantes : aucun résultat).
- Le calcul est **figé (snapshot)** dès l'ajout du collaborateur à l'équipe (avant même son
  acceptation) via `niveau_snapshot`/`base_rate_snapshot`/`multiplier_snapshot`, uniquement quand
  le montant final correspond à la suggestion automatique (un montant ajusté à la main par
  admin/sec n'a pas de règle figée à historiser — cohérent). Le passage au statut `acceptée`
  (`repondreInvitation`) ne PATCH que `statut`/`date_reponse`, jamais `remuneration` ni les
  snapshots. Aucun code dans tout le fichier ne recalcule ou ne touche `remuneration` sur une
  ligne `prestations_equipe` existante suite à un changement de `profiles.niveau_operateur` (la
  seule écriture de `niveau_operateur`, ligne ~26663, ne PATCH que la table `profiles`).
  **Testé en réel** : création d'une prestation de test (`SV-QA-TEST-REM-01`) + affectation du
  compte QA de test `QA PHOTO` (niveau 3 → suggestion 55€, format standard) + acceptation
  simulée + **promotion du niveau opérateur de 3 à 5 en base** → relecture de la ligne
  `prestations_equipe` : `remuneration=55`, `niveau_snapshot=3`, `base_rate_snapshot=55`,
  `multiplier_snapshot=1`, strictement inchangés après la promotion. Toutes les données de test
  supprimées et le niveau du compte QA remis à `null` après vérification.
- Frais de déplacement : table `frais` totalement séparée (propre `statut`, `type`, `km`,
  `collaborateur_id`), jamais lue ni écrite par `computeMissionPay`/`ajouterMembreEquipe`/
  `modifierRemunerationMembre`. Aucun mélange trouvé entre frais et rémunération de base.

### Matériel / Kits — le flux complet fonctionne, migration anti-conflits déjà appliquée et vérifiée en réel
La migration `migration-materiel-anti-conflits-jourj-incidents.sql` (ajoutée cette nuit par une
session parallèle, non testée en base à ce moment-là) a été vérifiée **appliquée et active** en
production :
- `pg_trigger` confirme `trg_check_kit_reservation_overlap` et
  `trg_check_kit_reservation_kit_available` présents sur `kit_reservations`, `tgenabled='O'`.
- **Testé en réel — conflit de dates** : réservation A sur un vrai kit (`KIT alpha 1`,
  15→16/09/2026, statut `réservé`) créée avec succès, puis tentative de réservation B sur le
  même kit avec chevauchement (15/09 18h → 17/09) → **rejetée par Postgres** avec l'erreur
  attendue `P0001 : "Ce kit est déjà réservé sur cette période (réservation existante … —
  prestation …)."` (HTTP 400).
- **Testé en réel — kit indisponible** : kit passé en statut `endommagé`, tentative de nouvelle
  réservation sur ce kit → **rejetée** avec `P0001 : "Ce kit n'est pas disponible pour une
  réservation (statut actuel : endommagé)."`.
- Toutes les données de test supprimées, kit remis en statut `disponible`, vérifié propre après
  coup (`kit_reservations` vide pour ce kit).
- Cycle applicatif complet relu dans le code : `attribuerKitPrestation`/`kitsAttribuerSubmit`
  (disponible→réservé, PATCH `kits.statut`), Jour J (sorti/en_prestation), retour
  (`libererKitPrestation`/`kitsRetourSubmit`, statut réservation → `retourné`, kit →
  `disponible`). Le flux "signalement d'incident" (module Kits ET Mode Jour J) passe désormais
  par la même RPC `report_materiel_incident` (SECURITY DEFINER), qui écrit dans la table
  `materiel_incidents` dédiée et fait basculer le statut matériel/kit — confirmé dans le code
  que les deux points d'entrée (`kitsIncidentSubmit`, `submitIncidentJJ`) appellent bien la même
  fonction, pas de duplication de logique.
- Rien à corriger ici : le travail de la session précédente est solide, je n'ai fait que le
  vérifier en conditions réelles comme demandé, sans réinventer.

### Séparation transaction bancaire / facture / paiement / dépense — pas de confusion trouvée
- `bank_transactions` (rapprochement bancaire) est une table à part, avec `matched_facture_id`/
  `matched_expense_id` explicites, jamais confondue avec `prestations`/`expenses` — le
  rapprochement passe par des RPC dédiées (`fin_suggerer_rapprochements`,
  `fin_rapprocher_transaction`, `fin_ignorer_transaction`), pas d'écriture directe croisée.
- `prestations.statut_financier` (cycle facture→paiement d'un client, enum `statut_facture` :
  `non_facturée`/`en_préparation`/`facturée`/`partiellement_payée`/`payée`/`en_retard`/
  `annulée`/`remboursée`) est un champ combiné volontaire, cohérent en interne.
- `prestations_equipe.statut_paiement` (rémunération opérateur : `en_attente`/`validé`/
  `transmis_compta`/`payé`) est un champ totalement distinct, jamais lu/écrit par le code qui
  gère `statut_financier` et vice-versa.
- `expenses.statut` (`prevue`/`engagee`/`payee`/`comptabilisee` — dépenses générales
  fournisseurs) est distinct de `frais.statut` (`en_attente`/`validé`/`remboursé`/`refusé` —
  notes de frais collaborateurs). Les deux tables existent pour des besoins différents
  (dépenses générales vs frais de mission individuels) et ne se chevauchent pas dans le code.
- `commissions.statut` (`calculee`/`validee`/`payee`) n'a pas d'état "annulée" — pas de risque
  de double-comptage d'une commission annulée dans les sommes du compte de résultat.

Aucune confusion structurelle trouvée entre ces quatre notions dans le code actuel, en dehors
des deux bugs de filtrage corrigés plus haut (qui relevaient bien de cette même famille de
problème : "dépense prévue" et "rémunération sur mission annulée non payée" traitées comme des
charges réelles dans un seul écran sur toute la base de code).
