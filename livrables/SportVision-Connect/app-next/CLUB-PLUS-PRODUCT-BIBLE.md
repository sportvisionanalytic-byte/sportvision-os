# SPORTVISION CLUB+ — Product Bible & Master Specification

Document de référence produit, transmis par Fouka le 16/08/2026 (PDF `SportVision_ClubPlus_Product_Bible_Claude_Design.pdf`, version 1.0). Copié ici en texte intégral pour rester consultable dans les sessions futures sans re-uploader le PDF.

**But du document** : figer une vision complète et cohérente de SportVision Club+ avant développement : offres, crédits, interfaces, rôles, permissions, parcours, design system, logique Connect/OS, notifications, support et règles de simplification.

**Règle de référence** : si une ancienne maquette ou un ancien prompt contredit ce document, cette Product Bible doit être considérée comme la référence fonctionnelle, sauf nouvelle décision explicite. `SPORTVISION-PORTAIL.md` (ancien document, produit "SportVision Portail") est explicitement obsolète et ne doit plus être utilisé — confirmé par Fouka le 16/08.

**Décision du 16/08 (Fouka)** : Club+ est reconstruit en Next.js + Supabase (même projet que Connect, une seule identité SportVision), en repartant de `app-next` existant (243 fichiers, déjà fonctionnel) plutôt que de zéro — conforme à la consigne "ne pas recréer Club+ de zéro" ci-dessous. Périmètre de démarrage : type de structure **Club**, rôle **Admin/Owner** d'abord.

---

## Sommaire

1. Vision produit et écosystème
2. Modèle commercial, abonnements et crédits
3. Architecture fonctionnelle et objets communs
4. Types de structures et vocabulaire adaptatif
5. Rôles, permissions et scopes
6. Interface Admin / Owner
7. Interface Coach affilié
8. Interface Directeur / Responsable sportif
9. Interface Communication / CM interne et externe
10. Interfaces Secrétaire / Trésorier / Administratif
11. Interface Académie
12. Interface Coach / Préparateur indépendant
13. Interface Structure de coaching
14. Interface Tournoi / Événement
15. Interface Stage / Camp
16. Prestations, demandes et workflow OS
17. Contenus, visuels et visibilité Connect
18. Résultats de matchs et communication
19. Documents, factures et paiements
20. Système multi-espace, invitations et accès
21. Notifications, aide et support
22. Design system, responsive et product polish
23. États, statuts et microcopy
24. Sécurité fonctionnelle et multi-tenant
25. Handoff Claude Design / développeur
26. Checklist de validation finale

**Usage recommandé** : Claude Design doit d'abord reprendre les écrans existants, les auditer, puis harmoniser. Ne pas recréer Club+ de zéro et ne pas ajouter de nouveaux modules sans justification.

---

## 1. Vision produit et écosystème

SportVision Club+ est le portail professionnel de SportVision. Il centralise la relation entre SportVision et une structure : prestations, demandes, contenus, communication, affiliations utiles, documents, facturation, calendrier et échanges.

### Les trois espaces SportVision

| Espace | Cible | Mission |
|---|---|---|
| SportVision Connect | Joueurs, sportifs, parents, proches, agents | Espace personnel : prestations, contenus, cotisations, profils et relations personnelles. |
| SportVision Club+ | Clubs, académies, coachs, structures, tournois, camps | Espace professionnel : relation de la structure avec SportVision. |
| SportVision OS | Équipe interne SportVision | Backoffice de production, administration, demandes, facturation, contenus et suivi opérationnel. |

**Mantra** : CONNECT = MOI / CLUB+ = MA STRUCTURE / OS = SPORTVISION.

### Principes non négociables

- Une seule identité SportVision : un utilisateur ne recrée pas un compte pour chaque structure ou produit.
- Un utilisateur peut appartenir à plusieurs structures Club+ et conserver son espace Connect.
- Le club ne possède jamais le compte Connect d'un joueur ; il ne possède qu'une relation d'affiliation.
- Club+ n'est ni un ERP complet, ni un logiciel de coaching, ni une comptabilité générale, ni un logiciel de tournoi.
- Une demande, une facture, un contenu ou un résultat est un objet unique, vu différemment selon le rôle et l'espace.

---

## 2. Modèle commercial, abonnements et crédits

**Important pour Claude Design** : les montants ci-dessous sont les montants commerciaux de référence actuellement retenus. L'interface ne doit jamais hardcoder la fiscalité, les crédits, avantages ou renouvellements : `active_offer` et le backend restent la source de vérité.

### Club+ Start

| Modalité | Tarif de référence |
|---|---|
| Engagement 12 mois | 49 € / mois |
| Sans engagement | 59 € / mois |

- Page / espace structure Club+.
- 10 visuels par mois selon l'offre commerciale de référence.
- 20 crédits de référence.
- -10 % sur les prestations éligibles SportVision.
- Les modules Visuels et Crédits ne s'affichent que si l'offre active les contient.

### Club+ Performance

| Modalité | Tarif de référence |
|---|---|
| Engagement 12 mois | 129 € / mois |
| Sans engagement | 139 € / mois |

- Priorisation de la structure dans le traitement / accompagnement selon les règles commerciales.
- -10 % sur les prestations éligibles SportVision.
- Les volumes exacts de crédits, visuels ou avantages supplémentaires doivent être lus depuis l'offre active et non inventés dans le design.

### Full Communication

