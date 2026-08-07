# Brief pour relecture juridique — Banque de contrats SportVision

But de ce document : donner à un avocat (ou un service de relecture juridique en ligne) tout le nécessaire pour une relecture ciblée, sans qu'il ait besoin d'accès au code ou à l'application. Contient le texte intégral actuellement utilisé, avec les points de risque déjà identifiés en amont pour prioriser son temps.

**Contexte :** SASU Elkana Group (nom commercial SportVision). Chaque contrat client est généré à partir d'un **Socle commun** (25 articles, identique pour tous les contrats) + des **Conditions particulières** spécifiques au type de prestation (9 types). Aucun client réel signé à ce jour — tout est en phase de test, donc encore modifiable sans casser un engagement existant.

---

## Qui a écrit quoi (important pour calibrer la relecture)

- **Socle commun (25 articles)** + **3 types de Conditions particulières** (Prestation ponctuelle, Full Communication, Abonnement Club+) : rédigés par le fondateur (Fouka).
- **6 types de Conditions particulières** (Coach/Académie, Événement, Joueur, Sponsoring, Contrat pilote, Autre) : rédigés par une IA (Claude, assistant Anthropic) le 2026-08-07, sur le même modèle que les 3 premiers, **jamais relus par un professionnel du droit**. Signalés ci-dessous avec ⚠️.

Aucun des deux groupes n'a été validé juridiquement à ce jour — mais le second est le moins éprouvé (jamais vu par un humain qualifié, alors que le premier a au moins été écrit par le fondateur lui-même qui connaît son métier).

---

## Points d'attention prioritaires (pour calibrer le temps de relecture)

1. **⚠️ SV-CL-006 (Joueur), le plus sensible** — porte sur un joueur mineur avec consentement du représentant légal, révocabilité du consentement, droit à l'image. C'est le contrat avec le plus d'enjeu si le texte est imprécis (droits de l'enfant, RGPD mineur, portée réelle d'une révocation de consentement sur des contenus déjà diffusés).
2. **Article 12 (droit de rétractation)** — le régime dépend du type de client (particulier = droit légal à respecter scrupuleusement ; professionnel = pas de droit légal automatique). Le texte renvoie aux Conditions particulières pour le régime applicable : à vérifier qu'aucun type de contrat visant des particuliers (ex. SV-CL-006 Joueur, si le client final est un particulier) ne contourne implicitement ce droit.
3. **⚠️ SV-CL-007 (Sponsoring)** — engagement financier et clause de dépendance à un autre contrat (celui du club). À vérifier que la clause de résiliation anticipée avec remboursement au prorata est juridiquement solide (pas juste une formule de bon sens).
4. **Article 24 (signature électronique)** — via Yousign. À confirmer que le niveau de signature utilisé (simple/avancée) est suffisant pour la valeur des contrats signés, notamment les engagements Club+/Full Communication/Sponsoring qui portent sur des montants récurrents.
5. **Article 25 (litiges, clause attributive de compétence)** — la clause attributive de compétence entre professionnels n'est valable que sous conditions légales précises (le texte le mentionne mais ne les détaille pas) — à vérifier que la pratique réelle de facturation respecte ces conditions.
6. **Article 20/21 (responsabilité, absence de garantie de performance)** — à valider que les limitations de responsabilité sont opposables telles que rédigées (certaines clauses limitatives sont encadrées strictement en droit français selon le type de client).

---

## Socle commun — texte intégral (25 articles)

*(Variables entre `{{...}}` substituées automatiquement par contrat réel — `CONFIDENTIALITY_DURATION` est un exemple, ex. « 3 ans ».)*

**Article 1 — Définitions**
« Contrat » désigne les Conditions particulières, le présent Socle, les annexes et tout avenant signé. « Prestations » désigne les services décrits dans le périmètre. « Livrables » désigne les fichiers, créations, rapports ou accès remis au Client. « Présence » désigne une intervention planifiée sur site selon la durée et le périmètre indiqués. « Plateforme » désigne SportVision OS, Club+ ou tout espace client mis à disposition. « Jour ouvré » désigne un jour normalement travaillé en France métropolitaine, hors samedi, dimanche et jour férié.

**Article 2 — Objet et périmètre**
SportVision fournit les Prestations définies dans les Conditions particulières et l'annexe de périmètre. Toute prestation non expressément incluse fait l'objet d'un devis, d'une commande complémentaire ou d'un avenant.

