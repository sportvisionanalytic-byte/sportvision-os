# Modèle de données — SportVision Connect

Entités, champs, relations et énumérations telles que la maquette les suppose. Les noms sont des
propositions ; adaptez-les aux conventions du codebase.

---

## Vue d'ensemble des relations

```
User ──┬── Membership ──── Organization ──┬── Subscription ──── Plan
       │                        │         │
       │                        │         ├── Team ──── Player
       │                        │         ├── Sponsor
       │                        │         ├── Contract ──── Invoice
       │                        │         ├── VisualRequest
       │                        │         ├── Service ──┬── Deliverable
       │                        │         │             ├── Milestone
       │                        │         ├── MediaAsset ──── Collection
       │                        │         ├── Publication
       │                        │         ├── CalendarEvent
       │                        │         ├── Document
       │                        │         ├── Integration
       │                        │
       ├── Notification         ├── parentOrganization (joueur rattaché)

Comment ──── polymorphe sur Service, VisualRequest, MediaAsset,
             Publication, Contract, CalendarEvent, SupportTicket
```

---

## User

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `firstName` | string | |
| `lastName` | string | |
| `email` | string | unique, vérifié |
| `emailVerifiedAt` | datetime? | |
| `phone` | string? | |
| `avatarUrl` | string? | initiales en repli |
| `jobTitle` | string? | Responsable communication, Président, Dirigeant, Éducateur, Secrétaire |
| `locale` | enum | `fr`, `en` |
| `timezone` | string | IANA |
| `theme` | enum | `light`, `dark` |
| `mfaEnabled` | boolean | |
| `mfaBackupCodes` | string[] | hachés |
| `lastLoginAt` | datetime? | |
| `onboardingStep` | int | 0–10, permet la reprise |
| `onboardingCompletedAt` | datetime? | |
| `notificationPreferences` | json | voir plus bas |

---

## Organization

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `type` | enum | `club`, `academy`, `coach`, `player`, `one_off` |
| `name` | string | |
| `logoUrl` | string? | |
| `address` | string? | |
| `siret` | string? | |
| `legalName` | string? | |
| `brandColors` | string[] | hex, 2 à 5 valeurs |
| `instagramHandle` | string? | |
| `tiktokHandle` | string? | |
| `teamCount` | int? | club et académie uniquement |
| `memberCount` | int? | club et académie uniquement |
| `parentOrganizationId` | uuid? | **cas du joueur rattaché à un club abonné** |
| `accountManagerId` | uuid | interlocuteur SportVision (côté OS) |
| `createdAt` | datetime | |

### Le cas du joueur rattaché

Quand `type = player` et `parentOrganizationId` est renseigné :

- l'organisation joueur **n'a pas** de `Subscription` propre
- son accès est financé par l'abonnement du club parent
- la navigation retire Factures et Sponsors
- l'interface affiche le bandeau « Rattaché à \<club\> · CLUB ABONNÉ »
- le joueur ne voit que les `MediaAsset` où il apparaît (`MediaAssetPlayer`)
- le joueur valide ses propres contenus, mais ne peut pas les supprimer
- son `ImageRight` conditionne la diffusion de tout contenu où il figure

Un joueur peut aussi exister **sans** club parent : il est alors sur une offre propre et retrouve
Factures.

---

## Membership

Lie un `User` à une `Organization` avec un rôle et un périmètre.

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `userId` | uuid | |
| `organizationId` | uuid | |
| `role` | enum | voir ci-dessous |
| `teamScope` | uuid[] | vide = toutes les équipes |
| `status` | enum | `active`, `invited`, `disabled` |
| `invitedAt` | datetime? | |
| `invitationToken` | string? | valable 7 jours |
| `invitationExpiresAt` | datetime? | |
| `lastSeenAt` | datetime? | |

### `role`

`owner` · `admin` · `communication_manager` · `coach` · `board_member` · `secretary` ·
`viewer` · `sponsor` · `guest`