| Formule | Présence SportVision | Tarif de référence |
|---|---|---|
| Full Communication 1 | 1 présence / mois | 650 € / mois |
| Full Communication 2 | 2 présences / mois | 750 € / mois |
| Full Communication 4 | 4 présences / mois | 950 € / mois |

- Une présence correspond en principe à une intervention d'environ un match / environ 2h selon la prestation.
- Photo + vidéo sont prévues systématiquement sur les présences de référence.
- Club+ est inclus avec Full Communication.
- Les services inclus, crédits, visuels, réduction et calendrier commercial doivent être chargés depuis l'offre réelle.

### Règles d'affichage commercial

- Ne pas inventer une offre Basic / Pro / Premium si le backend ne la contient pas.
- Ne pas afficher un nombre de crédits ou de visuels identique à toutes les structures.
- Afficher le suffixe HT/TTC selon le document et la politique commerciale réelle ; ne pas le deviner dans le frontend.
- Si une structure est en prestation ponctuelle sans abonnement, "Mon offre" doit l'expliquer proprement au lieu d'inventer un abonnement.
- Les réductions ne s'appliquent qu'aux prestations éligibles définies par l'offre.

### Moteur de crédits

Les crédits servent principalement à piloter certains services de communication / demandes de visuels. Le moteur doit être paramétrable par l'offre.

| Concept | Règle |
|---|---|
| Solde | Valeur calculée / lue depuis l'offre et les mouvements de crédits. |
| Consommation | Déclenchée uniquement lors d'une action confirmée qui consomme réellement des crédits. |
| Résultat de match | Ne consomme jamais automatiquement un crédit. |
| Ouverture d'un formulaire | Ne consomme jamais automatiquement un crédit. |
| Demande de visuel | Peut réserver / consommer un crédit uniquement au moment défini par le backend. |
| Recharge / report / expiration | Entièrement configurés par l'offre ; jamais hardcodés dans Club+. |

---

## 3. Architecture fonctionnelle et objets communs

**Formule Club+** : `EXPERIENCE = organization_type + membership_role + permissions + scope + active_offer`.

Le rôle seul ne détermine jamais l'interface. Un Coach U18 dans un club et le propriétaire de KD Performance peuvent être la même personne mais utiliser deux interfaces et deux scopes totalement différents.

### Objets à réutiliser

| Objet | Usage |
|---|---|
| User | Identité SportVision unique. |
| Organization | Structure Club+ : club, académie, coach, tournoi, etc. |
| OrganizationMembership | Rôle interne d'un utilisateur dans une structure. |
| ExternalMandate | Accès d'un prestataire externe / CM externe à une structure cliente. |
| AthleteAffiliation | Relation entre un sportif Connect et une structure Club+. |
| Group / Team | Équipe de club ou groupe d'académie / coaching. |
| CoachAssignment | Affectation d'un coach / intervenant à un groupe ou un sportif. |
| Event | Tournoi, stage, camp, événement ou édition. |
| ServiceRequest | Demande SportVision unique, partagée Club+ / OS. |
| Content | Album, photo, vidéo, reel, aftermovie. |
| VisualRequest | Demande de visuel et workflow de validation. |
| Document | Devis, contrat, autre document. |
| Invoice / Payment | Facturation et paiement. |
| Match / MatchResult | Match, score et informations utiles à la communication. |
| MessageThread | Conversation contextualisée Club+ <-> SportVision. |
| Notification | Information/action à destination d'un utilisateur. |
| SupportTicket | Demande d'aide liée à l'utilisation de Club+. |

### Règle de non duplication

- Une demande Club+ n'est pas recopiée dans OS : c'est le même ServiceRequest.
- Une facture ne doit pas avoir une copie par rôle.
- Le résultat saisi par le coach est le même objet que celui vérifié par le directeur sportif puis exploité par le CM.
- Un contenu livré par SportVision est le même objet, avec des règles de visibilité adaptées.

---

## 4. Types de structures et vocabulaire adaptatif

| Type | Objet central | Vocabulaire principal | Modules structure |
|---|---|---|---|
| Club | Équipe / saison | Joueurs, Équipes & catégories | Affiliations, équipes, membres. |
| Académie | Sportifs / groupes | Sportifs, Groupes | Affiliations, groupes, membres. |
| Coach / préparateur indépendant | Sportifs suivis | Mes sportifs, Mes groupes | Relations sportifs, groupes facultatifs. |
| Structure de coaching | Sportifs / groupes / intervenants | Sportifs, Groupes, Coachs & intervenants | Affiliations, groupes, affectations, membres. |
| Organisateur tournoi / événement | Événement / édition | Mes événements | Événements, membres. |
| Stage / Camp | Session | Sessions, Groupes, Participants | Sessions et données utiles à SportVision. |
| Association / Autre | Selon activité | Dynamique | Feature flags selon besoins réels. |

### Labels dynamiques

| Concept interne | Club | Académie | Coach indép. | Coaching structure | Tournoi |
|---|---|---|---|---|---|
| Athlete | Joueur | Sportif | Sportif | Sportif | Participant si besoin |
| Group | Équipe | Groupe | Groupe | Groupe | N/A par défaut |
| Staff | Coach | Coach | N/A seul | Coach / intervenant | Responsable événement |
| Event | Match / événement | Stage / événement | Prestation / événement | Événement | Événement / édition |