**Article 3 — Documents contractuels et hiérarchie**
Les documents contractuels sont, par ordre de priorité : les avenants les plus récents ; les Conditions particulières ; l'échéancier signé ; les annexes spécifiques ; le présent Socle. Les échanges commerciaux ne modifient pas le Contrat sauf accord écrit des personnes habilitées.

**Article 4 — Entrée en vigueur et conditions**
Le Contrat est conclu à la date de finalisation des signatures requises. Le démarrage opérationnel intervient à la date indiquée, sous réserve des conditions suivantes : signature complète, pièces et accès nécessaires, expiration ou traitement du délai applicable, et configuration du paiement lorsqu'elle est requise.

**Article 5 — Obligations de SportVision**
SportVision s'engage à exécuter les Prestations avec diligence, selon les usages professionnels et le périmètre convenu. Sauf engagement express de résultat, ses obligations sont des obligations de moyens.

**Article 6 — Obligations du Client**
Le Client fournit dans les délais les informations, validations, accès, autorisations, éléments de marque, plannings et contacts nécessaires. Tout retard ou blocage imputable au Client peut entraîner un report des délais sans engager la responsabilité de SportVision.

**Article 7 — Planning, disponibilité et validation**
Le planning est préparé conjointement. Les urgences, demandes hors calendrier ou modifications tardives sont traitées selon disponibilité et peuvent être facturées.

**Article 8 — Modifications et corrections**
Le nombre de corrections incluses est défini dans le périmètre. Les demandes supplémentaires font l'objet d'un devis ou consomment des crédits selon l'offre.

**Article 9 — Prix, taxes et facturation**
Les prix et la TVA figurent dans les Conditions particulières. Les factures sont émises selon l'échéancier. Le Client professionnel supporte les pénalités et indemnités légales mentionnées sur les factures et CGV.

**Article 10 — Paiement Stripe et échéancier**
Le moyen de paiement peut être enregistré sans débit immédiat. Les dates, montants et phases sont ceux de l'échéancier signé.

**Article 11 — Retard, impayé et suspension**
En cas d'impayé, SportVision adresse une notification et laisse au Client un délai de régularisation adapté. À défaut, SportVision peut suspendre tout ou partie des Prestations et accès, dans les limites du Contrat et de la loi.

**Article 12 — Droit de rétractation et délai commercial**
Le régime applicable est indiqué dans les Conditions particulières. Lorsque le Client bénéficie d'un droit légal, les informations, le formulaire et la fonctionnalité en ligne sont fournis.

**Article 13 — Exécution anticipée**
Le commencement avant la fin d'un délai de rétractation n'a lieu qu'après demande expresse du Client.

**Article 14 — Annulation, report et indisponibilité**
Les conditions d'annulation et de report figurent dans le contrat spécifique. Les parties recherchent prioritairement un report en cas de force majeure.

**Article 15 — Propriété intellectuelle**
Sauf cession expresse, SportVision conserve ses méthodes, modèles, outils, fichiers sources, rushes, bibliothèques, savoir-faire et éléments antérieurs. Après paiement complet, le Client reçoit les droits d'utilisation des Livrables définis dans l'annexe.

**Article 16 — Droit à l'image et autorisations**
Le Client informe les participants de la captation et obtient les autorisations nécessaires, notamment pour les mineurs, lorsque cette responsabilité lui incombe.

**Article 17 — Accès aux réseaux et sécurité**
Les accès aux comptes sont fournis par des moyens sécurisés. Le Client reste propriétaire de ses comptes. SportVision n'utilise les accès que pour le périmètre autorisé.

**Article 18 — Confidentialité**
Chaque partie protège les informations confidentielles reçues et ne les utilise que pour exécuter le Contrat. Cette obligation survit pendant {{CONFIDENTIALITY_DURATION}} après la fin du contrat.

**Article 19 — Données personnelles**
Chaque partie respecte la réglementation applicable. SportVision met en œuvre des mesures appropriées et notifie les incidents.

**Article 20 — Responsabilité et assurance**
Chaque partie répond de ses manquements prouvés. SportVision ne répond pas des conséquences d'informations erronées, d'une absence d'autorisation, d'un accès retiré, d'une décision de plateforme sociale, d'une panne externe ou d'un événement hors de son contrôle.

