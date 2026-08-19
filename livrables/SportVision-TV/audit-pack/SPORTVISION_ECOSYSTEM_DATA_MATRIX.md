# SportVision — Matrice cross-app : source de vérité par entité

Toutes les applications (Vitrine, Connect, Club+, SportVision OS) partagent **le même projet Supabase** (réf. `lulgezzpvrlbftbykzrc`) — il n'y a jamais de synchronisation entre bases séparées, seulement des accès RLS différenciés à un schéma unique. La colonne « Source of truth » indique la ou les tables qui portent réellement la donnée ; les colonnes par app indiquent Lecture (L), Écriture (É), ou vide si l'app n'y touche jamais.

**Constat structurel à garder en tête pour toute la matrice** : le schéma est en migration inachevée entre un modèle historique (`clients`/`clubs`) et un modèle unifié (`organizations`/`memberships`), maintenus synchronisés par des triggers (`sync_club_to_organization`, `sync_client_to_organization`). Une entité "club", par exemple, existe réellement à la fois dans `clubs` ET `organizations` — voir § 56-57 de `SPORTVISION_OS_AUDIT_PACK.md`.

| ENTITÉ | SOURCE OF TRUTH | VITRINE | CONNECT | CLUB+ | OS | STRIPE | STORAGE |
|---|---|---|---|---|---|---|---|
| Utilisateur (compte) | Supabase Auth (`auth.users`) | — | L/É (self) | L/É (self) | L/É (staff, admin-delete-portal-account) | — | — |
| Profil staff interne | `profiles` | — | — | — | L/É | — | — |
| Profil joueur | `player_profiles` | — | L/É (self) | L (club) | L (staff) | — | — |
| Profil parent | `parent_profiles` | — | L/É (self) | — | — | — | — |
| Client (CRM) | `clients` (legacy) + `organizations` (cible) | — | — | — | L/É | — | — |
| Club (organisation) | `clubs` (legacy) + `organizations` (cible, `legacy_club_id`) | — | L (via affiliation) | L/É (son club) | L/É (staff) | — | — |
| Membre de club | `club_members` + `memberships` | — | — | L/É (son rôle) | L (staff) | — | — |
| Équipe | `club_teams` | — | L (son équipe) | L/É (club) | L | — | — |
| Rattachement joueur↔équipe | `team_memberships` | — | L (self) | L/É (club) | L | — | — |
| Demande d'adhésion/affiliation | `membership_requests` | — | Écrit la demande | L/É (validation) | L | — | — |
| Code d'invitation équipe | `team_invite_codes` | — | L (usage) | L/É (génération) | — | — | — |
| Catalogue de prestations | `catalogue_offres` | L (public, `actif=true`) | L | L | L/É (staff) | Mapping Price/Product (sanitisé, non publié) | — |
| Demande de prestation (invité) | `prestations` (créée via `create-guest-request`) | Écrit (via edge function) | — | — | L/É | — | — |
| Demande de prestation (club) | `club_bookings` | — | — | Écrit | L/É (staff) | — | — |
| Prestation (mission, cycle complet) | `prestations` | — | L (ses commandes) | L (ses commandes) | L/É (staff, table pivot à 52 colonnes) | Lié via `paiements` | — |
| Affectation équipe/opérateur | `prestations_equipe` | — | — | — | L/É (staff prod/sec/admin) | — | — |
| Devis | `devis` (miroir `client_devis` côté client) | — | — | — (via portail_client_id) | L/É (staff) | — | — |
| Décision client sur devis | RPC `client_decide_devis` → `devis.statut` | — | — | (si relié à un portail) | L | — | — |
| Contrat | `contrats` (miroir `client_contrats`) | — | — | Lu si `portail_client_id` renseigné (dont Full Communication) | L/É (staff) | — | — |
| Signature de contrat | Webhook Youtrust → `contrats.signature_statut` | — | — | L (statut) | L/É | — | — |
| Facture | `factures` (miroir `client_factures`) | — | — | Lu si relié | L/É (staff) | Pennylane (`pennylane_invoice_id`) | — |
| Paiement | `paiements` | — | Déclenche via Stripe Checkout | Déclenche via Stripe Checkout | L/É (webhook) | Source of truth du statut réel (`stripe_payment_intent_id`) | — |
| Avoir / note de crédit | `avoirs` | — | — | — | L/É (staff) | Pennylane (`credit_note_id`) | — |
| Paiement collectif (cagnotte) | `group_fundings` + `funding_contributions` | — | Écrit (création + contribution) | — | L (staff finance) | Checkout par contribution | — |
| Crédits Club+ (quota visuels) | `organization_entitlements` (quota) + `club_credit_transactions`/`organization_credit_transactions` (mouvements) | — | — | L (solde) | L/É (staff, RPC `credit_organization`) | — | — |
| Demande de visuel/contenu | `club_requests` / `requests` | — | — | Écrit (crédits réservés) | L/É (staff production) | — | — |
| Contenu/média produit | `club_creations`, `club_media`, `contenus`, `media_liens`, `media_livrables` | — | L (consultation) | L (consultation) | L/É (staff, chaîne complète liens→livrables→versions→corrections→postproductions) | — | Fichiers réels (bucket `clubplus-media`/`portail-media`) |
| Autorisation parentale | `parental_authorizations` + `authorization_events`/`authorization_versions` | — | Écrit/consulte (parent) | L (staff club, admin) | L | — | — |
| Autorisation d'accès délégué | `connect_access_relationships` | — | L/É (self, parent↔enfant, agent↔joueur) | — | — | — | — |
| Demande d'inscription Club+ | `connect_clubplus_signup_requests` | — | Écrit (tunnel public) | — | L/É (staff, validation) | — | — |
| Token d'activation organisation | `clubplus_activation_tokens` / `connect_org_activation_tokens` | — | Consommé | — | Généré par le staff | — | — |
| Club "déclaré" (non partenaire) | `connect_declared_clubs` / `connect_declared_club_players` | — | Écrit | — | L (staff, opportunité commerciale) | — | — |
| Module Club+ actif (entitlement) | `organization_entitlements` + `connect_modules` (catalogue) | — | — | L (détermine l'accès UI) | L/É (staff, activation manuelle) | — | — |
| Sponsor / partenaire club | `club_sponsors` | — | — | L/É (club) | L | — | — |
| Kit / matériel | `kits`, `materiels`, `kit_reservations`, `kit_controles` | — | — | — | L/É (staff prod) | — | — |
| Incident | `incidents`, `materiel_incidents` | — | — | — | L/É (staff prod) | — | — |
| Notification | `notifications`, `member_notifications`, `notification_outbox` | — | L (self) | L (self) | L/É (staff + service_role pour l'outbox) | — | — |
| Message (interne staff) | `messages` | — | — | — | L/É | — | — |
| Message client | `messages_client` | — | L (si accès) | L (si accès, via `portail_client_id`) | L/É (staff, CM assigné) | — | — |
| Réservation espèces/mode paiement | `prestations.mode_paiement_choisi`, RPC `connect_choose_especes_for_prestation` | — | Écrit | — | L | — | — |
| Rétractation | `retractation_demandes` | Formulaire vitrine (`submit-retractation-demande`) | — | — | L/É (staff) | — | — |
| Formation interne (staff) | `formation_inscriptions`, `formation_sessions`, `formation_quiz_questions` | — | — | — | L/É (staff, self-service + admin) | — | — |
| XP / gamification staff | `xp_events` | — | — | — | L/É (staff) | — | — |
| Coût salarial collaborateur | `employee_costs` | — | — | — | L/É (staff admin/compta uniquement) | — | — |
| Dépenses entreprise | `expenses` | — | — | — | L/É (staff finance) | — | — |
| Rapprochement bancaire | *(voir § "Rapprochement" du pack — non confirmé comme un vrai rapprochement transactionnel, voir avertissement ci-dessous)* | — | — | — | L (staff finance) | — (pas de lien API bancaire confirmé dans cette passe) | — |
| Événement/tournoi | `event_editions`, `event_sessions`, `event_checklist_items` | — | — | L/É (organisateur) | L/É (staff) | — | — |
| Projet collectif équipe | `team_projects`, `team_project_contributions` | — | L/É (self) | — | L (staff) | Checkout par contribution | — |

## Avertissement explicite — § 42/89 du plan d'audit d'origine

Ce pack **ne confirme pas** (à ce stade de la recherche) que l'écran « Rapprochement » de SportVision OS effectue un vrai rapprochement transactionnel banque↔comptabilité (aucune intégration bancaire — Qonto/Revolut — détectée dans les 37 edge functions recensées, aucune table `bank_transactions` ou équivalent trouvée dans les 168 tables du schéma). Ceci est cohérent avec le principe du prompt d'audit d'origine : « Facture visible ≠ facturation opérationnelle », « Dashboard Finance ≠ rapprochement bancaire fonctionnel ». **À confirmer explicitement dans la section dédiée du pack, en lisant le code réel de l'écran `loadRapprochement()` avant de conclure quoi que ce soit** (recherche en cours, voir avancement dans `SPORTVISION_OS_AUDIT_PACK.md`).
