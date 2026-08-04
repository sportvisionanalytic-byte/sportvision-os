# Espace Joueur & Famille — Revue de conformité (phase 13)

Dernière relecture de tout le module avant mise en production réelle. Contrairement aux 12 phases précédentes, ce document ne décrit pas une fonctionnalité mais un audit : ce qui a été vérifié, ce qui a été corrigé (`migration-clubplus-v23.sql`), et ce qui reste une limite connue à trancher — par toi, pas par moi (textes juridiques, choix de produit, tests en conditions réelles).

**Cette revue n'est pas un test d'intrusion complet.** C'est une relecture ciblée des policies RLS et fonctions du module, à la recherche d'un défaut structurel précis (voir §1), plus une comparaison ligne à ligne avec les 25 critères de validation du prompt d'origine. Elle ne remplace pas des tests manuels en conditions réelles (§3) que je ne peux pas exécuter moi-même — je n'ai pas d'accès direct à ta base Supabase.

---

## 1. Failles trouvées et corrigées (`migration-clubplus-v23.sql`)

Les cinq migrations précédentes de RPC (v14, v15, v20, v21) suivent presque partout le même principe : la création de lignes sensibles passe par une fonction `SECURITY DEFINER` qui calcule elle-même le statut de départ, jamais par une policy `INSERT` ouverte. Trois tables font exception — elles acceptent un `INSERT` direct du client avec une policy qui vérifie **qui** écrit mais pas **quoi**. C'est exactement le même défaut, retrouvé trois fois en relisant systématiquement chaque policy `INSERT` du module.

| # | Table | Faille | Gravité | Scénario concret |
|---|---|---|---|---|
| 1 | `player_profiles` (via `accept_player_invitation` / `request_team_membership_as_player`) | Aucune vérification d'âge avant de créer un compte personnel | **Élevée** — viole directement la règle produit centrale du module (§3/§31-3 du prompt) | Un enfant de 11 ans invité par erreur par un éducateur (ou s'inscrivant spontanément avec sa vraie date de naissance) obtenait un compte personnel avec mot de passe, alors que la règle dit explicitement qu'il ne doit exister que comme fiche rattachée au parent. |
| 2 | `team_projects` (policy `tpr_educateur_insert`) | Le statut initial n'était pas contraint | Moyenne | Un éducateur (ou n'importe qui avec les identifiants d'un éducateur) pouvait créer un projet directement en statut `ouvert`, sans jamais passer par la validation du club prévue au §19 du prompt — l'app elle-même ne fait jamais ça, mais rien ne l'empêchait via un appel direct à l'API REST. |
| 3 | `club_bookings` (policies `cbk_family_insert` et `cbk_member_insert`, cette dernière antérieure au module, migration v6) | Le statut initial n'était pas contraint | Moyenne | Une réservation pouvait être créée directement en `livree`, court-circuitant tout le pipeline SportVision. |
| 4 | `media_reports` (policy `mrp_insert`) | Le statut initial n'était pas contraint | **Élevée** — combinée à `is_media_visible_to_family` (v18/v19), c'est un vecteur de déni de service | N'importe quel joueur ou parent pouvait insérer un signalement directement en statut `media_masque` ou `retrait_accepte` — ce qui, par construction, masque **immédiatement** le média pour toute la famille de l'équipe, sans qu'aucun dirigeant n'ait rien vérifié. Une personne malveillante aurait pu faire disparaître à volonté n'importe quel contenu publié à son équipe. |

**Correctif appliqué à chaque fois** : soit une garde explicite dans la fonction (âge, cas 1), soit `and statut = '<valeur_de_départ_unique>'` ajouté à la clause `with check` de la policy (cas 2, 3, 4) — le client peut toujours insérer, mais plus choisir un statut avancé.

Aucune autre table du module n'a ce défaut : `membership_requests`, `parental_authorizations`, `team_project_contributions`, `team_invite_codes` n'ont **aucune** policy `INSERT` cliente — la création passe exclusivement par une fonction `SECURITY DEFINER`, ce qui ferme la question par construction plutôt que par un correctif après-coup. C'est le patron à privilégier pour toute nouvelle table de ce module.

---

## 2. Les 25 critères de validation du prompt d'origine (§31)