**Article 21 — Absence de garantie de performance marketing**
SportVision ne garantit ni un nombre de vues, ni un chiffre d'affaires, ni une croissance d'abonnés, ni un classement algorithmique.

**Article 22 — Force majeure**
Aucune partie n'est responsable d'un manquement causé par un événement de force majeure au sens du droit français.

**Article 23 — Durée, résiliation et sortie**
La durée, l'engagement et le préavis sont indiqués dans les Conditions particulières. En cas de manquement remédiable, la résiliation intervient après mise en demeure et délai raisonnable.

**Article 24 — Signature électronique et preuve**
Les parties acceptent la signature électronique via Yousign et reconnaissent la valeur des documents, horodatages, journaux et certificats.

**Article 25 — Notifications, droit applicable et litiges**
Le Contrat est soumis au droit français. Le consommateur est informé du médiateur compétent. Entre professionnels, une clause attributive de compétence ne peut être utilisée que dans les conditions légales.

---

## Conditions particulières — texte intégral par type

### SV-CL-001 — Prestation ponctuelle (fondateur)
Le prix est fixé à {{PRICE_EXCL_TAX}} € HT, soit {{PRICE_INCL_TAX}} € TTC. Le moyen de paiement est collecté via Stripe. Un acompte peut être demandé, le solde étant dû après livraison. Après paiement complet, le Client bénéficie de la licence d'utilisation définie en annexe. Toute utilisation publicitaire payante, revente, transmission à un diffuseur ou cession à un sponsor doit être expressément incluse ou fait l'objet d'un accord écrit séparé. En cas d'annulation par le Client, les frais déjà engagés et la mobilisation de l'équipe sont dus au prorata du préavis. Le prestataire exécute avec l'équipe et le matériel nécessaires, dans les conditions météo et de sécurité permettant l'intervention ; en cas d'impossibilité (météo, sécurité, indisponibilité du lieu), un report est proposé prioritairement à une annulation.

### SV-CL-002 — Full Communication (fondateur)
Le Client souscrit un accompagnement récurrent de communication incluant production terrain et gestion éditoriale, selon le périmètre mensuel défini (présences, volume de publications, réseaux gérés). Prix : {{PRICE_EXCL_TAX}} € HT/mois, soit {{PRICE_INCL_TAX}} € TTC/mois. Durée d'engagement : {{COMMITMENT_MONTHS}} mois. Préavis de résiliation : {{NOTICE_DAYS}} jours avant l'échéance. Le Client transmet ses priorités éditoriales avant le brief mensuel ; SportVision propose un calendrier soumis à validation. Les contenus urgents, résultats, reports et annonces sensibles suivent un circuit de validation accéléré. Le Client fournit des accès sécurisés aux comptes concernés ; SportVision n'utilise ces accès que pour les missions convenues et ne modifie jamais le propriétaire, les coordonnées de récupération ni les paramètres de facturation publicitaire des comptes sans autorisation expresse écrite.

### SV-CL-003 — Abonnement Club+ (fondateur)
L'abonnement porte sur l'offre logicielle Club+ (formule Club+ ou Club+ Performance selon le contrat signé), incluant un nombre d'utilisateurs, de crédits mensuels et de fonctionnalités définis dans l'annexe. Prix : {{PRICE_EXCL_TAX}} € HT/mois, soit {{PRICE_INCL_TAX}} € TTC/mois. Le Client est responsable des utilisateurs qu'il invite et de la confidentialité de leurs identifiants. Les crédits sont consommés selon le barème de la plateforme ; ils ne sont ni remboursables ni convertibles en argent sauf disposition légale impérative contraire. SportVision peut réaliser des opérations de maintenance et faire évoluer le service sans supprimer les caractéristiques essentielles de l'offre en cours. À la fin du contrat, les fonctionnalités premium sont désactivées et le Client dispose d'un délai raisonnable pour exporter les données disponibles, sous réserve des règles de conservation légale.