**Règle UX** : ne jamais donner l'impression que l'interface Tournoi est une interface Club avec les joueurs retirés. La navigation, les données et les priorités doivent réellement être event-centric.

---

## 5. Rôles, permissions et scopes

La fonction déclarée, le rôle Club+ et les permissions sont trois notions distinctes. Exemple : Fonction = Président ; Rôle Club+ = Administrateur.

### Grandes familles de rôles

| Rôle / preset | Mission | Accès par défaut |
|---|---|---|
| Admin / Owner | Piloter la structure et sa relation SportVision. | Vision large, membres, demandes, contenu, admin, finance selon offre. |
| Communication | Exploiter résultats, contenus, visuels et informations. | Centre communication, résultats, visuels, contenus, calendrier. |
| Directeur sportif | Superviser plusieurs équipes / groupes. | Équipes, affiliations, matchs/résultats, demandes, contenus. |
| Coach | Gérer son équipe / groupe. | Joueurs, matchs/résultats, demandes, contenus, calendrier. |
| Secrétaire | Suivre les démarches opérationnelles. | Demandes, documents, calendrier, informations à compléter. |
| Trésorier / Finance | Suivre engagements, factures, paiements. | Factures, paiements, devis, documents financiers. |
| Administratif | Coordonner les démarches de la structure. | Demandes, documents, structure, affiliations selon droits. |
| Responsable événement | Piloter un ou plusieurs events. | Events, demandes, contenus, calendrier, messages. |
| Prestataire externe | Travailler pour une structure cliente. | Seulement permissions et scope d'un mandat explicite. |

### Permissions conceptuelles

| Domaine | Permissions principales |
|---|---|
| Services | view_services, create_request, edit_request, cancel_request |
| Contenus | view_content, download_content, share_content_to_connect |
| Affiliations | view_affiliations, approve_affiliations, invite_athletes, remove_affiliations |
| Groupes | view_groups, manage_groups |
| Membres | view_members, invite_members, manage_permissions |
| Communication | view_results, create_visual_request, validate_visual, request_visual_revision, view_visual_credits |
| Documents | view_quotes, approve_quotes, view_contracts, sign_contracts |
| Finance | view_invoices, pay_invoice, view_payments, view_offer |
| Structure | view_organization_profile, edit_organization_profile, request_legal_change |
| Matchs | view_matches, enter_match_result, verify_match_result, edit_match_result |
| Support | create_support_ticket, view_own_support_tickets |

### Scopes

- `organization` : toute la structure autorisée.
- `team` / `group` : une ou plusieurs équipes / groupes.
- `athlete` : un ou plusieurs sportifs assignés.
- `event` : un ou plusieurs événements / éditions.
- `financial` : accès finance transversal si nécessaire.
- Le backend doit vérifier le scope sur chaque requête ; le masquage frontend ne suffit jamais.

---

## 6. Interface Admin / Owner

### Navigation club - Admin

| Groupe | Pages |
|---|---|
| Accueil | Accueil |
| SportVision | Prestations / Mes demandes / Mes contenus / Calendrier / Messages |
| Communication | Demandes de visuels / Crédits — uniquement si offre compatible |
| Structure | Joueurs & affiliations / Équipes & catégories / Membres & accès |
| Administration | Documents / Factures & paiements / Mon offre |
| Compte | Paramètres |

### Dashboard

- Bloc "À traiter" : affiliations, visuels, devis, contrats, factures, informations manquantes.
- Prochaine prestation ou prochain événement SportVision.
- Demandes actives.
- Nouveaux contenus.
- Calendrier / messages pertinents.
- Ne pas afficher de KPI décoratifs sans action ou valeur concrète.

### Joueurs & affiliations

- Tabs : Affiliés / Demandes / Invitations / Archives.
- Recherche + filtre équipe/catégorie.
- Ligne ou card cliquable ; menu "..." pour Changer d'équipe / Mettre fin.
- La fin d'affiliation ne supprime jamais le compte Connect.

### Membres & accès

- Distinguer Fonction déclarée / Rôle Club+ / Périmètre / Permissions.
- Actions : Modifier les accès ; retirer si autorisé.
- Invitation en attente : Renvoyer / Annuler invitation.
- Administrateur principal protégé : transfert ou confirmation forte nécessaire.

---

## 7. Interface Coach affilié

**Exemple** : Karim Diallo — FC Montereau — Coach U18 R2 — scope strict U18 R2.

### Navigation

| Groupe | Pages |
|---|---|
| Accueil | Accueil |
| SportVision | Prestations / Mes demandes / Mes contenus / Calendrier / Messages |
| Mon équipe | U18 R2 / Joueurs & affiliations / Matchs & résultats |
| Compte | Paramètres |

### Dashboard coach

- Résultat à renseigner — prioritaire lorsqu'un match est terminé.
- Prochain match.
- Prochaine prestation SportVision.
- Demandes en cours.
- Nouveaux contenus.
- Matchs récents.
- Messages utiles.

### Saisie résultat

| Champ | Règle |
|---|---|
| Score | Obligatoire si match terminé. |
| Statut | Terminé / Reporté / Annulé. |
| Buteurs | Facultatif, sélection joueurs affiliés. |
| Passeurs | Facultatif. |
| Joueur du match | Facultatif. |
| Commentaire communication | Court texte facultatif pour CM / SportVision. |
| Média | Photo / média facultatif. |
| Historique | Auteur, date et modifications légères. |