| # | Critère | Statut | Note |
|---|---|---|---|
| 1 | Une fiche joueur peut exister sans compte Auth | ✅ | `player_profiles.user_id` nullable ; `request_team_membership_for_child` ne le renseigne jamais |
| 2 | Un compte Auth est créé seulement après activation | ⚠️ **Écart assumé, documenté depuis la phase 3** | Le compte `auth.users` d'un 14-17 ans est créé dès l'envoi de l'invitation (nécessaire : Supabase doit pouvoir envoyer l'e-mail et laisser définir un mot de passe). Ce que la règle protège réellement — pas d'accès réel avant validation — est garanti autrement : `account_status` reste `en_attente_activation` et l'écran d'attente (`famenattente`, phase 6) ne montre aucune navigation. |
| 3 | Un joueur de moins de 14 ans ne peut pas avoir de compte personnel | ✅ **Corrigé en v23** — cf. §1 |
| 4 | Un joueur à partir de 14 ans peut créer un compte sous condition | ✅ | |
| 5 | Aucun compte mineur n'est activé sans autorisation parentale valide | ✅ | Un seul chemin fait passer `account_status` à `actif` : `validate_team_membership`, qui vérifie `creation_compte`+`acces_clubplus`+`traitement_donnees` valides pour tout non-majeur |
| 6 | Le club peut vérifier l'autorisation | ✅ | `verify_parental_authorization`, réservé admin |
| 7 | Le coach peut valider uniquement son équipe | ✅ | `is_team_educateur(team_id)` |
| 8 | L'administrateur peut valider toutes les équipes | ✅ | `is_club_admin` |
| 9 | Une inscription spontanée ne donne aucun accès immédiat | ✅ | Statut de départ `a_verifier`/`en_attente_parent`, aucune donnée interne exposée avant validation |
| 10 | Une invitation mineure n'ignore pas l'autorisation parentale | ✅ | `bootstrap_player_authorizations` s'exécute automatiquement dès la 1ère demande d'un non-majeur |
| 11 | Le parent peut gérer plusieurs enfants | ✅ | Phase 7 |
| 12 | Le joueur voit uniquement les contenus de son équipe | ✅ | `is_family_of_team`, scopé équipe et non club |
| 13 | Les galeries ne sont pas dupliquées par utilisateur | ✅ | `media_access_rules` référence les lignes existantes de `club_media`/`club_creations`, aucune copie |
| 14 | Le joueur peut consulter ses livrables sur mobile | ✅ | Phase 8, sous réserve qu'un dirigeant ait publié |
| 15 | Le parent peut payer les services d'un mineur | ✅ | Phase 10, `club_bookings` |
| 16 | Une commande personnelle arrive dans le Portail puis dans OS | ⚠️ **Décision produit assumée, pas un bug** | Route volontairement via `club_bookings` (déjà staff-driven) plutôt que le Portail — décidé avec toi en phase 10 (le Portail n'a aujourd'hui aucun flux self-service, seulement accepter/refuser un devis existant) |
| 17 | Un projet collectif nécessite l'autorisation du club | ✅ **Corrigé en v23** — cf. §1 |
| 18 | Les contributions sont liées à une prestation précise | ✅ | `team_projects.catalogue_offre_id` obligatoire |
| 19 | Les signalements de médias sont traitables | ✅ **Faille de masquage immédiat corrigée en v23** — cf. §1 |
| 20 | Le retrait d'une autorisation déclenche les restrictions prévues | ⚠️ **Partiel, documenté depuis v15** | `withdraw_parental_authorization` trace le retrait (`statut='retiree'`, `authorization_events`) mais ne suspend **pas** automatiquement `team_memberships`/`account_status` — un joueur déjà actif le reste après un retrait. Une fonction `suspend_player_access` équivalente n'a jamais été construite (jamais demandée explicitement non plus). À trancher : est-ce voulu (le club traite manuellement) ou faut-il l'automatiser ? |
| 21 | Le changement de saison est géré | ✅ | Phase 12 |
| 22 | Les politiques RLS empêchent les accès croisés | ⚠️ **Vérifié par lecture, pas par exécution** | Structurellement solide (toutes les fonctions `is_*` remontent jusqu'au `club_id`/`team_id` via une jointure), mais je n'ai pas d'accès à ta base pour exécuter un vrai test croisé — voir §3 |
| 23 | Les documents parentaux sont protégés | ⚠️ **Partiel, documenté depuis v17** | Protégés par RLS (parent concerné / admin / joueur lui-même uniquement) mais le bucket de stockage reste public en lecture — un document n'est pas techniquement privé, seulement non-listable |
| 24 | Les actions sensibles sont auditées | ✅ | `membership_request_events`, `authorization_events`, `team_project_events` couvrent les transitions clés |
| 25 | L'application reste rapide avec plusieurs milliers de fiches joueurs | ⚠️ **Non testé** | Index posés sur chaque table au fil des migrations (`idx_pp_club`, `idx_tm_player`, etc.), mais aucun test de charge réel n'a été fait |

**Résumé** : 19/25 pleinement conformes, 2 corrigés dans cette phase (3, 17, 19 — trois corrections pour deux critères + la faille médias), 2 sont des écarts assumés et documentés depuis leur phase d'origine (pas des oublis), 2 restent non tranchés/non testés et nécessitent une décision ou un test de ta part.

---

## 3. Scénarios de test manuels recommandés avant mise en production

Je ne peux pas exécuter ceci moi-même — je n'ai pas de session Supabase active. À faire avec au moins 2 clubs de test et plusieurs comptes par rôle.

**Isolation inter-club** (le point le plus critique à vérifier en premier) :
- Créer un club A et un club B. Un joueur du club A ne doit voir, dans aucun écran, aucune donnée du club B (équipes, calendrier, médias, projets).

**Isolation inter-équipe** (au sein d'un même club) :
- Un joueur U15 ne doit voir ni le calendrier, ni les médias, ni les projets de l'équipe U18 du même club.

**Règle d'âge, de bout en bout** :
- Scénario 2 du prompt d'origine (joueur 14 ans) : invitation → détection mineur → demande au parent → autorisation → vérification club → validation éducateur → activation. Vérifier qu'aucune étape ne peut être sautée depuis l'interface.
- Scénario 3 (moins de 14 ans) : après le correctif v23, tenter de créer un compte personnel pour un enfant de moins de 14 ans doit échouer avec le message explicite, quel que soit le point d'entrée (invitation ou inscription spontanée).
- Scénario 5 (autorisation manquante) : le bouton Accepter doit rester absent/inactif tant que l'autorisation n'est pas valide, et `validate_team_membership` doit refuser explicitly si on force l'appel.

**Signalement/masquage** (après correctif v23) :
- Un joueur signale un média avec un motif quelconque → le média doit rester visible jusqu'à ce qu'un admin passe explicitement le signalement à `media_masque`.

**Projets collectifs** (après correctif v23) :
- Un éducateur crée un projet → il doit apparaître en `attente_validation_club`, jamais directement `ouvert`, tant qu'un admin ne l'a pas fait passer par là.

**Paiement Stripe** :
- Vérifier qu'un webhook `checkout.session.completed` avec `metadata.contribution_id` met bien à jour `team_project_contributions` (pas `paiements`), et qu'un paiement Portail existant continue de fonctionner normalement après le redéploiement de `stripe-webhook` (v21).

---

## 4. Limites connues, non corrigées ici (rappel consolidé)

Ces points étaient déjà documentés au fil des migrations — ils sont rassemblés ici pour une vue d'ensemble avant mise en production, pas parce qu'ils ont été découverts maintenant :

- **Textes juridiques des 12 types d'autorisation parentale** : provisoires (`v0-provisoire`, v15), à faire valider par un juriste avant toute collecte réelle de consentement.
- **Bucket `clubplus-media`** : public en lecture (v10), y compris pour les documents d'autorisation importés (v17) — pas de confidentialité technique réelle, seulement des chemins non devinables.
- **Notifications** : in-app uniquement (`family_notifications`... en réalité jamais construite — vérifier si ce besoin est encore réel avant de le faire) ; aucun e-mail/push réel n'est envoyé pour les événements du module (nouvelle demande, autorisation à signer, etc.), bien que l'infrastructure e-mail (Resend) existe déjà côté paiements.
- **Retrait d'autorisation** : ne suspend rien automatiquement (cf. critère 20 ci-dessus).
- **`role_permissions`** (matrice de permissions personnalisées, v12) : toujours non appliquée nulle part, y compris dans ce module — persistée mais décorative.

Aucun de ces points ne bloque techniquement une mise en production limitée/pilote, mais chacun mérite une décision explicite de ta part avant une ouverture large.