### ⚠️ SV-CL-004 — Coach / Académie (IA, non relu)
Le Client (coach indépendant ou académie) bénéficie d'un accompagnement de captation et de valorisation de contenus portant sur le suivi individuel des joueurs ou stagiaires inscrits dans sa structure (séances, stages, progression, bilans). Prix : {{PRICE_EXCL_TAX}} € HT/mois, soit {{PRICE_INCL_TAX}} € TTC/mois. Durée d'engagement : {{COMMITMENT_MONTHS}} mois. Préavis : {{NOTICE_DAYS}} jours avant l'échéance. Le Client communique le calendrier des séances et stages concernés avant chaque période de captation, dans la limite du volume convenu en annexe ; toute séance non communiquée dans ce délai n'est couverte que sous réserve de disponibilité et peut faire l'objet d'un ajustement tarifaire. Les contenus individuels (portraits, séquences de progression, bilans) peuvent être remis au Client pour diffusion à chaque joueur ou représentant légal concerné, selon les modalités définies en annexe ; le Client garantit avoir recueilli auprès de chaque joueur, ou de son représentant légal lorsqu'il est mineur, l'autorisation nécessaire à la captation et à la diffusion de ces contenus individuels, et s'engage à en justifier à première demande de SportVision. En cas de départ d'un joueur ou stagiaire en cours de contrat, seuls les contenus déjà produits à la date du départ restent dus, sans séance de rattrapage. L'usage des contenus par le Client à des fins de recrutement ou de communication de sa structure est inclus dans le présent contrat ; toute cession à un tiers extérieur à la structure (sponsor, média, agent) fait l'objet d'un accord écrit séparé.

### ⚠️ SV-CL-005 — Événement (IA, non relu)
Le prestataire assure la couverture de l'événement désigné en annexe (tournoi, stage, journée média, gala ou manifestation équivalente), à la date, au lieu et sur la durée qui y sont précisés, avec le nombre d'opérateurs et le matériel adaptés à l'ampleur de l'événement. Prix : {{PRICE_EXCL_TAX}} € HT, soit {{PRICE_INCL_TAX}} € TTC. Un acompte peut être demandé à la commande, le solde étant dû après livraison des contenus. Le Client communique le programme détaillé (horaires, lieux, intervenants, points de rendez-vous, contact sur place) au plus tard 15 jours avant la tenue de l'événement ; toute modification tardive du programme, tout changement de lieu ou toute extension de périmètre communiqués après ce délai peuvent entraîner un ajustement du prix, du nombre d'opérateurs mobilisés ou des délais de livraison. Le Client obtient, s'il y a lieu, les accréditations et autorisations d'accès nécessaires à l'équipe SportVision et informe l'organisateur ou le lieu de sa présence. Lorsque l'événement rassemble un public dont l'identité n'est pas connue à l'avance (spectateurs, tribunes, grand public), il appartient au Client ou à l'organisateur de l'informer de la captation par les moyens usuels (affichage, annonce) ; SportVision ne recueille pas individuellement le consentement de ce public. En cas d'annulation ou de report non imputable à SportVision, les frais déjà engagés et la mobilisation de l'équipe sont dus au prorata du délai restant avant la date prévue initialement. La livraison intervient dans le délai indiqué en annexe, pouvant être allongé au-delà du délai standard des prestations ponctuelles compte tenu du volume propre aux événements de plusieurs jours.

### ⚠️ SV-CL-006 — Joueur (IA, non relu) — LE PLUS SENSIBLE
Le présent contrat porte sur une prestation individuelle réalisée pour le Client en tant que joueur ou représentant légal d'un joueur mineur, sans rattachement à un club, une académie ou une structure tierce. Prix : {{PRICE_EXCL_TAX}} € HT, soit {{PRICE_INCL_TAX}} € TTC. Le moyen de paiement est collecté via Stripe. Les contenus produits (portraits, séquences de jeu, montages de mise en valeur) sont destinés à un usage personnel et à la mise en valeur sportive du joueur (réseaux personnels, book, dossier de recrutement) ; toute utilisation à des fins publicitaires ou commerciales pour le compte d'un tiers, ou toute cession à un agent, un club ou un sponsor, doit faire l'objet d'un accord écrit séparé et, le cas échéant, d'une rémunération distincte. Lorsque le joueur est mineur, le Client atteste être son représentant légal et consent expressément, en cette qualité, à la captation et à l'usage des contenus tels que définis au présent contrat ; ce consentement est révocable à tout moment par écrit, sans effet rétroactif sur les contenus déjà livrés et utilisés conformément au présent contrat avant la révocation. SportVision ne transmet ni ne discute des contenus ou de leur usage avec un agent sportif, un recruteur ou tout intermédiaire tiers sans mandat écrit exprès du Client ou de son représentant légal. Sauf mention contraire en annexe, les fichiers sources et rushes non retenus dans la livraison finale restent la propriété de SportVision et ne sont pas remis au Client.