**UX mobile** : le coach doit pouvoir ouvrir le match, saisir le score et confirmer en moins d'une minute. Le mobile est prioritaire pour ce workflow.

---

## 8. Interface Directeur / Responsable sportif

Le Directeur sportif est la couche intermédiaire entre l'Admin et les coachs. Il supervise plusieurs équipes / groupes sans obtenir automatiquement les droits finance ou membres.

### Navigation

| Groupe | Pages |
|---|---|
| Accueil | Accueil |
| Sportif | Mes équipes / Joueurs & affiliations / Matchs & résultats |
| SportVision | Prestations / Mes demandes / Mes contenus / Calendrier / Messages |
| Compte | Paramètres |

### Dashboard

- Résultats à vérifier.
- Demandes d'affiliation.
- Informations de match manquantes.
- Mes équipes avec prochain match / dernier résultat.
- Prochains matchs et présence SportVision.
- Demandes / contenus du scope.

### Vérification des résultats

- Optionnelle selon `requires_result_verification`.
- Coach saisit une seule fois ; Directeur confirme / corrige si nécessaire.
- Après confirmation, le CM autorisé reçoit l'information.
- Le Directeur ne ressaisit jamais le score de zéro.

---

## 9. Interface Communication / CM interne et externe

**CM interne** : agit dans une structure dont il est membre Club+. Il reçoit les informations sportives et les transforme en actions de communication.

**CM externe** : agit via un mandat explicite. Il ne devient jamais administrateur et ne possède pas la structure cliente. Il peut gérer plusieurs clients avec isolation stricte des données.

### Navigation communication

| Groupe | Pages |
|---|---|
| Accueil | Accueil |
| Communication | Centre communication / Résultats & informations / Demandes de visuels / Crédits / Mes contenus |
| SportVision | Prestations / Mes demandes / Calendrier / Messages |
| Structure | Équipes / groupes en lecture selon scope |
| Compte | Paramètres |

### Centre communication

- Résultat disponible.
- Visuel à valider.
- Informations match manquantes.
- Nouveaux contenus.
- Modification reçue.
- Possibilité "Prendre en charge" / "Pris en compte" pour éviter les doublons.

### Résultat -> Visuel

Depuis un résultat, le CM peut demander un visuel. Le brief est pré-rempli avec équipe/groupe, adversaire, score, buteurs, MVP et commentaire. Le CM vérifie avant envoi.

**Crédits** : enregistrer un résultat ne consomme aucun crédit. Ouvrir le formulaire de visuel ne consomme aucun crédit. Seule une action de demande confirmée suit la logique de consommation définie par l'offre.

### CM externe — switcher

- "Mon organisation" / mes espaces propres clairement séparés des "Structures clientes".
- Accès externe affiché discrètement dans le contexte client.
- Scope par équipe, groupe ou événement.
- Finance client masquée par défaut.
- Fin de mandat = accès client retiré sans toucher aux autres espaces.

---

## 10. Interfaces Secrétaire / Trésorier / Administratif

### Secrétaire

Mission : suivre les démarches SportVision, informations manquantes, calendrier, documents et actions opérationnelles.

| Zone | Contenu prioritaire |
|---|---|
| Dashboard | À traiter / prochaines échéances / demandes / documents / calendrier. |
| Demandes | Compléter les informations demandées sans rouvrir tout le workflow. |
| Documents | Voir / télécharger selon permission ; signer uniquement si autorisé. |
| Affiliations | Lecture ou gestion selon permission. |

### Trésorier / Finance

Mission : comprendre ce qui est engagé, dû, payé ou en attente de validation. Aucun contenu sportif parasite.

| Zone | Contenu prioritaire |
|---|---|
| Dashboard | Factures à régler / retard / devis / paiements récents. |
| Factures | HT / TVA / TTC / échéance / reste à régler / PDF. |
| Paiements | Date / montant / facture / méthode / statut / référence. |
| Devis | Voir avant Accepter ; approve_quote distinct de view_quote. |
| Contrats | Voir distinct de Signer. |

### Administratif

Mission : coordonner les démarches de la structure. Ce rôle n'est jamais un mini-Admin par défaut.

- Demandes, calendrier, documents, informations structure.
- Affiliations / équipes uniquement si permissions.
- Factures selon délégation ; données légales sensibles via "Demander une modification" si nécessaire.
- Membres & accès uniquement si `manage_members` explicite.

---

## 11. Interface Académie

### Navigation Admin Académie

| Groupe | Pages |
|---|---|
| Accueil | Accueil |
| SportVision | Prestations / Mes demandes / Mes contenus / Calendrier / Messages |
| Communication | Demandes de visuels / Crédits si offre compatible |
| Académie | Sportifs & affiliations / Groupes / Membres & accès |
| Administration | Documents / Factures & paiements / Mon offre |
| Compte | Paramètres |

### Règles Académie

- Employer "Sportifs" et "Groupes", pas "Joueurs" / "Équipes" par défaut.
- Affiliation Connect identique au club : invitation ou demande, acceptation, fin sans suppression du compte.
- Un groupe sert à cibler les prestations, contenus et calendrier ; pas à gérer l'entraînement.
- Les stages peuvent être des Event sans créer un module lourd.
- Les contenus peuvent être privés Académie ou partagés à des sportifs autorisés.

### Coach Académie

