# Modèle de données — SportVision Connect

Entités, champs, relations et énumérations tels que la maquette les suppose. Les noms sont des
propositions ; adaptez-les aux conventions du codebase.

---

## Vue d'ensemble

```
User ──┬── Membership ──── Organization ──┬── Subscription ──── Plan
       │                        │         │
       │                        │         ├── Team ──── Player ──── ImageRight
       │                        │         ├── Guardianship (parent → Player)
       │                        │         ├── Sponsor ──── SponsorDeliverable
       │                        │         ├── Contract ──── Invoice
       │                        │         ├── VisualRequest ──── StudioTemplate
       │                        │         ├── Service ──┬── Deliverable
       │                        │         │             ├── Milestone
       │                        │         ├── MediaAsset ──── Collection
       │                        │         ├── Publication
       │                        │         ├── NewsroomItem
       │                        │         ├── Match
       │                        │         ├── Camp
       │                        │         ├── EventPhase
       │                        │         ├── CalendarEvent
       │                        │         ├── Document
       │                        │         ├── Report
       │                        │         ├── Integration
       │                        │
       ├── Notification         ├── parentOrganizationId (joueur rattaché)

Thread ──── Message          rattachés à un objet (polymorphe)
Comment                      polymorphe sur Service, VisualRequest, MediaAsset,
                             Publication, Contract, CalendarEvent, SupportTicket
```

---

## User

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `firstName`, `lastName` | string | |
| `email` | string | unique, vérifié |
| `emailVerifiedAt` | datetime? | |
| `phone` | string? | |
| `birthDate` | date? | |
| `avatarUrl` | string? | initiales en repli |
| `jobTitle` | string? | |
| `locale` | enum | `fr`, `en` |
| `timezone` | string | IANA |
| `theme` | enum | `dark` (défaut), `light` |
| `mfaEnabled` | boolean | |
| `mfaBackupCodes` | string[] | hachés |
| `lastLoginAt` | datetime? | |
| `onboardingStep` | int | 0-10, permet la reprise |
| `onboardingCompletedAt` | datetime? | |
| `notificationPreferences` | json | voir plus bas |

---

## Organization

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `type` | enum | `club`, `academy`, `coach`, `player`, `parent`, `cm_agency`, `sponsor`, `event`, `generic` |
| `name` | string | |
| `logoUrl` | string? | |
| `address`, `siret`, `legalName` | string? | |
| `brandColors` | string[] | hex, 2 à 5 valeurs |
| `instagramHandle`, `tiktokHandle` | string? | |
| `teamCount`, `memberCount` | int? | club et académie |
| `parentOrganizationId` | uuid? | joueur rattaché à un club |
| `accountManagerId` | uuid | interlocuteur SportVision |
| `communityManagerId` | uuid? | si Full Communication |
| `createdAt` | datetime | |

`type = generic` répond à l'exigence d'accueillir de futurs clients hors catégories.

### Joueur affilié vs indépendant

| | Affilié | Indépendant |
|---|---|---|
| `parentOrganizationId` | renseigné | `null` |
| Abonnement propre | non — porté par le club | oui |
| Navigation | sans Factures ni Sponsors | complète |
| Bandeau | « Rattaché à \<club\> · CLUB ABONNÉ » | « Joueur indépendant · SANS CLUB » |
| Contenus visibles | ceux où il apparaît, selon les permissions du club | les siens |

Un club peut inviter un joueur indépendant : son espace bascule alors sur l'offre du club.

---

## Membership

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `userId`, `organizationId` | uuid | |
| `role` | enum | voir ci-dessous |
| `teamScope` | uuid[] | vide = toutes les équipes |
| `capabilities` | string[] | surcharges explicites |
| `status` | enum | `active`, `invited`, `disabled` |
| `startsAt`, `endsAt` | date? | accès à durée limitée — CM externe |
| `invitationToken` | string? | valable 7 jours |
| `lastSeenAt` | datetime? | |

### Rôles

**Club** — `owner` · `admin` · `president` · `communication_manager` · `secretary` · `coach` ·
`team_manager` · `sponsor_manager` · `treasurer` · `board_member` · `player` · `parent` ·
`viewer` · `external_cm`

