# QA boutons — rôle Secrétaire (sec)

Campagne de test exhaustive, nocturne, autonome. Compte de test réel `test-sec-qa-30-08@sportvision-an.fr` (role=`sec`) créé via l'API Admin Supabase, session Playwright (chromium) sur la prod (`https://bc6m3cgdz.sportvision-an.fr/`) puis en local (`file://`, contre la même base Supabase) après chaque correctif pour confirmer. Chaque bug a été déclenché par un **vrai clic** (pas une lecture de code ni un appel JS direct à la fonction).

Périmètre couvert (nav `NAV.sec` actuelle, 25 écrans/actions visibles + 1 masqué) : Tableau de bord, Demandes entrantes, Agenda, Tâches, Relances, Full Com, Club+, Connect, Devis, Contrats, Paiement collectif, Demandes Club+ (modale), Recrutement, Prestations, Planning admin, Livraisons, Réservations clubs, Documents (pièces RH), Documents (devis/factures), Messagerie, Centre de formation, Centre SportVision, Paramètres.

Note : la liste de ~28 écrans donnée dans la consigne initiale (dont « messages clients », « RDV clients », « catalogue », « avis clients ») correspond à une version antérieure de la nav. La nav actuelle du rôle Secrétaire (refonte du 29/08) ne contient plus ces écrans — `NAV.sec` fait foi et a été suivie telle quelle.

## Bugs trouvés et corrigés