Réutiliser la famille Coach avec scope par groupe. Le wording devient "sportifs" / "groupe" et le module Résultats n'est affiché que si l'Académie a une logique compétition pertinente.

---

## 12. Interface Coach / Préparateur indépendant

**Exemple** : KD Performance — Owner Karim Diallo. Interface volontairement plus légère qu'un club.

### Navigation

| Groupe | Pages |
|---|---|
| Accueil | Accueil |
| Mes sportifs | Mes sportifs / Mes groupes |
| SportVision | Prestations / Mes demandes / Mes contenus / Calendrier / Messages |
| Administration | Documents / Factures & paiements / Mon offre |
| Compte | Paramètres |

### Dashboard

- Mes sportifs.
- Prochaine prestation SportVision.
- Demandes en cours.
- Nouveaux contenus.
- Calendrier.
- Messages / facturation si action nécessaire.

### Mes sportifs

- Relation autorisée ; le coach ne possède pas le compte Connect.
- Invitation sécurisée ou demande d'affiliation acceptée.
- Fiche sportif limitée aux informations utiles : sport, groupe, contenus/prestations SportVision autorisés.
- Aucune donnée médicale, nutritionnelle, mensurations, blessures, programme ou CRM de coaching.

---

## 13. Interface Structure de coaching

### Navigation Admin

| Groupe | Pages |
|---|---|
| Accueil | Accueil |
| SportVision | Prestations / Mes demandes / Mes contenus / Calendrier / Messages |
| Communication | Visuels / Crédits si offre compatible |
| Structure | Sportifs & affiliations / Groupes / Coachs & intervenants / Membres & accès |
| Administration | Documents / Factures & paiements / Mon offre |
| Compte | Paramètres |

### Coachs & intervenants

- Ce module décrit qui accompagne les sportifs ; il est distinct de Membres & accès qui décrit qui peut utiliser Club+.
- Une personne peut être intervenant sans compte Club+ complet.
- Afficher spécialité, groupes assignés, sportifs assignés et statut accès Club+.
- Ne pas afficher salaires, contrats RH, planning RH ou évaluation du personnel.

### Coach dans la structure

Un coach de Performance Lab voit seulement ses sportifs / groupes assignés, les demandes, contenus et calendrier correspondants. Pas de finance ou membres sans permission.

---

## 14. Interface Tournoi / Événement

**Principe** : pour un organisateur, l'objet central est l'événement / édition. Club+ ne doit pas devenir un logiciel d'inscription, de poules ou de classement.

### Navigation

| Groupe | Pages |
|---|---|
| Accueil | Accueil |
| Mes événements | Événements |
| SportVision | Prestations / Mes demandes / Mes contenus / Calendrier / Messages |
| Communication | Demandes de visuels / Crédits si offre compatible |
| Administration | Documents / Factures & paiements / Mon offre |
| Structure | Membres & accès |
| Compte | Paramètres |

### Fiche événement

- Aperçu : date, lieu, sport, format, contact, statut.
- Informations utiles SportVision : volume participants/équipes, terrains, horaires clés, finale/remise récompenses.
- Prestations SportVision liées.
- Communication / visuels selon offre.
- Contenus et documents rattachés à l'événement.
- Équipes participantes facultatives et légères uniquement pour identifier contenus / briefs.

### Bilan léger événement

- Vainqueur, finaliste, score finale, MVP / distinctions facultatives.
- Sert au CM / visuels ; ne pas créer poules, bracket, classement complet.
- Le bilan ne consomme aucun crédit ; demander un visuel est une action séparée.

---

## 15. Interface Stage / Camp

### Navigation

| Groupe | Pages |
|---|---|
| Accueil | Accueil |
| Mes sessions | Sessions |
| SportVision | Prestations / Mes demandes / Mes contenus / Calendrier / Messages |
| Organisation | Groupes / Participants si utiles à SportVision |
| Communication | Visuels / Crédits si offre compatible |
| Administration | Documents / Factures & paiements / Mon offre |
| Compte | Paramètres |

- Objet central : Session.
- Participants et groupes uniquement pour organiser contenus, albums et intervention SportVision.
- Ne pas construire la gestion complète des inscriptions et paiements du camp.
- Le futur espace Famille / albums individuels reste hors V1 sauf décision explicite.

---

## 16. Prestations, demandes et workflow OS

### Catalogue

Le catalogue Club+ est B2B et peut différer de Connect. Les produits, options, tarifs et types de structures éligibles doivent venir du backend / SportVision OS.

- Ne pas reprendre automatiquement les 6 prestations Connect dans Club+.
- Catégories possibles : Match, Tournoi, Stage, Communication, Contenu, Captation, etc.
- Prix B2B affichés selon politique commerciale réelle, sans inventer.

### Création d'une demande

1. Choisir le type de besoin / prestation.
2. Choisir le contexte : équipe, groupe, sportif ou événement.
3. Renseigner date et lieu.
4. Choisir les options autorisées.
5. Ajouter informations complémentaires.
6. Récapitulatif.
7. Envoyer.

### Statuts demande

| Statut | Sens client |
|---|---|
| Brouillon | Non envoyé. |
| Envoyée | Transmise à SportVision. |
| A compléter | SportVision attend une information. |
| En validation | Analyse / disponibilité / vérification. |
| Devis envoyé | Devis disponible. |
| En attente de signature | Contrat / document à signer. |
| Confirmée | Accord validé. |
| Planifiée | Intervention programmée. |
| En production | Production en cours. |
| Livrée | Contenu / livrable disponible. |
| Terminée | Workflow clos. |
| Annulée | Demande annulée. |