**Académie** — `admin` · `manager` · `coach` · `internal_cm` · `staff` · `player` · `parent`

**Événement** — `event_admin` · `communication_manager` · `partner_manager` · `staff` ·
`volunteer` · `partner`

Règles : une organisation a exactement un `owner`, non désactivable sans transfert.
`viewer` est en lecture seule et voit un badge « Lecture seule » ; toute action d'écriture affiche
« Votre rôle ne vous permet pas d'effectuer cette action. Contactez l'administrateur du club pour
demander un accès supplémentaire. »

---

## Guardianship — parent → enfant

| Champ | Type | Notes |
|---|---|---|
| `guardianUserId` | uuid | le parent |
| `playerId` | uuid | l'enfant |
| `relation` | enum | `parent`, `legal_guardian` |
| `canManageServices` | boolean | réserver, payer |
| `canManageAuthorizations` | boolean | droit à l'image |
| `canViewContent` | boolean | |

Un parent peut avoir plusieurs enfants. Il ne voit **que** ses enfants.

---

## Plan et Subscription

### Plan — table de référence

| `code` | `name` | `tier` | `monthlyPrice` | `monthlyCredits` | `seasonPresences` | `maxUsers` |
|---|---|---|---|---|---|---|
| `essentiel` | Essentiel | 1 | 190 *(à confirmer)* | **0** | 0 | 3 |
| `club_plus_start` | Club+ Start | 2 | 390 *(à confirmer)* | **10** | 2 | 8 |
| `club_plus_performance` | Club+ Performance | 2 | 690 *(à confirmer)* | **40** | 5 | `null` |
| `full_communication` | Full Communication | 3 | `null` *(sur devis)* | `null` *(sur mesure)* | 12 | `null` |
| `club_access` | Accès via le club | 1 | 0 | 3 | 0 | 1 |
| `one_off` | Prestation unique | 1 | `null` *(à la commande)* | 1 | 1 | 2 |

`monthlyPrice = null` → l'interface affiche le libellé, pas un montant.
`monthlyCredits = 0` → l'offre travaille à la prestation ; l'interface affiche « À la carte »
plutôt qu'une jauge vide, et les conditions ne parlent pas de crédits mensuels.
`maxUsers = null` → illimité.

**Aucun écran ne teste le `code`.** Tout passe par le `tier` et les capacités.

### Subscription

| Champ | Type | Notes |
|---|---|---|
| `id`, `organizationId` | uuid | |
| `planCode` | string | |
| `status` | enum | `active`, `past_due`, `suspended`, `cancelled` |
| `startsAt`, `renewsAt` | date | |
| `commitmentMonths` | int | 12 |
| `noticeMonths` | int | 2 |
| `creditsRemaining` | int | remis à `monthlyCredits` le 1er |
| `creditsReserved` | int | réservés, pas encore consommés |
| `presencesUsed` | int | remis à 0 en début de saison |
| `storageUsedBytes`, `storageQuotaBytes` | bigint | |
| `stripeSubscriptionId`, `stripeCustomerId` | string? | |

### Modèle de réservation de crédits

À la soumission d'une demande, le coût est **réservé** (`creditsReserved += cost`), pas déduit.

| Transition | Effet |
|---|---|
| → `Terminée` | réservation convertie en consommation, ligne au grand livre |
| → `Refusée` / `Annulée` | réservation libérée, aucun débit |

Côté serveur, les réservations devraient être leurs propres lignes de grand livre avec un statut
`pending` / `confirmed` / `released`.

### CreditLedger

| Champ | Type | Notes |
|---|---|---|
| `subscriptionId` | uuid | |
| `delta` | int | négatif = consommation |
| `reason` | enum | `monthly_grant`, `request`, `reservation`, `release`, `refund`, `bonus`, `adjustment` |
| `sourceType`, `sourceId` | string?, uuid? | |
| `status` | enum | `pending`, `confirmed`, `released` |
| `createdAt` | datetime | |

### Entitlement

`subscriptionId` · `feature` · `enabled` → active une option sans changer l'offre.