### ⚠️ SV-CL-007 — Sponsoring (IA, non relu)
Le Client, en qualité de partenaire ou sponsor, bénéficie d'une valorisation de sa marque dans les contenus produits par SportVision pour le compte du club, de l'académie ou de la structure désignée en annexe, selon les engagements de visibilité qui y sont précisés (nombre de mentions, emplacements, supports concernés, durée d'exposition). Montant : {{PRICE_EXCL_TAX}} € HT, soit {{PRICE_INCL_TAX}} € TTC, facturé selon l'échéancier défini en annexe. Durée : {{COMMITMENT_MONTHS}} mois. SportVision rend compte périodiquement, selon la fréquence indiquée en annexe, de la visibilité effectivement livrée au regard des engagements convenus. Le Client fournit les éléments de marque nécessaires (logo, chartes graphiques, consignes d'usage) et garantit détenir les droits nécessaires sur ces éléments ; SportVision les utilise strictement dans le cadre des supports convenus et ne les cède à aucun tiers. Le présent contrat ne crée aucune exclusivité sectorielle au bénéfice du Client, sauf mention contraire expresse en annexe. Le présent contrat dépend de l'existence d'un contrat actif entre SportVision et le club, l'académie ou la structure désignée en annexe ; si ce contrat prend fin avant le terme du présent sponsoring, SportVision en informe le Client sans délai et les parties conviennent soit d'un aménagement des engagements de visibilité restants, soit d'une résiliation anticipée avec remboursement au prorata des engagements non honorés.

### ⚠️ SV-CL-008 — Contrat pilote (IA, non relu)
Le présent contrat constitue une phase pilote, destinée à permettre au Client de découvrir les services de SportVision avant tout engagement de plus longue durée. Il porte sur le périmètre, la durée et, le cas échéant, les conditions tarifaires réduites définis en annexe. Le contrat pilote ne se reconduit jamais tacitement : à son terme, il prend fin de plein droit, sauf signature d'un nouveau contrat entre les parties portant sur une offre standard. Pendant la durée du pilote, chaque partie peut mettre fin au contrat par écrit, moyennant un préavis de {{NOTICE_DAYS}} jours, sans pénalité autre que le paiement des prestations déjà réalisées. Les conditions accordées dans le cadre du pilote (tarifs, volumes, modalités) sont propres à cette phase et ne constituent pas un engagement de SportVision pour tout contrat ultérieur ; en particulier, l'absence de proposition de renouvellement à l'échéance ne constitue ni une rupture ni un manquement. Les contenus produits pendant le pilote appartiennent au Client dans les mêmes conditions que pour un contrat standard du même type ; SportVision peut toutefois conserver et exploiter, à titre interne, les enseignements et retours d'usage tirés du pilote pour améliorer ses offres, sans jamais divulguer d'information identifiant le Client sans son accord.

### ⚠️ SV-CL-009 — Autre (IA, non relu)
Ce contrat relève d'un type de prestation ne correspondant à aucune des catégories standard de SportVision. Les conditions spécifiques (périmètre, prix, durée, modalités de résiliation) sont intégralement définies dans l'annexe jointe au présent contrat, laquelle prévaut sur toute mention générale du socle commun en cas de contradiction. Avant toute signature, SportVision s'assure que cette annexe couvre l'ensemble des points nécessaires à la bonne exécution du contrat, notamment le prix, le périmètre exact des livrables, les délais, les droits d'usage accordés au Client et les modalités de fin de contrat ; à défaut de précision sur un point donné, les règles du socle commun s'appliquent. Ce type de contrat étant par nature hors des modèles habituels de SportVision, il est recommandé de le faire relire avant signature lorsque son montant, sa durée ou son périmètre sortent significativement de ce qui est pratiqué sur les autres types de contrats.

---

*Document généré le 2026-08-07 à partir du texte réellement utilisé dans `livrables/SportVision-TV/SportVision-OS-Full.html` (fonctions `contratSocleCommunHTML` et `contratConditionsParticulieresHTML`). Si le texte en production a changé depuis, ce document doit être régénéré avant envoi à l'avocat.*