**Objet unique** : Club+ et SportVision OS doivent afficher le même ServiceRequest. Aucun doublon client/interne.

---

## 17. Contenus, visuels et visibilité Connect

### Mes contenus

- Tabs : Tous / Photos / Vidéos / Reels ; Aftermovies si pertinent pour events.
- Filtres adaptatifs : équipe, groupe, sportif, événement.
- Galerie / lightbox / téléchargement / favoris selon permission.
- Utiliser vraies miniatures quand disponibles ; sinon placeholders graphiques SportVision. Aucune image IA.

### Visibilité vers Connect

| Option | Règle |
|---|---|
| Privé Club+ | Visible seulement aux utilisateurs Club+ autorisés. |
| Affiliés du groupe | Visible aux sportifs Connect affiliés au groupe si permission et logique backend. |
| Sportifs sélectionnés | Visibilité explicite à une liste de sportifs. |
| Automatique pour tous | Interdit par défaut. |

### Demandes de visuels

- Liste : type, équipe/groupe/event, deadline, statut, CTA "Ouvrir".
- Ne jamais valider directement depuis la liste sans voir le visuel.
- Fiche : aperçu, brief, version, fichiers, commentaires, historique.
- Actions à validation : Valider / Demander une modification.
- Même workflow depuis tous les CTA "Demander un visuel" / "Nouveau visuel".

### Statuts visuels

| Statut | Usage |
|---|---|
| Brouillon | Non envoyé. |
| Envoyé | Brief transmis. |
| En création | SportVision travaille. |
| A valider | Version disponible. |
| Modification demandée | Retour client envoyé. |
| Validé | Création approuvée. |
| Livré | Fichier final disponible. |

---

## 18. Résultats de matchs et communication

### Flux principal

| Étape | Acteur | Action |
|---|---|---|
| 1 | Coach | Renseigne score + infos facultatives une seule fois. |
| 2 | Directeur sportif | Vérifie / corrige seulement si le club utilise cette validation. |
| 3 | Community Manager | Reçoit l'information et l'exploite. |
| 4 | CM | Demande un visuel éventuellement pré-rempli. |
| 5 | SportVision | Produit / livre selon workflow normal. |

### Données résultat

- Score domicile / extérieur.
- Statut : terminé, reporté, annulé.
- Buteurs et passeurs facultatifs.
- Joueur du match facultatif.
- Commentaire court pour communication.
- Média facultatif.
- Historique auteur / date / corrections.

### Communication

- Notification "Nouveau résultat disponible".
- "Prendre en charge" / "Pris en compte" pour éviter les doublons entre CM.
- "Demander un visuel résultat" / "joueur du match" avec brief pré-rempli.
- Aucun crédit ni prestation payante créée automatiquement.

---

## 19. Documents, factures et paiements

### Documents

| Type | Actions |
|---|---|
| Devis | Voir / télécharger / accepter si `approve_quote`. Toujours ouvrir avant acceptation. |
| Contrats | Voir / télécharger / signer si `sign_contract`. Yousign si workflow réel. |
| Autres | Voir / télécharger selon permission. |

### Factures

- Liste : numéro, objet, émission, échéance, montant explicite, statut.
- Détail : HT, TVA, TTC, déjà payé, reste à régler, PDF.
- Régler uniquement si `pay_invoice=true` + facture payable + paiement en ligne disponible.
- Ne jamais exposer données bancaires sensibles ou identifiants Stripe internes.

### Statuts facture

| Statut | Sens |
|---|---|
| A régler | Paiement attendu. |
| Partiellement payée | Solde restant si ce cas existe. |
| En retard | Échéance dépassée. |
| Payée | Paiement confirmé côté backend. |
| Annulée | Facture annulée. |

### Mon offre

- Nom de l'offre.
- Statut, date début, engagement, renouvellement si réel.
- Services inclus, présences, crédits, réductions, avantages.
- CTA "Voir les documents de mon offre" / "Échange avec SportVision".
- Aucune valeur hardcodée.

---

## 20. Système multi-espace, invitations et accès

### Choisir mon espace

Affiché seulement lorsqu'un utilisateur possède plusieurs destinations : Connect et/ou plusieurs Club+. Aucun choix de rôle : le rôle vient du backend.

### Switcher Club+

- Séparer "Mes organisations" et "Accès clients".
- Afficher contexte : structure + rôle + scope court.
- Permettre "Accéder à Connect" et "Gérer mon compte".
- Au changement de contexte, recharger données, sidebar, permissions et notifications sans fuite de l'ancien espace.

### États invitations et accès

| État | Écran / action |
|---|---|
| Invitation membre | Rôle, périmètre, invité par, Accepter / Refuser. |
| Invitation externe | Accès externe + scope + permissions lisibles. |
| Invitation expirée | Lien invalide, contacter structure / SportVision. |
| Invitation déjà utilisée | Accéder à Club+. |
| Aucun espace Club+ | Inscrire ma structure / Accéder à Connect / invitation. |
| Demande en vérification | Pending review, suivi. |
| Informations requises | Répondre au message SportVision. |
| Demande refusée | Contacter SportVision. |
| Accès suspendu | Message clair, pas de détails techniques. |
| Accès retiré / mandat terminé | Retour aux espaces restants. |
| Permission refusée | "Vous n'avez pas accès à cette section." |
| Session expirée | Se reconnecter puis revenir si possible. |
| 404 / erreur | Message humain + retour / réessayer / support. |