---

## StudioTemplate

| Champ | Type | Notes |
|---|---|---|
| `code` | string | ex. `matchday`, `starting_xi` |
| `name` | string | |
| `category` | enum | `pre_match`, `match_day`, `post_match`, `players`, `club_life`, `sponsors`, `events` |
| `creditCost` | int | 1 à 3 |
| `deliveryDelay` | string | `2 h`, `24 h`, `48 h`, `72 h` |
| `previewUrl` | string? | |
| `sampleUrls` | string[] | 3 réalisations |
| `formFields` | json | champs demandés, dépendants de la catégorie |
| `prefilledFields` | string[] | club, logo, couleurs, sponsors, saison |
| `minTier` | int | 2 pour tout le Studio |

47 modèles répartis sur 7 catégories — la liste complète est dans `ACTIONS.md` §6.

---

## VisualRequest

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `reference` | string | `VIS-AAAA-NNNN` |
| `organizationId`, `requestedById` | uuid | |
| `assigneeId` | uuid? | côté OS |
| `templateCode` | string? | si créée depuis le Studio |
| `visualType` | enum | 12 valeurs |
| `teamId`, `eventId`, `sponsorId` | uuid? | |
| `publishDate` | date | |
| `format` | enum | `post_1_1`, `story_9_16`, `reel_9_16`, `banner_16_9` |
| `platform` | enum | `instagram`, `tiktok`, `facebook`, `website`, `print` |
| `bodyText` | text? | repris tel quel |
| `urgency` | enum | `standard` (1 crédit, 5 j), `priority` (2, 48 h), `express` (3, 24 h) |
| `creditsReserved` | int | |
| `status` | enum | voir chaînes de statuts |
| `revisionCount` | int | 2 incluses, la 3ᵉ facturée |
| `dueAt` | datetime | |
| `attachments` | Attachment[] | |

---

## NewsroomItem

| Champ | Type | Notes |
|---|---|---|
| `id`, `organizationId` | uuid | |
| `title`, `body` | string, text | |
| `submittedById` | uuid | l'éducateur ou le membre qui remonte |
| `teamId` | uuid? | |
| `status` | enum | `received`, `to_process`, `info_requested`, `transformed`, `archived` |
| `transformedIntoType` | enum? | `publication`, `visual_request` |
| `transformedIntoId` | uuid? | |

## Match

| Champ | Type | Notes |
|---|---|---|
| `id`, `organizationId`, `teamId` | uuid | |
| `opponent` | string | |
| `competition` | string | |
| `kickoffAt` | datetime | |
| `venue` | string | |
| `isHome` | boolean | |
| `scoreFor`, `scoreAgainst` | int? | |
| `scorers` | json? | |
| `manOfTheMatch` | uuid? | |
| `status` | enum | `upcoming`, `result_pending`, `result_received`, `content_created` |

Formulaire express : 3 champs (score, buteurs, homme du match). Formulaire complet : 14 champs.

## Camp — stages d'académie

| Champ | Type | Notes |
|---|---|---|
| `id`, `organizationId` | uuid | |
| `name` | string | |
| `startsAt`, `endsAt` | date | |
| `venue` | string | |
| `groupIds` | uuid[] | |
| `capacity`, `registered` | int | |
| `staffIds` | uuid[] | |
| `programme` | text? | |
| `status` | enum | `upcoming`, `open`, `full`, `running`, `completed` |

## EventPhase — timeline d'événement

| Champ | Type | Notes |
|---|---|---|
| `eventId` | uuid | |
| `phase` | enum | `before`, `during`, `after` |
| `startsAt`, `endsAt` | date | |
| `status` | enum | `planned`, `in_progress`, `completed` |
| `items` | json[] | `{ label, description, done }` |

---

## Service — prestation