### 1. CRITIQUE — Toutes les modales de l'OS étaient invisibles aux vrais clics de souris (tous rôles)
**Symptôme exact** : ouvrir n'importe quelle modale (`openModal()`, ~200 points d'appel dans tout le fichier) affichait bien le contenu à l'écran, mais un clic réel sur n'importe quel bouton à l'intérieur (« Créer le client », « Créer le devis », etc.) ne déclenchait rien — le clic « traversait » la modale et atterrissait sur le contenu de la page derrière (`#app-ct`). Playwright le signalait explicitement : `<div class="ct" id="app-ct"> intercepts pointer events`.
**Cause** : régression introduite le 29/08 (commit `02240bbc8`, polish premium des modales). Le conteneur `#sv-modal` avait un `style="...pointer-events:none"` **inline**, et la classe `.on` (ajoutée à l'ouverture) tentait de repasser `pointer-events:auto` via une règle CSS — mais un style inline gagne toujours sur une règle de classe sans `!important`. Résultat : la modale n'a jamais reçu aucun clic depuis son déploiement, quel que soit le rôle. Les audits précédents ne l'avaient pas vu car ils invoquaient les fonctions JS directement (`page.evaluate(() => modalXxx())`), jamais un vrai clic souris.
**Correction** : suppression du `pointer-events:none` inline (`livrables/SportVision-TV/SportVision-OS-Full.html`, div `#sv-modal`, ~ligne 614). L'état fermé reste protégé par `visibility:hidden` (déjà présent dans la feuille de style), qui exclut nativement l'élément du hit-testing — aucune régression sur le comportement « modale fermée invisible et non bloquante ».
**Vérifié** : recréation du compte test, clic réel sur chaque CTA/bouton de modale du rôle Secrétaire (client, devis, contrat, tâche, rappel, paiement, email…) — tous fonctionnels après correctif.

### 2. Notifications vers un autre utilisateur perdues silencieusement (systémique, tous rôles)
**Symptôme exact** : cliquer sur « → Envoyer » un devis (vrai clic) déclenchait une erreur console `403 — new row violates row-level security policy for table "notifications"`, alors que l'action visible (devis marqué envoyé) réussissait. La notification de relance destinée à l'autre secrétaire (Sabrina) n'était jamais créée.
**Cause réelle** (pas une faille RLS au sens propre) : `sbFetch()` envoie `Prefer: return=representation` par défaut sur tout POST/PATCH. La policy INSERT de `notifications` autorise bien tout le staff (`is_staff()`) à créer une notification pour un tiers, mais la policy SELECT ne laisse lire que ses **propres** notifications (`destinataire_id = auth.uid()`) ou l'admin. PostgREST exécute l'INSERT puis relit la ligne pour la représentation — cette relecture échoue en RLS, et comme c'est le même statement SQL, **toute la ligne insérée est annulée**. PostgREST remonte ça sous la forme trompeuse « row violates RLS », qui ressemble à un refus d'écriture alors que c'est un refus de lecture-retour.
Impact réel : `creerNotifSiActive()` (utilisée par ~15 flux dans tout l'OS — invitations mission, corrections médias, alertes matériel, relance devis, etc.) et `dispatchSVEvent()` (dispatch d'événements en masse) perdaient silencieusement **toute notification adressée à quelqu'un d'autre que l'expéditeur**, depuis un temps indéterminé (le bug ne dépend d'aucune migration récente, c'est le comportement par défaut de `sbFetch`).
**Correction** : ajout de `headers:{'Prefer':'return=minimal'}` sur les deux points d'insertion (`creerNotifSiActive`, `dispatchSVEvent`) — aucune des fonctions appelantes n'utilisait la représentation retournée (fire-and-forget), le correctif est donc sans risque de régression.
**Vérifié en réel** : notification bien reçue par le compte réel de Sabrina Bouksara (secrétaire en poste) après « → Envoyer » un devis test, confirmée par requête directe en base, puis nettoyée.

### 3. Journal d'audit financier perdu pour toute action Secrétaire (conformité)
**Symptôme exact** : marquer un paiement reçu (« ✓ Payé » depuis Relances) enregistrait bien le paiement sur la prestation, mais la console affichait `logFinancialAudit failed {code: 42501, ... "financial_audit_log"}`. Aucune ligne d'audit n'était créée.
**Cause** : exactement le même mécanisme que le bug n°2 — la policy INSERT de `financial_audit_log` autorise `admin`/`compta`/`sec`, mais la policy SELECT ne liste que `admin`/`compta`/`expert_comptable`/`auditeur` (`sec` en est absent). Le retour de représentation par défaut de `sbFetch` faisait donc échouer — et annuler — chaque écriture d'audit faite par un compte secrétaire. Confirmé par requête directe : **aucune** ligne `financial_audit_log` n'existait pour le compte de test avant correctif.
**Correction** : même fix, `Prefer: return=minimal` sur l'insertion dans `logFinancialAudit()` — fonction déjà documentée « best-effort », ne bloque jamais l'action principale.
**Vérifié en réel** : ligne d'audit `action:"encaissement", montant_apres:90` bien créée après correctif, confirmée par requête directe, puis nettoyée.

### 4. Écran Contrats (Secrétaire) : la liste ne se rafraîchit jamais après créer/modifier/supprimer
**Symptôme exact** : créer un contrat via « + Contrat » (vrai clic, formulaire rempli et soumis) enregistrait bien la ligne en base (vérifié par requête directe), mais restait invisible à l'écran tant qu'on ne quittait pas la vue Contrats et n'y revenait pas. Même symptôme pour modifier et supprimer un contrat.
**Cause** : la vue Contrats a deux rendus séparés selon le rôle — `#contrats-real` (Admin, fonction `loadContrats()`) et `#sec-contrats-real` (Secrétaire, fonction `loadSecContrats()`) — mais les trois handlers partagés `sauvegarderContrat()`, `mettreAJourContrat()` et `supprimerContrat()` n'appelaient que `loadContrats()`. Pour un compte Secrétaire, `#contrats-real` n'existe pas dans le DOM : `loadContrats()` se terminait par un `d.innerHTML=...` sur un élément `null`, une exception silencieusement absorbée par le `try/catch` englobant (aucune trace visible, juste une liste figée).
**Correction** : nouvelle fonction `_refreshContratsApresAction()` qui rafraîchit `loadContrats()` et/ou `loadSecContrats()` selon l'élément DOM réellement présent ; les 3 points d'appel remplacés en conséquence.
**Vérifié en réel** : création, réouverture (édition), et suppression d'un contrat test — la liste se met à jour instantanément sans changer d'écran, dans les trois cas.

## Testé et fonctionnel (vrais clics, aucun bug trouvé)

- **Tableau de bord** : chargement sans erreur console, KPI affichés.
- **Demandes entrantes** : filtres statut/source, ouverture de la fiche détail (modale de suivi de statut complète), aucune fonction morte détectée sur les ~15-68 boutons/écran scannés (0 `onclick` pointant vers une fonction inexistante, sur les 23 écrans passés au crible systématique).
- **Agenda** : création réelle d'un rappel et consultation du formulaire RDV — les deux modales s'ouvrent et enregistrent correctement (`secretariat_agenda_events`), la liste se met à jour immédiatement.
- **Tâches** : création réelle d'une tâche (`notifications` type=tache), liste rafraîchie immédiatement.
- **Relances** : filtres (Acomptes/Soldes/En retard/Toutes), lien `mailto:` de relance présent (pas un bouton — comportement voulu, pas un lien mort), enregistrement de paiement testé de bout en bout (modale, confirmation, mise à jour `statut_financier`/`mode_paiement`/`date_paiement`).
- **Full Com / Club+ / Connect** : chargement des listes réelles, filtres par onglet.
- **Devis** : création complète (client + ligne + calcul TTC en direct), passage « Envoyé », envoi par email (modale pré-remplie avec destinataire/objet/message), édition (modale « Modifier » avec statut/lignes), blocage correct et message clair lors d'une tentative de passage à « Accepté » sans signature Youtrust (règle métier volontaire, pas un bug).
- **Contrats** : création directe (« + Contrat »), PDF (ouverture d'un nouvel onglet), envoi par email, édition, suppression avec confirmation — tout testé par vrais clics après le correctif n°4.
- **Paiement collectif (cotisations)** : filtres testés, écran lecture seule comme annoncé.
- **Demandes Club+** : modale ouverte depuis l'item de nav dédié (pattern différent de `switchView`), contenu correct.
- **Recrutement** : chargement de la liste réelle (19 candidatures) — **aucune action mutative testée** volontairement (candidats réels, pas de données de test disponibles pour ce pipeline sans modifier un vrai dossier de candidature).
- **Prestations / Planning** : filtres, bascule vue Calendrier/Liste, clic sur une mission → modale de détail avec suivi de statut complet.
- **Livraisons** : bouton « Détail » → modale prestation complète.
- **Réservations clubs** : écran vide géré proprement (empty state).
- **Documents (pièces RH)** : écran de suivi lecture seule — aucune action de « validation » n'existe pour ce module (documents manquants = rien à valider, comportement voulu ; la validation de contenu se fait côté Production, hors périmètre Secrétaire).
- **Documents (devis/factures)** : les 8 onglets (Tous/Devis/Contrats/Factures/Avoirs/Signatures/Rétractations/Journal) cliqués individuellement, bouton PDF présent.
- **Messagerie** : ouverture du canal Broadcast (zone de saisie visible), modale « + Nouveau » (choix d'un membre réel de l'équipe) — fonctionnelle.
- **Centre de formation** : 4 onglets (Catalogue/Mes formations/Certifications/Sessions) cliqués sans exception.
- **Centre SportVision** : navigation interne (À propos, Organisation, Règlement, FAQ, Qui contacter) sans exception.
- **Paramètres** : formulaire profil (18 champs), bouton « Enregistrer le profil » cliqué sans exception.

Sur l'ensemble des 23 écrans passés au crible via un scan automatisé des `onclick` (`buttonCount` de 0 à 103 par écran), **aucun bouton mort** (`onclick` vers une fonction JS inexistante) n'a été détecté — la seule classe de bug réelle rencontrée était l'invisibilité des modales aux clics (bug n°1, désormais corrigé) et les échecs d'écriture silencieux dus au couple RLS SELECT restrictive / `return=representation` par défaut (bugs n°2 et 3).

## Non corrigé

- **Recrutement** : aucune action mutative (avancer un candidat dans le pipeline, archiver) n'a été testée en conditions réelles — cela aurait modifié le dossier d'un vrai candidat sans donnée de test disponible pour ce module. Le rendu de la liste et les éléments cliquables (49 détectés) ont été vérifiés présents, mais pas leur effet de bout en bout.
- **Envoi réel d'email** (devis/contrat par email, ✉ Relancer) : les modales et le déclenchement ont été vérifiés (structure correcte, pas d'erreur console/réseau), mais la remise effective en boîte de réception n'a pas été vérifiée (edge function d'envoi non auditée dans cette campagne — hors périmètre "boutons").
- Le bug n°2 (notifications) et n°3 (audit financier) sont **systémiques** : ils affectent potentiellement d'autres rôles que Secrétaire partout où `creerNotifSiActive`/`dispatchSVEvent`/`logFinancialAudit` sont appelées pour un destinataire différent de l'expéditeur. Le correctif étant au niveau des fonctions partagées, il profite à tous les rôles, mais je n'ai pas ré-audité les autres rôles pour vérifier l'absence d'autres tables avec le même schéma "INSERT permissif / SELECT restrictif" — à garder en tête pour les prochaines campagnes QA.

## Compte de test et nettoyage

Compte `test-sec-qa-30-08@sportvision-an.fr` (role=sec) créé via l'API Admin Supabase pour toute la campagne, avec un client fictif (« QA TEST Secretariat FC »), un devis, un contrat et deux prestations de test — tous supprimés en fin de campagne, ainsi que le profil et le compte auth de test lui-même. Vérifié absence de résidu par requêtes directes sur `clients`, `devis`, `contrats`, `prestations`, `notifications`, `secretariat_agenda_events`, `financial_audit_log`.
