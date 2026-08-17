# SportVision Club+ — Handoff développement

Prototype de référence : `SportVision Club+.dc.html` (cliquable, tous profils via la barre démo).
Documentation visuelle : `Handoff Club+.dc.html`.
Version : 16 août 2026.

---

## 1. Positionnement écosystème

- **SportVision Connect** = la personne (joueurs, sportifs, parents, agents). Compte personnel.
- **SportVision Club+** = la structure (clubs, académies, coachs indépendants, structures de coaching, tournois, stages, associations). Espace professionnel.
- **SportVision OS** = back-office interne SportVision.

Règles fondamentales :
- **Un seul compte SportVision** par personne. Jamais de `clubplus_users` séparés. Les accès viennent des memberships.
- Une demande, une facture, un contrat, une affiliation = **un seul objet métier** partagé Club+ ↔ OS (`source = clubplus`). Jamais de duplication.
- La structure possède une **relation d'affiliation**, jamais le compte Connect du sportif (pas d'accès mot de passe, messages privés, factures personnelles, autres affiliations).
- Multi-tenant strict : `organization_id` sur toute donnée B2B ; le frontend masque, **le backend vérifie chaque requête** (user + membership + mandate + permission + scope + resource). Retrait d'accès appliqué dès la requête suivante.

## 2. Modèle d'expérience

L'interface est déterminée par la combinaison :

```
ORGANIZATION_TYPE + MEMBERSHIP_ROLE + PERMISSIONS + SCOPE + ACTIVE_OFFER
```

Le rôle seul ne suffit jamais. La fonction déclarée (Président, Coach…) est **purement déclarative** et n'accorde aucun droit.

### Types d'organisation
`club` · `academy` · `independent_coach` (avec `professional_type`) · `coaching_structure` · `tournament_organizer` · `camp` · `association` · `other`

### Vocabulaire adaptatif
| Concept | Club | Académie | Coach indép. | Struct. coaching | Tournoi | Stage/Camp |
|---|---|---|---|---|---|---|
| Personne | Joueur | Sportif | Sportif | Sportif | — | Participant |
| Collection | Équipe & catégorie | Groupe | Mes groupes | Groupe | Équipe participante (légère) | Groupe |
| Objet central | Structure/équipes | Sportifs/groupes | Mes sportifs | Sportifs/coachs | **Événement/édition** | **Session** |
| Staff | Coach (membre) | Coach | — | Coach & intervenant | — | Encadrant |

### Niveaux d'offre (noms démo — la liste réelle vient du backend)
| Niveau | Structure démo | Visuels | Crédits |
|---|---|---|---|
| Sans abonnement | Rois du Béton | masqué | masqué |
| Offre de base | Elite Academy | masqué | masqué |
| Premium | KD Performance | inclus (sur devis) | masqué |
| Full Communication | FC Montereau | inclus | inclus (12/mois démo) |

Module non inclus = **masqué**, jamais verrouillé au cadenas. Aucun prix Club+ inventé : catalogue, offres, crédits, règles de recharge/report viennent du backend (`active_offer`).

## 3. Rôles & permissions

Rôles = presets de permissions granulaires, personnalisables. Source de vérité = permissions backend.

| Rôle | Modules | Actions clés | Scope |
|---|---|---|---|
| Administrateur / Owner | tous (selon offre) | tout, incl. membres & permissions, devis, paiement, partage Connect | organisation |
| Communication | demandes, contenus, visuels, crédits, calendrier, messages | demander/valider visuel, télécharger, partager Connect | organisation |
| Directeur / Responsable sportif | équipes (multi), affiliations, matchs & résultats, demandes, contenus, calendrier | vérifier/corriger résultats, gérer affiliations, staff équipe | team_scope[] |
| Coach / éducateur | demandes, contenus, affiliations, matchs & résultats, calendrier | saisir résultat, demande préremplie équipe | team:<id> |
| Secrétaire / Administratif | demandes, suivi administratif, documents, calendrier, affiliations (option) | compléter infos, consulter (voir ≠ signer/accepter) | organisation |
| Finance / Trésorier | factures & paiements, devis & engagements, documents, offre | régler (si `pay_invoice`), accepter devis (si `approve_quote`) | organisation |
| CM / prestataire externe | selon mandat | scope événement/groupes, durée limitée | mandate |

Permissions conceptuelles (extraits) : `view_services`, `create_service_request`, `view_contents`, `download_contents`, `share_content_to_connect`, `request_visual`, `validate_visual`, `manage_affiliations`, `manage_teams`, `manage_members`, `view_quotes`, `approve_quotes`, `view_contracts`, `sign_contracts`, `view_invoices`, `pay_invoice`, `view_calendar`, `send_messages`, `enter_match_result`, `verify_match_result`, `edit_match_result`, `view_events`, `create_event`, `edit_organization_profile`, `request_legal_change`.

Séparations critiques : voir ≠ accepter (devis) ; voir ≠ signer (contrat, Yousign) ; voir ≠ payer (facture, Stripe). L'administrateur principal n'est pas retirable sans transfert de responsabilité.