| Champ | Type | Notes |
|---|---|---|
| `id`, `reference` | uuid, string | `PRE-AAAA-NNNN` |
| `organizationId` | uuid | |
| `serviceType` | enum | 12 valeurs |
| `date`, `startTime`, `endTime` | date, time | |
| `address` | string | alimente l'estimation de déplacement |
| `teamId`, `eventId` | uuid? | |
| `onSiteContactName`, `onSiteContactPhone` | string | |
| `brief` | json | objectif, contraintes, références, à éviter |
| `options` | ServiceOption[] | |
| `basePrice`, `optionsTotal`, `discountAmount`, `travelFees`, `totalPrice` | decimal | |
| `depositAmount` | decimal | 30 % |
| `depositPaidAt`, `balancePaidAt` | datetime? | |
| `status` | enum | voir chaînes |
| `progressPercent` | int | |
| `operatorIds` | uuid[] | côté SportVision |
| `isIncludedInPlan` | boolean | présence incluse vs facturée |

**Options** : `drone` 250 € · `reel` 180 € · `highlight` 220 € · `express_delivery` 150 € ·
`extra_photographer` 320 € · `interview` 140 € · `live_stories` 110 €

**Deliverable** : `serviceId`, `label`, `quantity?`, `status` (`planned`, `option_selected`,
`in_production`, `delivered`), `mediaAssetIds[]`
**Milestone** : `serviceId`, `label`, `dueDate`, `completedAt?`, `order`

---

## MediaAsset

| Champ | Type | Notes |
|---|---|---|
| `id`, `organizationId` | uuid | |
| `name`, `kind`, `mimeType` | string, enum, string | 10 types de contenu |
| `fileUrl`, `thumbnailUrl` | string | |
| `sizeBytes` | bigint | |
| `aspectRatio` | string | |
| `durationSeconds` | int? | vidéos |
| `serviceId`, `visualRequestId`, `eventId`, `teamId` | uuid? | |
| `authorId` | uuid? | |
| `storageOrigin` | enum | `sportvision_delivered`, `club_storage`, `external_link` |
| `externalUrl`, `externalExpiresAt` | string?, datetime? | |
| `usageRights` | string | |
| `visibility` | enum | `private`, `organization`, `team`, `player`, `public` |
| `downloadAllowed` | boolean | |
| `availableUntil` | date? | |
| `version`, `isFinalVersion`, `previousVersionId` | int, boolean, uuid? | |
| `status` | enum | `to_validate`, `validated`, `revision_requested`, `raw_authorised` |
| `tags` | string[] | |

### MediaAssetPlayer

`mediaAssetId` · `playerId` — **c'est cette table qui alimente la vue filtrée du joueur et du
parent.**

### Collection

`id` · `organizationId` · `name` · `kind` (9 valeurs) · `coverAssetId?` · `itemCount` · `date?` ·
`teamId?` · `ownerId` · `visibility` · `shareToken?` · `shareExpiresAt?` (**30 jours** par défaut)

---

## Publication

| Champ | Type | Notes |
|---|---|---|
| `id`, `organizationId` | uuid | |
| `title` | string | |
| `platform` | enum | `instagram`, `tiktok`, `facebook`, `youtube` |
| `format` | enum | `post`, `story`, `reel` |
| `scheduledAt` | datetime | modifié par le glisser-déposer |
| `bodyText` | text? | |
| `hashtags` | string[] | |
| `mediaAssetIds` | uuid[] | |
| `campaignId`, `sponsorId`, `teamId` | uuid? | le sponsor alimente sa jauge |
| `ownerId` | uuid | |
| `status` | enum | voir chaînes |
| `objective` | string? | |
| `reach`, `engagement`, `views` | int? | remontés depuis OS |
| `externalPostId` | string? | **jamais exposé au client** |

Le glisser-déposer modifie `scheduledAt` uniquement. Le statut ne change pas.

---

## Team, Player, ImageRight

**Team** — `id` · `organizationId` · `name` · `category` · `headCoachId?` · `assistantCoachIds[]` ·
`playerCount` · `trainingSlots?` · `venue?` · `season`

**Player** — `id` · `organizationId` · `teamId` · `userId?` · `playerOrganizationId?` ·
`firstName` · `lastName` · `shirtNumber?` · `position?` · `photoAssetId?` · `licenseStatus` ·
`medicalCertificateAt?` · `contentCount`