Règles :

- Une organisation a exactement un `owner`
- Le `owner` ne peut pas être désactivé sans transfert préalable
- `sponsor` et `guest` ne voient que ce qui leur est explicitement partagé
- `viewer` est en lecture seule sur tout son périmètre

---

## Plan et Subscription

### Plan — table de référence, source de vérité unique

| `code` | `name` | `tier` | `monthlyPrice` | `monthlyCredits` | `seasonPresences` | `maxUsers` |
|---|---|---|---|---|---|---|
| `essentiel` | Essentiel | 1 | 190 | 8 | 0 | 3 |
| `club_plus_start` | Club+ Start | 2 | 390 | 14 | 2 | 8 |
| `club_plus_performance` | Club+ Performance | 2 | 690 | 20 | 5 | `null` |
| `full_communication` | Full Communication | 3 | `null` *(sur devis)* | 40 | 12 | `null` |
| `club_access` | Accès via le club | 1 | 0 | 3 | 0 | 1 |
| `one_off` | Prestation unique | 1 | `null` *(à la commande)* | 1 | 1 | 2 |

`monthlyPrice = null` signifie « sur devis » ou « facturé à la commande » ; l'interface affiche le
libellé, pas un montant.
`maxUsers = null` signifie illimité.

**Aucun écran ne doit tester le `code` d'un plan.** Tout passe par le `tier` et les fonctions de
permission.

### Subscription

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | |
| `planCode` | string | référence `Plan` |
| `status` | enum | `active`, `past_due`, `suspended`, `cancelled` |
| `startsAt` | date | |
| `renewsAt` | date | |
| `commitmentMonths` | int | 12 par défaut |
| `noticeMonths` | int | 2 par défaut |
| `creditsRemaining` | int | remis à `monthlyCredits` le 1er du mois |
| `presencesUsed` | int | remis à 0 en début de saison |
| `storageUsedBytes` | bigint | |
| `storageQuotaBytes` | bigint | |
| `stripeSubscriptionId` | string? | |
| `stripeCustomerId` | string? | |

**Les crédits ne sont pas reportables.** Ils sont attribués le 1er de chaque mois et le solde non
consommé est perdu.

### Entitlement — options contractuelles

| Champ | Type | Notes |
|---|---|---|
| `subscriptionId` | uuid | |
| `feature` | string | ex. `club_plus_performance`, `delegated_community_management` |
| `enabled` | boolean | |

Permet d'activer une option pour un client sans changer son offre.

---

## VisualRequest

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `reference` | string | `VIS-AAAA-NNNN` |
| `organizationId` | uuid | |
| `requestedById` | uuid | |
| `assigneeId` | uuid? | côté SportVision OS |
| `visualType` | enum | voir ci-dessous |
| `teamId` | uuid? | |
| `eventId` | uuid? | |
| `publishDate` | date | |
| `format` | enum | `post_1_1`, `story_9_16`, `reel_9_16`, `banner_16_9` |
| `platform` | enum | `instagram`, `tiktok`, `facebook`, `website`, `print` |
| `bodyText` | text? | repris tel quel par le studio |
| `sponsorId` | uuid? | |
| `brandColors` | string[]? | |
| `referenceUrl` | string? | |
| `urgency` | enum | `standard` (1 crédit, 5 j), `priority` (2, 48 h), `express` (3, 24 h) |
| `creditsCost` | int | dérivé de `urgency` |
| `status` | enum | voir ci-dessous |
| `revisionCount` | int | 2 incluses, la 3ᵉ est facturée |
| `dueAt` | datetime | calculé à la création |
| `attachments` | Attachment[] | |

`visualType` : `prematch_poster` · `result` · `lineup` · `player_of_match` · `birthday` ·
`recruitment` · `camp` · `tournament` · `sponsor` · `event` · `info_flyer` · `other`