## 4. Navigation par scénario (sidebar exacte)

- **FC Montereau · Admin** : Accueil · [SportVision] Prestations, Mes demandes, Mes contenus, Calendrier, Messages · [Communication] Demandes de visuels, Crédits · [Structure] Joueurs & affiliations, Équipes & catégories, Membres & accès · [Administration] Documents, Factures & paiements, Mon offre · Paramètres
- **Communication** : Accueil · Mes demandes, Mes contenus, Calendrier, Messages · Demandes de visuels, Crédits — sans Prestations, Structure, Administration
- **Coach U18** : Accueil · Mes demandes, Mes contenus, Calendrier, Messages · [Mon équipe] Joueurs & affiliations, Matchs & résultats — tout scopé U18 R2, zéro finance
- **Directeur sportif** : Accueil · [Sportif] Mes équipes, Joueurs & affiliations, Matchs & résultats (multi-équipes du scope) · [SportVision] Prestations, Demandes, Contenus, Calendrier, Messages — zéro finance
- **Secrétaire** : Accueil · Demandes, Calendrier, Messages · [Administration] Documents, Suivi administratif · affiliations si permission
- **Trésorier** : Accueil · [Finance] Factures & paiements, Devis & engagements, Documents · Messages · Mon offre — pas de CTA Nouvelle demande
- **KD Performance (owner)** : Accueil · Prestations, Demandes, Contenus, Calendrier, Messages · [Mes sportifs] Mes sportifs, Mes groupes · Administration · Paramètres — pas de Membres & accès (seul)
- **Elite Academy** : sidebar admin, wording Sportifs & affiliations / Groupes & catégories
- **Performance Lab** : + Coachs & intervenants (≠ Membres & accès) ; profil Coach scopé sur ses groupes/sportifs assignés
- **Rois du Béton (tournoi)** : Accueil · Demandes, Contenus, Calendrier, Messages · [Mes événements] Événements, Membres & accès · Administration — pas d'affiliations/équipes

## 5. Routes conceptuelles

```
/clubplus                          /clubplus/services
/clubplus/requests                 /clubplus/requests/:id
/clubplus/content                  /clubplus/content/:albumId
/clubplus/visuals                  /clubplus/credits
/clubplus/affiliations             /clubplus/teams          /clubplus/teams/:teamId
/clubplus/matches                  /clubplus/matches/:id
/clubplus/events                   /clubplus/events/:eventId
/clubplus/members                  /clubplus/coaches
/clubplus/documents                /clubplus/billing
/clubplus/offer                    /clubplus/calendar
/clubplus/messages                 /clubplus/settings
/clubplus/admintrack                /clubplus/help
```

URL directe sans permission → page « Vous n'avez pas accès à cette section » + Retour à l'accueil (refus backend obligatoire, pas seulement masquage).

## 6. Référentiels de statuts (uniques, pas de synonymes)