---

## 21. Notifications, aide et support

### Notifications

- Popover cloche avec environ 5 notifications récentes + "Tout voir".
- Chaque notification indique quoi, pour quelle structure, s'il faut agir et où cliquer.
- "Lu" ne signifie pas "Traité" : ouvrir une facture ne signifie pas la payer.
- Catégories adaptées au rôle ; ne pas montrer un filtre Finance au Coach.
- En multi-structure, la notification doit afficher le contexte et basculer proprement vers la bonne structure.

### Exemples par rôle

| Rôle | Notifications typiques |
|---|---|
| Coach | Résultat à renseigner / affiliation / nouveaux contenus / demande / message. |
| Directeur sportif | Résultat à vérifier / affiliation / match modifié / contenu. |
| Communication | Résultat disponible / visuel à valider / contenu livré / deadline. |
| Secrétaire | Information demandée / document / calendrier / affiliation. |
| Finance | Facture / paiement / devis / échéance / contrat. |
| Tournoi | Event reporté / visuel / contenu livré / devis / info requise. |

### Centre d'aide

- Recherche simple + catégories selon rôle.
- Articles contextualisés : résultat pour Coach, factures pour Finance, visuels pour Communication.
- Aide contextuelle depuis une page sans assistant intrusif.
- FAQ légère : changer d'espace, invitation, demande, contenus, facture, support.

### Support

- Catégories : problème Club+, demande, contenu, document/facture, accès, autre.
- Contexte automatiquement repris : référence demande, facture, album ou visuel.
- Ticket support : Envoyée / En cours / Réponse disponible / Résolue / Fermée.
- Support distinct de Messages métier.
- Ne jamais promettre un SLA non validé.

---

## 22. Design system, responsive et product polish

### Direction artistique

- Dark sport-tech premium pour l'application.
- Fonds navy / noir, accents violet, bleu, cyan.
- Surfaces sombres neutres majoritaires ; gradients réservés aux accents, CTA principaux et médias.
- Aucune image générée par IA. Utiliser contenus SportVision réels, placeholders graphiques, gradients, icônes et typographie.

### Tokens de référence

| Token | Valeur indicative |
|---|---|
| Background | #080A18 |
| Sidebar | #080918 |
| Surface | #111426 |
| Elevated | #171A2E |
| Hover | #1D2138 |
| Border | #2A2E45 |
| Text primary | #F8FAFC |
| Text secondary | #A7ACC4 |
| Muted | #70768F |
| Violet | #8B5CF6 |
| Blue | #4F7CFF |
| Cyan | #22C7E8 |
| Success | #22C55E |
| Warning | #F59E0B |
| Error | #EF4444 |

*(Note ajoutée lors de l'import : ces tokens sont très proches de la charte Connect actuelle (`bg:#09081A`, `sv-gradient: linear-gradient(120deg,#A855F7,#4F7DFF 55%,#22D3EE)`, voir `livrables/SportVision-Connect/app-connect/tailwind.config.ts`) — cohérence à vérifier/aligner explicitement lors de l'implémentation plutôt que de supposer une différence intentionnelle.)*

### Composants à normaliser

AppShell, Sidebar, Topbar, OrganizationSwitcher ; boutons Primary/Secondary/Ghost/Danger ; Input, Select, Search, Tabs, Badge ; Card, Dropdown, Modal, Drawer ; Toast, Skeleton, EmptyState, ErrorState, PermissionState ; RequestCard, ContentCard, MatchCard, InvoiceCard, EventCard, MemberCard, NotificationItem.

### Responsive

- Tester 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 px.
- Mobile n'est jamais un desktop compressé.
- Tables deviennent cards lorsque nécessaire.
- Bottom navigation : maximum environ 5 entrées principales, puis "Plus".
- CTA sticky mobile sur workflows courts : résultat, validation visuel, envoi demande.
- Calendrier mobile : "À venir" par défaut.

### Product polish

- Une page = une priorité.
- Une zone = un CTA principal maximum.
- Supprimer badges, cards, textes et raccourcis qui ne servent pas à comprendre ou agir.
- Utiliser hover, transitions 150-250 ms, skeletons, toasts et feedbacks naturels.
- Pas de boutons morts dans le prototype final.

---

## 23. États, statuts et microcopy

### États systématiques

| État | Attendu |
|---|---|
| Default | Contenu normal. |
| Loading | Skeleton correspondant à la forme de la page. |
| Empty | Titre court + explication + CTA uniquement si utile. |
| Error | Message humain + "Réessayer". |
| Success | Toast / feedback + données mises à jour. |
| Disabled | Seulement si action visible mais temporairement impossible ; expliquer si utile. |
| Permission denied | Page propre si URL directe ; module masqué dans navigation. |

### Microcopy

- Langage client : simple, professionnel, humain, direct.
- Bannir les textes interface du type "backend", "permission=false", "source de vérité", "vue client".
- Retirer les descriptions sous H1 si elles n'apportent rien.
- Uniformiser dates : "23 août 2026" ou "23 août - 15h00" selon contexte.
- Uniformiser références : REQ-2026-0142 / FAC-2026-0118 / DEV-2026-0042 / SUP-2026-0048.

### Données démo cohérentes