`status` : `draft` → `to_produce` → `in_creation` → `to_validate` → `revision_requested` →
`delivered`

---

## Service — prestation

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `reference` | string | `PRE-AAAA-NNNN` |
| `organizationId` | uuid | |
| `serviceType` | enum | voir ci-dessous |
| `date` | date | |
| `startTime` | time | |
| `endTime` | time | |
| `address` | string | |
| `teamId` | uuid? | |
| `level` | string? | |
| `eventId` | uuid? | |
| `onSiteContactName` | string | |
| `onSiteContactPhone` | string | |
| `specificNeeds` | text? | |
| `brief` | text? | 4 sections : objectif, contraintes, références, à éviter |
| `options` | ServiceOption[] | |
| `basePrice` | decimal | |
| `optionsTotal` | decimal | |
| `discountAmount` | decimal | remise liée à l'offre |
| `travelFees` | decimal | estimé depuis `address` |
| `totalPrice` | decimal | TTC |
| `depositAmount` | decimal | 30 % du total |
| `depositPaidAt` | datetime? | |
| `balancePaidAt` | datetime? | |
| `status` | enum | voir ci-dessous |
| `progressPercent` | int | 0–100 |
| `operatorIds` | uuid[] | côté SportVision |
| `deliverables` | Deliverable[] | |
| `milestones` | Milestone[] | |

`serviceType` : `photo` · `video` · `photo_video` · `drone` · `veo` · `shooting` · `media_day` ·
`tournament` · `camp` · `training` · `interview` · `other`

`status` : `received` → `to_validate` → `quote_sent` → `contract_to_sign` → `payment_pending` →
`scheduled` → `in_progress` → `post_production` → `delivery_to_validate` → `delivered` →
`completed` · `cancelled`

### ServiceOption

| `code` | Libellé | Prix |
|---|---|---|
| `drone` | Prise de vue drone | 250 € |
| `reel` | Reel réseaux sociaux | 180 € |
| `highlight` | Highlight 3 minutes | 220 € |
| `express_delivery` | Livraison express 48 h | 150 € |
| `extra_photographer` | Photographe supplémentaire | 320 € |
| `interview` | Interview joueur | 140 € |
| `live_stories` | Stories en direct | 110 € |

### Deliverable

| Champ | Type | Notes |
|---|---|---|
| `serviceId` | uuid | |
| `label` | string | |
| `quantity` | int? | |
| `status` | enum | `planned`, `option_selected`, `in_production`, `delivered` |
| `mediaAssetIds` | uuid[] | rempli à la livraison |

### Milestone

| Champ | Type | Notes |
|---|---|---|
| `serviceId` | uuid | |
| `label` | string | |
| `dueDate` | date | |
| `completedAt` | datetime? | |
| `order` | int | |

Jalons type : demande reçue, devis accepté, acompte réglé, confirmation des horaires, tournage,
livraison des contenus.

---

## MediaAsset

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | |
| `name` | string | |
| `kind` | enum | `photo`, `video`, `reel`, `highlight`, `raw_footage`, `poster`, `flyer`, `logo`, `document`, `sponsor_asset` |
| `mimeType` | string | |
| `fileUrl` | string | |
| `thumbnailUrl` | string | |
| `sizeBytes` | bigint | |
| `aspectRatio` | string | `1:1`, `9:16`, `16:9`, `A5` |
| `durationSeconds` | int? | vidéos |
| `serviceId` | uuid? | prestation d'origine |
| `visualRequestId` | uuid? | demande d'origine |
| `eventId` | uuid? | |
| `teamId` | uuid? | |
| `authorId` | uuid? | photographe ou studio |
| `usageRights` | string | ex. « Usage club illimité » |
| `availableUntil` | date? | |
| `version` | int | 1, 2, 3… |
| `isFinalVersion` | boolean | |
| `previousVersionId` | uuid? | |
| `status` | enum | `to_validate`, `validated`, `revision_requested`, `raw_authorised` |
| `tags` | string[] | |
| `isFavorite` | boolean | |