- **Demande** : Brouillon · Envoyée · À compléter · En validation · Devis envoyé · En attente de signature · Confirmée · Planifiée · En production · Livrée · Terminée · Annulée
- **Visuel** : Brouillon · Envoyé · En création · À valider · Modification demandée · Validé · Livré
- **Facture** : Payée · À régler · En retard · Annulée (montants : liste = TTC explicite ; fiche = HT / TVA / TTC / déjà payé / reste à régler)
- **Devis** : À consulter · À valider · Accepté · Refusé · Expiré — acceptation uniquement depuis la fiche
- **Contrat (Yousign)** : À signer · Signé · Expiré — statut réel Yousign, jamais de signature simulée
- **Match/résultat** : À venir · À compléter (résultat à renseigner) · À vérifier (si `requires_result_verification`) · Résultat renseigné/Confirmé · Reporté · Annulé
- **Événement** : Brouillon · À venir · En cours · Terminé · Reporté · Annulé
- **Affiliation** : pending · active · ended (fin d'affiliation ≠ suppression de compte)
- **Membership** : Invitation envoyée (Renvoyer/Annuler) · Actif (Modifier les accès/Retirer) · Suspendu · Retiré
- **Inscription publique** : pending_review · informations requises · validée (→ organisation + membership + invitation sécurisée) · refusée
- **Support** : Envoyée · En cours · Réponse disponible · Résolue · Fermée

## 7. Workflows clés

### Prestation (E2E)
Demande (wizard : type → contexte équipe/sportif/événement → date/lieu → options → récapitulatif) → OS reçoit (même objet) → devis → consultation fiche → acceptation → signature Yousign si contrat → planification → production → livraison contenus → facture → paiement Stripe. Pas de paiement immédiat obligatoire (logique B2B ≠ Connect).

### Résultat de match (saisie unique, réutilisation partout)
Coach saisit (score steppers mobile, statut Terminé/Reporté/Annulé, buteurs/passeurs/MVP/commentaire facultatifs, média) → [option `requires_result_verification`] Directeur sportif vérifie/corrige (historique conservé, demande de précision possible) → Communication notifiée automatiquement → brief visuel prérempli. **Jamais** de consommation de crédit ni de prestation payante automatique. Objet `match_result` : org, team, match, scores, status, entered_by, verified_by (nullable), scorers, player_of_match, communication_note, media, historique.

### Affiliation
Demande Connect (ou invitation email/lien/QR à usage unique, 14 j) → structure accepte / modifie l'équipe puis accepte / refuse (confirmations) → relation active. Multi-affiliations valides (FC Montereau + Elite Academy + KD Performance) avec isolation stricte inter-structures.

### Visuel
Nouveau visuel (brief : type, équipe/événement, texte, fichiers, deadline) → En création → À valider → ouverture **fiche obligatoire** (aperçu, version, fichiers, brief, historique) → Valider ou Demander une modification (textarea obligatoire) → Livré. « Demander un visuel » (Crédits) = même workflow.

### Inscription publique
3 étapes (Structure → Contact → Besoins & validation) + confirmation. Labels de nom dynamiques par type, sous-type coach obligatoire, « j'exerce sous mon propre nom », validations inline, récapitulatif, certification adaptée. Crée `status=pending_review` → jamais un admin actif. OS : valider / demander infos / refuser.

## 8. Composants réutilisables

OrganizationSwitcher (structures + accès externes distincts + niveau d'offre) · RequestCard · ServiceCardB2B · TeamCard/GroupCard · PlayerAffiliationRow · MemberAccessCard (fonction ≠ rôle ≠ périmètre ≠ permissions) · CoachAssignmentCard · VisualRequestCard · DocumentCard · InvoiceCard · OrganizationEventCard · OfferCard · MatchCard · ResultForm · EventCard/EventHeader · CalendarEvent · MessageThread (contextualisé, lien « Voir la demande ») · NotificationItem (actionnable, contexte structure, ACTION REQUISE) · SupportTicket · systèmes : modals de confirmation (toute action destructive), drawers, toasts, skeletons, empty/error/permission-denied.

## 9. États transversaux

- **Système** : choisir mon espace (si >1 destination ; entrée directe si 1 seul Club+) · aucun espace Club+ · demande en vérification · infos complémentaires · demande refusée · accès suspendu/retiré · mandat externe terminé · invitation (acceptée/refusée/expirée/déjà utilisée) · session expirée · 404 · erreur · réseau. Layout système sans sidebar ; jamais de détail technique exposé (403, ids, scopes).
- **Notifications** : objet {user, org nullable, type, resource_type/id, action_url, read_at, priority}. Toujours actionnables, routées par rôle+permission+scope (un coach ne reçoit jamais une facture), contexte structure affiché, lu ≠ traité, préférences personnelles (certaines critiques non désactivables).
- **Aide & support** : centre d'aide filtré par rôle, FAQ, ticket support contextualisé (structure/rôle/page joints côté backend), suivi SUP-…, aucun SLA promis. Support ≠ Messages métier.

## 10. Mobile

Breakpoints testés : 375 / 390 / 430 / 768 / 1024 / 1280 / 1440. Bottom nav adaptative : Accueil · Demandes · Contenus · Structure (→ Sportifs/Événements/Sessions selon type) · Plus. Tables → cards, jamais de scroll horizontal. Hit targets ≥ 44 px. Parcours prioritaire coach : match terminé → score → buteurs → confirmer en < 1 min.

## 11. Backend requis (non simulé dans le prototype)

- Catalogue prestations par type de structure (`service.applicable_organization_types`), prix et règles HT/TTC
- Offres réelles (nom, services, crédits, recharge/report/expiration, engagement, renouvellement, réductions)
- Paiement : workflow Stripe existant (jamais simulé) ; signature : Yousign (statut réel)
- Permissions/scopes vérifiés serveur sur chaque requête ; feature flags par offre
- Invitations sécurisées : token unique, expiration, usage unique, email ciblé
- Notifications routées + webhooks OS↔Club+ (statuts demande, livraisons, visuels)
- Métadonnées médias (tag équipe/sportif/événement) pour filtres et partage Connect
- Validation SportVision des inscriptions publiques et des modifications légales (SIREN, raison sociale, adresse facturation → « Demander une modification »)

## 12. Décisions produit restantes

- Noms/contenus réels des offres et politique HT/TTC par segment
- `requires_result_verification` par défaut ? (recommandé : off, activable par structure)
- Délai de traitement des inscriptions (aucune promesse affichée tant que non validée)
- Workflow de transfert de responsabilité administrateur
- Participants de stage reliés à Connect (architecture prête, workflow non imposé en V1)
- Module albums individuels / familles (hors V1)

## 13. Hors scope (ne pas développer)

Feuilles de match FFF, compositions/tactiques, statistiques joueurs, convocations, présences entraînements, licences/cotisations, comptabilité générale, paie/RH, stock, billetterie, inscription tournoi/poules/brackets/classements, live scores, channels/réactions/statut en ligne, chatbot, données santé (blessures, IMC, nutrition), CRM complet.