**ImageRight** — `playerId` · `status` (`signed`, `pending`, `refused`, `withdrawn`) ·
`signedByName?` · `signedAt?` · `documentId?` · `scopes` · `validUntil?`

`scopes` — 5 périmètres indépendants : photos d'équipe et de match, vidéos et highlights,
portraits individuels, usage commercial, diffusion hors club.

**Règle bloquante** — si `status ≠ signed`, aucun `MediaAsset` lié à ce joueur n'est publiable.
Signalé sur la fiche joueur, la fiche média et l'espace du parent.
Seuls le parent (si mineur), le joueur majeur et l'administrateur du club peuvent modifier ces
paramètres.

---

## Affiliation

| Champ | Type | Notes |
|---|---|---|
| `playerId` | uuid | |
| `organizationId` | uuid | le club |
| `teamId` | uuid | |
| `season` | string | ex. `2026/2027` |
| `startsAt`, `endsAt` | date, date? | |
| `status` | enum | `active`, `ended`, `transferred` |

**Un changement de club n'écrase jamais l'ancienne affiliation.** On clôture la précédente
(`endsAt`, `status = ended`) et on en crée une nouvelle. L'historique reste consultable.

---

## Sponsor

`id` · `organizationId` · `name` · `logoAssetId?` · `level` (4 niveaux) · `startsAt` · `endsAt` ·
`annualAmount` · `paymentSchedule` · `status` (`active`, `to_renew`, `expired`) · `contractId?` ·
`signatories[]`

**SponsorDeliverable** — `sponsorId` · `label` · `period` · `plannedCount` · `deliveredCount` ·
`status`. La jauge de visibilité = somme des `deliveredCount` / somme des `plannedCount`.

---

## Contract et Invoice