### MediaAssetPlayer — table de liaison

| Champ | Type | Notes |
|---|---|---|
| `mediaAssetId` | uuid | |
| `playerId` | uuid | |

**C'est cette table qui alimente la vue filtrée du joueur.** Un joueur ne voit que les
`MediaAsset` où il est référencé.

### Collection

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | |
| `name` | string | |
| `kind` | enum | `match`, `tournament`, `season`, `media_day`, `team`, `player`, `sponsor`, `campaign`, `project` |
| `coverAssetId` | uuid? | |
| `itemCount` | int | dénormalisé |
| `date` | date? | |
| `teamId` | uuid? | |
| `ownerId` | uuid | |
| `visibility` | enum | `organization`, `team`, `link_only`, `private` |
| `shareToken` | string? | |
| `shareExpiresAt` | datetime? | **30 jours** par défaut |

---

## Publication

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | |
| `title` | string | |
| `platform` | enum | `instagram`, `tiktok`, `facebook`, `youtube` |
| `format` | enum | `post`, `story`, `reel` |
| `scheduledAt` | datetime | |
| `bodyText` | text? | |
| `hashtags` | string[] | |
| `mediaAssetIds` | uuid[] | |
| `campaignId` | uuid? | |
| `sponsorId` | uuid? | alimente la jauge de visibilité du sponsor |
| `teamId` | uuid? | |
| `ownerId` | uuid | |
| `status` | enum | voir ci-dessous |
| `objective` | string? | |
| `performanceNote` | string? | |

`status` : `idea` → `to_produce` → `in_creation` → `to_validate` → `revision_requested` →
`validated` → `scheduled` → `published` · `cancelled`

Le glisser-déposer dans le planning modifie `scheduledAt` uniquement. Le statut ne change pas.

---

## Team et Player

### Team

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | |
| `name` | string | |
| `category` | string | ex. « U18 · National » |
| `headCoachId` | uuid? | |
| `assistantCoachIds` | uuid[] | |
| `playerCount` | int | dénormalisé |
| `trainingSlots` | string? | ex. « Lundi et mercredi · 18h30 » |
| `venue` | string? | |
| `season` | string | ex. « 2026 / 2027 » |

### Player

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | |
| `teamId` | uuid | |
| `userId` | uuid? | si le joueur a un espace Connect |
| `playerOrganizationId` | uuid? | son organisation joueur, si elle existe |
| `firstName` | string | |
| `lastName` | string | |
| `shirtNumber` | string? | |
| `position` | string? | |
| `photoAssetId` | uuid? | |
| `licenseStatus` | enum | `valid`, `pending`, `expired` |
| `medicalCertificateAt` | date? | |
| `contentCount` | int | dénormalisé |

### ImageRight — autorisation d'image

| Champ | Type | Notes |
|---|---|---|
| `playerId` | uuid | |
| `status` | enum | `signed`, `pending`, `refused`, `withdrawn` |
| `signedByName` | string? | représentant légal si mineur |
| `signedAt` | datetime? | |
| `documentId` | uuid? | |
| `restrictions` | string[] | |
| `validUntil` | date? | |

**Règle bloquante** — si `status ≠ signed`, aucun `MediaAsset` lié à ce joueur ne peut être
publié. L'interface l'indique explicitement sur la fiche joueur et sur la fiche média.

Restrictions type : diffusion limitée aux comptes officiels du club, usage commercial soumis à
accord du représentant légal, retrait possible à tout moment sur demande écrite.

---

## Sponsor

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | |
| `name` | string | |
| `logoAssetId` | uuid? | |
| `level` | enum | `main_partner`, `official_partner`, `equipment_supplier`, `support_partner` |
| `startsAt` | date | |
| `endsAt` | date | |
| `annualAmount` | decimal | |
| `paymentSchedule` | string | ex. « Deux échéances semestrielles » |
| `status` | enum | `active`, `to_renew`, `expired` |
| `contractId` | uuid? | |
| `signatories` | string[] | |
| `renewalTerms` | string? | |