La démo doit raconter une histoire continue : match -> résultat -> vérification -> communication -> visuel -> livraison. Éviter les dates futures sur des objets terminés, factures payées avec bouton "Régler" ou contenus livrés sur une demande encore en validation.

---

## 24. Sécurité fonctionnelle et multi-tenant

**Règle absolue** : masquer un menu ne sécurise rien. Le backend doit vérifier user + organization + membership/mandate + permission + scope + resource sur chaque action sensible.

- Isolation stricte `organization_id` sur toutes les données B2B sensibles.
- Un Coach U18 ne doit jamais lire Seniors R1 via URL directe.
- Un CM externe ne voit pas les factures client sans permission explicite.
- Un utilisateur multi-structures ne doit jamais voir les données d'un autre contexte pendant le switch.
- Retrait d'accès appliqué au prochain appel backend, pas seulement après reconnexion.
- Paiement / signature / invitation / changement de permission attendent confirmation backend.
- Les notifications ne doivent contenir que des informations que l'utilisateur peut réellement ouvrir.
- Les comptes Connect restent indépendants : une structure ne peut ni changer le mot de passe, ni lire messages personnels, ni voir factures personnelles.

### Actions sensibles avec confirmation

Retirer un accès ; mettre fin à une affiliation ; refuser une affiliation ; annuler une demande ou un événement ; changer un rôle admin critique ; transférer l'administrateur principal.

---

## 25. Handoff Claude Design / développeur

### Ce que Claude Design doit produire

1. Audit initial : ce qui fonctionne, ce qui doit être simplifié, supprimé ou harmonisé.
2. Navigation finale par rôle et type de structure.
3. Écrans desktop et mobile des grands scénarios.
4. États loading / empty / error / success / permission denied.
5. Design System final et composants réutilisables.
6. Matrices rôle -> modules -> actions -> scope -> permissions.
7. Matrice type de structure -> modules / labels.
8. Matrice page -> CTA -> destination -> permission -> état.
9. Liste des données démo et des données qui doivent venir du backend.
10. Rapport final READY / NEEDS REVIEW / BACKEND REQUIRED.

### Routes conceptuelles

| Famille | Exemples |
|---|---|
| Core | /clubplus / requests / content / calendar / messages |
| Structure | /athletes / groups / members |
| Matchs | /matches / matches/:id / results |
| Events | /events / events/:eventId |
| Admin | /documents / invoices / offer / settings |
| System | /notifications / help / support / spaces |

### Source de vérité

| Donnée | Source |
|---|---|
| Rôle / permissions / scope | Backend Club+ / auth. |
| Offre / crédits / avantages | active_offer / backend commercial. |
| Prestations / prix | Catalogue SportVision / OS. |
| Demandes | ServiceRequest partagé Club+ / OS. |
| Factures / paiements | Backend finance / Stripe selon intégration. |
| Contrats / signature | Backend documents / Yousign si utilisé. |
| Contenus | Backend média / production SportVision. |
| Notifications | Événements métier autorisés. |
| Support | SupportTicket backend. |

---

## 26. Checklist de validation finale

| Zone | Critère de validation |
|---|---|
| Architecture | Connect / Club+ / OS clairement séparés. |
| Offres | Aucun prix, crédit ou avantage hardcodé hors données démo. |
| Admin | Interface complète sans surcharge. |
| Coach | Scope strict et saisie résultat rapide mobile. |
| Directeur sportif | Supervision multi-équipes sans finance par défaut. |
| Communication | Centre communication + résultat -> visuel fluide. |
| CM externe | Mandat explicite, multi-client isolé. |
| Secrétaire | Suivi démarches et échéances. |
| Finance | Factures/devis/paiements sans données sportives inutiles. |
| Administratif | Transversal sans devenir mini-admin. |
| Académie | Sportifs / groupes, pas wording club. |
| Coach indépendant | Interface volontairement légère. |
| Coaching structure | Sportifs / groupes / intervenants. |
| Tournoi | Expérience event-centric. |
| Camp | Expérience session-centric. |
| Demandes | Objet unique avec statuts normalisés. |
| Contenus | Visibilité Connect explicite, aucune auto-diffusion globale. |
| Crédits | Consommation seulement selon workflow backend. |
| Système | Choix espace, switcher, invitations, accès retirés. |
| Notifications | Contextualisées, actionnables, permission-safe. |
| Support | Contextualisé, distinct des messages métier. |
| Responsive | 375 à 1440 testé. |
| États | Loading / empty / error / success / denied. |
| Sécurité | Backend vérifie org + permission + scope. |
| Prototype | Aucun bouton principal mort. |
| Handoff | Matrices, routes, données, dépendances backend complètes. |

**Definition of Done** : Club+ est "Design Ready" quand chaque utilisateur comprend en quelques secondes où il est, ce qui demande son attention, ce qu'il peut faire et quelle est la prochaine action — avec une expérience cohérente sur desktop et mobile.

### Consigne finale à Claude Design

**Simplifier avant d'ajouter.** Réutiliser avant de créer. Masquer avant de verrouiller. Pré-remplir avant de redemander. Contextualiser avant d'expliquer. Ne jamais modifier un écran déjà bon uniquement pour montrer qu'il a été retravaillé.

Fin du document de référence. Toute évolution produit ultérieure doit être ajoutée comme décision explicite afin de ne pas réintroduire des contradictions dans les interfaces ou le handoff.