**Contract** — `id` · `organizationId` · `name` (dérivé de l'offre) · `kind` · `planCode?` ·
`startsAt` · `endsAt` · `status` · `monthlyAmount?` · `commitmentMonths` · `noticeMonths` ·
`signatories[]` · `signatureProvider` (`yousign`) · `signatureUrl?` (expire à **8 jours**) ·
`viewedAt?` · `signedAt?` · `documentId?` · `annexIds[]` · `amendmentIds[]` · `keyTerms[]`

Reconduction tacite pour 12 mois sauf préavis. Passe en `to_renew` automatiquement 2 mois avant
`endsAt`.

**ContractSchedule** — `contractId` · `dueDate` · `label` · `amount?` · `kind`
(`installment`, `notice_window`, `contract_end`) · `status`

**Invoice** — `id` · `number` (`SV-AAAA-NNNN`) · `organizationId` · `contractId?` · `serviceId?` ·
`issueDate` · `dueDate` · `subject` · `lines[]` · `subtotalExclVat` · `vatRate` (20 %) ·
`vatAmount` · `depositApplied` · `totalInclVat` · `status` · `paymentMethod?` ·
`stripeInvoiceId?` · `paidAt?` · `pdfUrl?` · `receiptUrl?` · `remindersSentAt[]`

**InvoiceLine** — `label` · `quantity?` · `unitPriceExclVat?` · `totalExclVat`

### Règle de suspension

| Retard | Effet |
|---|---|
| 3 jours | 1ʳᵉ relance, badge « en retard » |
| 8 jours | 2ᵉ relance |
| 15 jours | 3ᵉ relance + `Subscription.status = suspended` |
| > 15 jours | création de nouvelles demandes bloquée ; contenus livrés toujours accessibles |
| Paiement | accès rétabli immédiatement |

**Jamais de numéro de carte complet stocké ni affiché.** Uniquement les 4 derniers chiffres et
l'expiration, servis par Stripe.

---

## Report — rapport mensuel

`id` · `organizationId` · `period` (`2026-07`) · `status` (`draft`, `available`, `read`) ·
`summary` · `objectives` · `contentsProduced` · `performance` (json) · `bestPublicationId?` ·
`servicesCompleted` · `recommendations` · `nextMonthPlan` · `pdfUrl?`

Réservé à Full Communication.

---

## CalendarEvent

`id` · `organizationId` · `kind` (10 valeurs) · `title` · `startsAt` · `endsAt?` · `allDay` ·
`location?` · `teamId?` · `sourceType?` · `sourceId?` · `externalCalendarId?` · `syncDirection`

Le calendrier central est une **vue agrégée** : prestations, publications et échéances y
apparaissent sans duplication.

---

## Document

`id` · `organizationId` · `name` · `kind` (`quote`, `contract`, `invoice`, `image_right`,
`brand_guidelines`, `logo_pack`, `insurance`, `medical`, `roster`, `report`, `other`) ·
`mimeType` · `fileUrl` · `sizeBytes` · `uploadedById` · `teamId?` · `playerId?` · `status` ·
`completionRatio?` · `expiresAt?`

---

## Thread et Message

Il n'y a **pas de messagerie générale.** Chaque fil est rattaché à un objet.

**Thread** — `id` · `organizationId` · `subject` · `contextType` (`communication`, `service`,
`visual_request`, `billing`, `support`, `general_account`) · `contextId?` ·
`sportvisionRoleLabel` (Community Manager, Chargé de compte, Secrétariat, Studio, Support) ·
`participantIds[]` · `lastMessageAt` · `unreadCountByUser` (json)

**Message** — `id` · `threadId` · `authorId` · `body` · `attachmentIds[]` · `reactions` (json) ·
`replyToId?` · `readByUserIds[]` · `visibility` (**`client_visible` | `internal_only`**) ·
`createdAt`

**Règle absolue** — un message `internal_only` n'apparaît jamais dans Connect. Deux catégories,
deux permissions, aucune fuite.

**Comment** — commentaires contextuels attachés à un objet précis, avec
`videoTimestampSeconds?` pour les commentaires horodatés sur vidéo, `mentionedUserIds[]`,
`resolvedAt?`.

---

## Notification

`id` · `userId` · `organizationId` · `category` (8 valeurs) · `title` · `body` · `targetType` ·
`targetId` · `isPinned` · `isCritical` · `readAt?` · `emailSentAt?`

### notificationPreferences

```json
{
  "content":   { "email": true,  "inApp": true,  "frequency": "immediate" },
  "services":  { "email": true,  "inApp": true,  "frequency": "immediate" },
  "contracts": { "email": true,  "inApp": true,  "frequency": "immediate" },
  "payments":  { "email": true,  "inApp": true,  "frequency": "immediate" },
  "requests":  { "email": false, "inApp": true,  "frequency": "daily_digest" },
  "users":     { "email": false, "inApp": true,  "frequency": "weekly_digest" },
  "calendar":  { "email": false, "inApp": true,  "frequency": "daily_digest" },
  "system":    { "email": false, "inApp": false, "frequency": "monthly" },
  "quietHours": { "notBefore": "08:00", "notAfter": "21:00", "sundayUrgentOnly": true }
}
```

Les notifications `isCritical` — impayé, suspension, contrat expiré — sont envoyées quelles que
soient les préférences et les heures calmes. Un rappel maximum par échéance et par semaine.

---

## SupportTicket

`id` · `reference` (`TCK-AAAA-NNNN`) · `organizationId` · `createdById` · `category` · `module?` ·
`priority` · `description` · `attachmentIds[]` · `status` · `assigneeId?`

---

## Integration

`id` · `organizationId` · `provider` (`google_calendar`, `instagram`, `tiktok`, `meta_business`,
`whatsapp`, `stripe`, `metricool`, `yousign`) · `status` · `accountLabel?` · `scopes[]` ·
`accessToken` (chiffré) · `refreshToken?` (chiffré) · `expiresAt?` · `lastSyncedAt?` ·
`syncLog[]`

**Aucun de ces champs techniques n'est exposé au client.** L'interface affiche : état, compte lié,
dernière synchronisation, permissions en langage clair.

### Portées Google Calendar

| Portée | Demandée | Usage |
|---|:-:|---|
| Lire les calendriers | ✓ | afficher les événements existants |
| Créer et modifier des événements | ✓ | pousser prestations, publications, échéances |
| Lire le profil | ✓ | nom et e-mail du compte |
| Supprimer des événements | ✗ | **jamais demandée** |

---

## Sécurité

**Toute vérification se fait côté serveur** : organisation, rôle, équipe, ressource, permission.
Un utilisateur ne doit jamais accéder à une ressource en changeant un ID dans l'URL.

**AuditLog** — conserver qui a créé, validé, modifié, supprimé, téléchargé, partagé, payé, signé.
`actorId` · `action` · `targetType` · `targetId` · `organizationId` · `metadata` · `ip` ·
`createdAt`

**RGPD** — consentements horodatés, export des données, fermeture de compte, demande de
suppression. Le retrait d'un droit à l'image entraîne le retrait des contenus publiés sous 72 h.

**Ne jamais exposer** : secrets d'API, tokens, données OS, informations financières internes,
données d'autres clients, logs serveur.

---

## Fonctions de permission

```ts
canAccess(module: ModuleKey): boolean
canCreate(resource: ResourceKey): boolean
hasEntitlement(feature: FeatureKey): boolean
hasQuota(quota: QuotaKey): boolean
```

`ModuleKey` — `dashboard` · `studio` · `newsroom` · `matchcenter` · `communication` ·
`validations` · `publications` · `presences` · `analytics` · `reports` · `mycm` ·
`visual_requests` · `services` · `sessions` · `camps` · `eventtimeline` · `live` · `content` ·
`teams` · `calendar` · `sponsors` · `contracts` · `billing` · `users` · `children` ·
`authorizations` · `documents` · `messages` · `accompagnement` · `support` · `settings`

`ResourceKey` — `visual_request` · `service_request` · `publication` · `newsroom_item` ·
`match_result` · `team` · `player` · `camp` · `sponsor` · `collection` · `user_invitation` ·
`document` · `calendar_event` · `support_ticket` · `message`

`QuotaKey` — `monthly_visuals` · `season_presences` · `storage` · `seats`

Résolution, dans l'ordre : type d'organisation → tier de l'offre → entitlements → rôle →
périmètre d'équipes → capacités explicites. **Le premier refus l'emporte.**

---

## Séquences serveur

| Déclencheur | Effets en chaîne |
|---|---|
| Inscription finalisée | organisation + propriétaire + abonnement Stripe + contrat généré + conseiller assigné + e-mail de vérification |
| Demande créée depuis le Studio | crédits **réservés** + référence attribuée + attribution studio dans OS + accusé de réception |
| Contenu livré | `MediaAsset` créé + statut `to_validate` + notification + e-mail |
| Contenu validé | statut `validated` + crédits **définitivement consommés** + téléchargement autorisé |
| Correction demandée | `revisionCount++` + retour au studio + notification |
| Demande refusée | réservation **libérée**, aucun débit |
| Remontée Newsroom transformée | crée une `Publication` ou une `VisualRequest`, lie les deux |
| Résultat de match saisi | crée une `VisualRequest` depuis le modèle Résultat |
| Devis accepté | contrat généré + facture d'acompte + lien Yousign |
| Acompte réglé | prestation `scheduled` + événement calendrier + opérateur notifié |
| Prestation livrée | livrables rattachés + collection créée + notification + e-mail |
| Publication programmée | envoi vers Metricool depuis OS, statut remonté dans Connect |
| Statistiques disponibles | `reach`, `engagement`, `views` remontés sur la `Publication` |
| Rapport mensuel généré | `Report` en `available` + notification + e-mail |
| Facture échue J+3 / J+8 / J+15 | relance ; à J+15 suspension |
| Paiement reçu | facture `paid` + reçu + abonnement réactivé si suspendu |
| Contrat à 60 jours de l'échéance | statut `to_renew` + avenant proposé + e-mail |
| Autorisation d'image retirée | blocage immédiat de publication + retrait des contenus publiés sous 72 h |
| Changement d'organisation | rechargement complet : navigation, permissions, données, modules |
| Changement de club d'un joueur | ancienne affiliation clôturée, nouvelle créée, historique conservé |
| 1er du mois | crédits remis au niveau de l'offre, solde précédent perdu |