### SponsorDeliverable

| Champ | Type | Notes |
|---|---|---|
| `sponsorId` | uuid | |
| `label` | string | |
| `period` | string | ex. « Toute la saison », « 1 par mois » |
| `plannedCount` | int | |
| `deliveredCount` | int | |
| `status` | enum | `planned`, `in_progress`, `completed` |

La jauge de visibilité affichée = `deliveredCount / plannedCount` agrégé sur tous les livrables.

---

## Contract

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | |
| `name` | string | dérivé de l'offre, ex. « Abonnement Club+ Performance 2026-2027 » |
| `kind` | enum | `subscription`, `one_off_service`, `sponsorship`, `academy_agreement` |
| `planCode` | string? | si `kind = subscription` |
| `startsAt` | date | |
| `endsAt` | date | |
| `status` | enum | voir ci-dessous |
| `monthlyAmount` | decimal? | |
| `commitmentMonths` | int | |
| `noticeMonths` | int | |
| `signatories` | string[] | |
| `signatureProvider` | enum | `yousign` |
| `signatureUrl` | string? | expire au bout de **8 jours** |
| `viewedAt` | datetime? | fait passer `sent` → `viewed` |
| `signedAt` | datetime? | |
| `documentId` | uuid? | PDF signé |
| `annexIds` | uuid[] | |
| `amendmentIds` | uuid[] | |
| `keyTerms` | string[] | affichés en « À retenir » |

`status` : `draft` → `sent` → `viewed` → `signed` → `active` → `to_renew` → `terminated` ·
`expired`

Reconduction tacite pour 12 mois sauf préavis de `noticeMonths` mois.
Le statut passe à `to_renew` automatiquement 2 mois avant `endsAt`.

### ContractSchedule — échéancier

| Champ | Type | Notes |
|---|---|---|
| `contractId` | uuid | |
| `dueDate` | date | |
| `label` | string | |
| `amount` | decimal? | |
| `kind` | enum | `installment`, `notice_window`, `contract_end` |
| `status` | enum | `upcoming`, `due`, `paid` |

---

## Invoice

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `number` | string | `SV-AAAA-NNNN` |
| `organizationId` | uuid | |
| `contractId` | uuid? | |
| `serviceId` | uuid? | |
| `issueDate` | date | |
| `dueDate` | date | |
| `subject` | string | |
| `lines` | InvoiceLine[] | |
| `subtotalExclVat` | decimal | |
| `vatRate` | decimal | 20 % |
| `vatAmount` | decimal | |
| `depositApplied` | decimal | |
| `totalInclVat` | decimal | |
| `status` | enum | voir ci-dessous |
| `paymentMethod` | string? | ex. « Prélèvement Stripe · carte •••• 4242 » |
| `stripeInvoiceId` | string? | |
| `paidAt` | datetime? | |
| `pdfUrl` | string? | |
| `receiptUrl` | string? | |
| `remindersSentAt` | datetime[] | à 3, 8 et 15 jours de retard |

`status` : `draft` → `to_pay` → `paid` · `overdue` · `cancelled` · `refunded`

### InvoiceLine

| Champ | Type |
|---|---|
| `label` | string |
| `quantity` | int? |
| `unitPriceExclVat` | decimal? |
| `totalExclVat` | decimal |

### Règle de suspension

| Jours de retard | Effet |
|---|---|
| 3 | Première relance par e-mail, badge « en retard » |
| 8 | Deuxième relance |
| 15 | Troisième relance + `Subscription.status = suspended` |
| > 15 | Création de nouvelles demandes bloquée ; contenus déjà livrés toujours accessibles |
| Paiement | Accès rétabli immédiatement, `status = active` |

**Ne jamais stocker ni afficher un numéro de carte complet.** Uniquement les 4 derniers chiffres et
la date d'expiration, servis par Stripe.

---

## CalendarEvent

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | |
| `kind` | enum | `match`, `training`, `service`, `shooting`, `meeting`, `publication`, `contract_deadline`, `invoice_deadline`, `camp`, `tournament` |
| `title` | string | |
| `startsAt` | datetime | |
| `endsAt` | datetime? | |
| `allDay` | boolean | |
| `location` | string? | |
| `teamId` | uuid? | |
| `sourceType` | string? | entité d'origine |
| `sourceId` | uuid? | |
| `externalCalendarId` | string? | Google |
| `syncDirection` | enum | `connect_to_google`, `google_to_connect`, `both` |

Le calendrier central est une **vue agrégée** : les prestations, publications et échéances y
apparaissent sans être dupliquées. Seuls les événements créés directement dans Connect sont des
lignes propres.

---

## Document

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | |
| `name` | string | |
| `kind` | enum | `image_right`, `contract`, `brand_guidelines`, `logo_pack`, `insurance`, `medical`, `roster`, `other` |
| `mimeType` | string | |
| `fileUrl` | string | |
| `sizeBytes` | bigint | |
| `uploadedById` | uuid | |
| `teamId` | uuid? | |
| `status` | enum | `up_to_date`, `incomplete`, `to_sign`, `to_renew`, `expired` |
| `completionRatio` | string? | ex. « 20 sur 22 signées » |
| `expiresAt` | date? | |

---

## Notification

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `userId` | uuid | |
| `organizationId` | uuid | |
| `category` | enum | `contracts`, `payments`, `content`, `services`, `requests`, `users`, `calendar`, `system` |
| `title` | string | |
| `body` | string | |
| `targetType` | string | entité concernée |
| `targetId` | uuid | |
| `isPinned` | boolean | affiche le badge « IMPORTANT » |
| `isCritical` | boolean | **ignore les préférences utilisateur** |
| `readAt` | datetime? | |
| `emailSentAt` | datetime? | |
| `createdAt` | datetime | |

### notificationPreferences — porté par `User`

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

`frequency` : `immediate` · `daily_digest` · `weekly_digest` · `monthly` · `never`

Les notifications `isCritical` — impayé, suspension, contrat expiré — sont envoyées quelles que
soient les préférences et les heures calmes.

Un seul rappel par échéance et par semaine, toutes catégories confondues.

---

## Comment — échanges contextuels

Il n'y a **pas de messagerie générale**. Tous les échanges sont attachés à un objet.

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `authorId` | uuid | |
| `targetType` | enum | `service`, `visual_request`, `media_asset`, `publication`, `contract`, `calendar_event`, `support_ticket` |
| `targetId` | uuid | |
| `body` | text | |
| `mentionedUserIds` | uuid[] | déclenche une notification |
| `attachmentIds` | uuid[] | |
| `videoTimestampSeconds` | int? | commentaire horodaté sur une vidéo |
| `parentCommentId` | uuid? | réponse |
| `resolvedAt` | datetime? | |
| `resolvedById` | uuid? | |
| `createdAt` | datetime | |

---

## SupportTicket

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `reference` | string | `TCK-AAAA-NNNN` |
| `organizationId` | uuid | |
| `createdById` | uuid | |
| `category` | string | |
| `module` | string? | module concerné |
| `priority` | enum | `low`, `normal`, `high`, `urgent` |
| `description` | text | |
| `attachmentIds` | uuid[] | |
| `status` | enum | `open`, `in_progress`, `waiting_customer`, `resolved`, `closed` |
| `assigneeId` | uuid? | côté SportVision |

---

## Integration

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `organizationId` | uuid | |
| `provider` | enum | `google_calendar`, `instagram`, `tiktok`, `meta_business`, `whatsapp`, `stripe` |
| `status` | enum | `connected`, `disconnected`, `error`, `expired` |
| `accountLabel` | string? | ex. `@fcfontainebleau` |
| `scopes` | string[] | autorisations accordées |
| `accessToken` | string | chiffré au repos |
| `refreshToken` | string? | chiffré au repos |
| `expiresAt` | datetime? | |
| `lastSyncedAt` | datetime? | |
| `syncLog` | json[] | horodatage + résumé |

### Portée Google Calendar

| Portée | Demandée | Usage |
|---|:-:|---|
| Lire les calendriers | ✓ | afficher les événements existants |
| Créer et modifier des événements | ✓ | pousser prestations, publications, échéances |
| Lire le profil | ✓ | nom et e-mail du compte connecté |
| Supprimer des événements | ✗ | **jamais demandée** — Connect ne supprime pas |

Correspondances de synchronisation :

| Source Connect | Destination Google | Sens |
|---|---|---|
| Prestations SportVision | Calendrier « SportVision » | Connect → Google |
| Publications programmées | Calendrier « SportVision » | Connect → Google |
| Échéances de contrat et facture | Calendrier « SportVision » | Connect → Google |
| Matchs et entraînements du club | Calendrier principal | Google → Connect |

---

## Fonctions de permission — signatures attendues

```ts
/** Le module est-il visible pour l'organisation active ? */
canAccess(module: ModuleKey): boolean

/** Le rôle de l'utilisateur autorise-t-il la création de cette ressource ? */
canCreate(resource: ResourceKey): boolean

/** Le contrat inclut-il cette option ? */
hasEntitlement(feature: FeatureKey): boolean

/** Reste-t-il du quota ce mois-ci ? */
hasQuota(quota: QuotaKey): boolean
```

`ModuleKey` : `dashboard` · `communication` · `visual_requests` · `services` · `content` ·
`teams` · `calendar` · `sponsors` · `contracts` · `billing` · `users` · `documents` · `support` ·
`settings`

`ResourceKey` : `visual_request` · `service_request` · `publication` · `team` · `player` ·
`sponsor` · `collection` · `user_invitation` · `document` · `calendar_event` · `support_ticket`

`QuotaKey` : `monthly_visuals` · `season_presences` · `storage` · `seats`

Chaque fonction résout dans cet ordre : type d'organisation → tier de l'offre → entitlements →
rôle → périmètre d'équipes. Le premier refus l'emporte.

---

## Séquences serveur à prévoir

| Déclencheur | Effets en chaîne |
|---|---|
| Inscription finalisée | organisation + utilisateur propriétaire + abonnement Stripe + contrat généré + conseiller assigné + e-mail de vérification |
| Demande de visuel envoyée | décompte des crédits + référence attribuée + attribution studio dans OS + accusé de réception |
| Contenu livré par le studio | `MediaAsset` créé + statut `to_validate` + notification + e-mail |
| Contenu validé | statut `validated` + téléchargement autorisé + publication programmable |
| Correction demandée | `revisionCount++` + retour au studio + notification studio |
| Devis accepté | contrat généré + facture d'acompte émise + lien Yousign |
| Acompte réglé | prestation `scheduled` + événement calendrier + opérateur notifié |
| Prestation livrée | livrables rattachés + collection créée + notification + e-mail |
| Facture échue J+3 / J+8 / J+15 | relance e-mail ; à J+15 suspension de la création de demandes |
| Paiement reçu | facture `paid` + reçu généré + abonnement réactivé si suspendu |
| Contrat à 60 jours de l'échéance | statut `to_renew` + avenant proposé + e-mail |
| Autorisation d'image manquante | blocage de publication de tout contenu lié + rappel au représentant légal |
| Changement d'organisation | rechargement complet : navigation, permissions, données, modules |
| 1er du mois | crédits remis au niveau de l'offre, solde précédent perdu |
