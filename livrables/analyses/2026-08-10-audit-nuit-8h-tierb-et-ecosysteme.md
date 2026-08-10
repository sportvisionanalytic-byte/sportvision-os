# Nuit du 09→10/08 — Tier B Connect (Phases 1-4) + audit large écosystème complet

Session autonome de 8h, sans validation intermédiaire (mandat donné le 09/08 au soir). Tout ce qui suit a été vérifié par lecture directe du code et du schéma réel — jamais une supposition. Rien n'a été exécuté en base par mes soins : toutes les migrations listées sont préparées, à exécuter par toi dans le SQL Editor Supabase.

---

## 1. Ce qui a été construit et poussé sur `main` cette nuit

### Tier B Phase 1 — Facturation/Contrats/Documents club (zéro nouvelle migration)
Un club voit maintenant ses vrais devis/factures/contrats sur `/billing`, `/contracts`, `/documents` (lecture seule), via les vues déjà étendues aux clubs par `migration-clubplus-v33` (exécutée le mois dernier). Persona "Full Communication" désormais résolu depuis un vrai contrat actif (`contrats.type_contrat='full_communication'`), pas un champ inventé.

### Tier B Phase 2 — Messages/Communication/Publications/Validations
Branchés sur `messages_client` et `contenus` (planning éditorial réel). **Migration `migration-clubplus-v34-club-messages-contenus-access.sql`** requise pour qu'un club (pas seulement l'Espace Projet) y ait accès.

### Tier B Phase 3 — Notifications in-app
Nouvelle table `member_notifications`, générique à tout type de compte, alimentée par 2 triggers (facture en retard/payée, contenu à valider). **Migration `migration-connect-v16-member-notifications.sql`.** Cloche de la barre supérieure (jusqu'ici inerte) branchée dessus ; "Nouvelle demande"/Aide/Profil de la même barre également câblés.

### Tier B Phase 4 — Présences terrain (club uniquement)
Nouvelle table `club_presences`. **Migration `migration-connect-v17-club-presences.sql`.** Séances (coach)/Stages (académie) volontairement **pas construits** : ces types n'ont aujourd'hui aucun lien vers une fiche `clients` réelle (voir §3.2) — bâtir dessus aurait été une fondation fictive.

### 4 corrections critiques trouvées par l'audit de cette même nuit et déjà corrigées dans le code
Détail complet en §3. Résumé : `portail_client_id` jamais renseigné en self-service (invalidait tout Phase 1-2 pour la plupart des clubs) ; un bug FK dans mon propre code d'hier soir (`client_valider_contenu`, `sendClientMessage`) ; une faille de sécurité dans `portal-onboarding` (rapprochement par e-mail sans vérifier la confirmation) ; `club_members → memberships` qui ne synchronisait que la création, pas la suspension/le changement de rôle.

**Migrations en attente, dans l'ordre recommandé** (aucune exécutée) :
1. `migration-connect-v18-club-members-sync-update-delete.sql` — corrige un vrai trou de sécurité en production (suspension inopérante), à faire en premier.
2. `migration-clubplus-v34-club-messages-contenus-access.sql` — corrigée cette nuit (bug FK), débloque Messages/Communication/Publications/Validations pour les clubs.
3. `migration-connect-v16-member-notifications.sql`
4. `migration-connect-v17-club-presences.sql`

**Edge functions modifiées, à redéployer manuellement** (Supabase Dashboard → Edge Functions → coller → Deploy) :
- `clubplus-onboarding` (fix critique #1)
- `portal-onboarding` (fix sécurité #3)

---

## 2. Ce qui reste non construit (décisions produit, pas des oublis techniques)

- **Analytics/Reports** : aucune donnée réelle de portée/engagement n'existe nulle part dans le schéma. Intégration Metricool réelle (gros chantier à part) ou saisie manuelle CM ou statu quo verrouillé — à trancher par toi.
- **Séances (coach) / Stages (académie)** : bloqués tant qu'aucun mécanisme de rapprochement vers une fiche `clients` équivalent à `clubplus-onboarding` n'existe pour ces deux types.
- **Eventtimeline, Live, Accompagnement, MyCM** : évalués, nécessitent chacun un design à part (pas de brique réutilisable directe).

---

## 3. Les 4 corrections critiques de cette nuit (détail)

### 3.1 — `portail_client_id` jamais renseigné en self-service — LE plus grave
**Trouvé indépendamment par 2 agents d'audit.** `clubplus-onboarding` ne reliait un club à une fiche `clients` Portail QUE si une fiche existait déjà avec le même e-mail — jamais le cas pour un club acquis en self-service depuis la vitrine (par définition, il n'a jamais eu de fiche avant). Aucune UI dans l'OS ne permet de faire ce lien à la main (vérifié : aucun `PATCH clubs` sur ce champ nulle part dans `SportVision-OS-Full.html`). Un membre du staff aurait dû éditer la ligne directement dans le dashboard Supabase.

**Conséquence réelle mesurée avant correction** : `/billing`, `/contracts`, `/documents`, `/messages`, `/communication`, `/publications`, `/validations` — les 7 écrans construits Phase 1-2 — affichaient tous "pas encore relié" pour la quasi-totalité des clubs. Le club lui-même était invisible dans l'OS (n'apparaît dans aucune liste, aucun KPI, tous basés sur `clients`).

**Corrigé** : `clubplus-onboarding` crée maintenant une fiche `clients` (statut `prospect`, type `club`) quand aucune correspondance n'existe, au lieu de laisser le lien vide. Aucun risque d'hériter des données de quelqu'un d'autre (rien n'existait avant). **Nécessite un redéploiement manuel de l'edge function.**

### 3.2 — Bug FK dans mon propre code d'hier soir
`messages_client.auteur_client_id` référence `client_users(id)`. Un membre de club (l'accès étendu que j'ai construit hier soir) n'a pas de ligne `client_users` — poser `auth.uid()` comme `auteur_client_id` viole la contrainte et fait échouer toute la transaction. Cassait silencieusement la RPC `client_valider_contenu` (donc `/validations`) et l'envoi de message (`/messages`) pour tout membre autre que le fondateur du compte. **Corrigé** aux deux endroits : `auteur_client_id` devient `null` (colonne déjà nullable) quand l'appelant n'a pas de ligne `client_users`.

### 3.3 — Faille de sécurité dans `portal-onboarding`
Rapprochement par e-mail sans vérifier `email_confirmed_at` — en miroir exact d'une faille déjà corrigée dans `clubplus-onboarding` le 06/08 mais jamais portée sur cette fonction jumelle. Si la confirmation d'e-mail était un jour désactivée sur le projet, n'importe qui pouvait s'inscrire avec l'adresse d'un client existant et hériter de ses devis/factures/contrats/messages. **Corrigé, nécessite un redéploiement manuel.**

### 3.4 — `club_members → memberships` : suspension inopérante en production
Le trigger de synchronisation (migration v10) ne se déclenchait qu'à la création. Toute la logique d'accès Connect réelle lit `memberships`, jamais `club_members` directement. **Suspendre un membre dans l'app vanilla (déjà en production) ne lui retire donc aucun accès réel** — il garde son espace club dans son sélecteur et tous les modules gardés par `is_org_member()`. Même problème pour un changement de rôle. **Migration v18 préparée** (trigger étendu à UPDATE/DELETE), avec une requête de rattrapage pour les lignes déjà désynchronisées.

---

## 4. Audit large — 5 zones explorées cette nuit, non corrigées (documentation seule)

Vu le volume (des dizaines de bugs vérifiés, dont plusieurs touchent la facturation/les contrats/la signature électronique dans un fichier de 23 000 lignes que je ne peux pas tester visuellement), je n'ai **pas** tenté de corrections à l'aveugle sur l'OS au-delà des 4 points ci-dessus. Voici la synthèse priorisée de chaque zone — le détail complet (ligne exacte, preuve) est dans les rapports d'agents de cette conversation, à redemander si besoin de la retrouver précisément.

### 4.1 — OS : Secrétariat / Réservations / Prestations
- **Haute** : 7 colonnes remplies par le tunnel de réservation public (offre, options, mode de paiement choisi, distance, frais...) ont **zéro lecteur** dans tout l'OS — la secrétaire qualifie une demande sans savoir ce qui a été réellement commandé.
- **Haute** : toutes les demandes vitrine s'affichent comme type "match" (colonne jamais envoyée par l'edge function).
- **Haute** : le statut "validation production requise" est du code mort, jamais atteint, contourné par le flux standard.
- **Haute** : aucune machine à états sur `statut_prestation` — n'importe quel statut vers n'importe quel autre en un clic, y compris "clôturée" directement depuis "demande reçue".
- **Haute** : un collaborateur affecté à une prestation peut modifier son statut/lieu/horaires via un appel API direct (policy RLS `for all`, pas de restriction côté serveur au-delà du JS).
- **Haute** : aucune détection de conflit de planning entre opérateurs (existe pour le matériel, existe même côté edge function `check-disponibilite` — jamais appelée depuis l'OS).
- **Haute** : le pipeline commercial secrétariat ne boucle pas — aucun code n'écrit `prestations.statut='devis_envoyé'`, la condition d'avancement automatique est donc morte, une prestation reste bloquée même devis accepté.
- **Haute** : l'export "Relances" utilise une valeur d'enum inexistante (`acompte_demandé`) → requête invalide → CSV vide téléchargé avec un message de succès.

### 4.2 — OS : Community Manager / Contenus
- **Haute** : le `WITH CHECK` de la policy d'édition des contenus interdit l'édition collaborative que le commentaire de la même migration décrit comme acquise — un CM ne peut pas faire avancer le contenu d'un collègue de portefeuille (erreur RLS brute).
- **Haute** : `sauvegarderContenu` peut réinitialiser `client_id` à `null` silencieusement dès que le client courant n'est pas dans la liste chargée (portefeuille > 200 clients, palier mal géré, ou juste une erreur réseau) — perte de données silencieuse, le contenu disparaît de l'espace du client.
- **Haute (latente)** : le même bug FK que 3.2, dans la version originale de la migration v34 que j'ai déjà corrigée cette nuit avant toute exécution — confirmé indépendamment par cet agent, donc déjà traité.
- **Moyenne-haute** : un CM peut supprimer le message où le client demande une correction (policy `for all` sans restriction).
- **Moyenne-haute** : aucune contrainte de transition de statut côté base pour les contenus non plus.

### 4.3 — OS : Facturation / Devis / Contrats (staff)
La zone la plus lourde, à traiter avec un vrai regard juridique/comptable avant toute correction :
- **Critique** : le PDF réellement envoyé en signature électronique (Youtrust) pour un contrat ne contient **aucune des 25 clauses juridiques** ni les conditions particulières — un client signe un document d'une page (type, montant, dates), pas le contrat que le staff a prévisualisé.
- **Critique** : le champ où le staff saisit le périmètre/les prestations incluses (`description`) n'existe pas dans la table `contrats` — jamais imprimé nulle part.
- **Critique** : `factures` n'est jamais mise à jour par l'OS pour un paiement non-Stripe (virement, chèque, espèces) — seul `prestations.statut_financier` l'est. Conséquence : export FEC et calcul de TVA collectée omettent ces paiements, et les relances automatiques (cron) relancent des clients déjà payés par un autre moyen que Stripe.
- **Critique** : imprimer un PDF de facture (bouton qui ressemble à une consultation) **émet une vraie facture numérotée** en base — un simple clic génère un document comptable irréversible.
- **Élevée** : montant du contrat imprimé faux d'environ -16,7 % (le code traite `montant_mensuel` comme TTC alors qu'il est parfois saisi HT selon l'écran).
- **Élevée** : le statut "Actif" proposé dans 3 écrans de contrat est systématiquement rejeté par un trigger de sécurité existant (contrat ne peut passer actif sans signature confirmée) — mais un bouton "✓ Signé" du même écran contourne ce garde-fou en un clic, sans qu'aucun e-mail de signature n'ait été envoyé.
- **Élevée** : l'écran Impayés de la Compta ignore complètement la table `factures`, calcule le retard sur une autre base (date de prestation −30j) — deux définitions concurrentes du retard.
- **Élevée** : le ledger des paiements Stripe (`paiements`) n'est lu nulle part dans l'OS — aucun écran des encaissements réels.
- **Élevée** : un avoir peut être créé sans plafond, sans vérification que le client correspond à la prestation, sans trace dans le journal d'audit financier.

### 4.4 — App vanilla Connect (déjà en PRODUCTION, utilisée aujourd'hui par de vrais clubs)
La zone la plus urgente à traiter en pratique, puisque c'est ce que vos clients utilisent réellement en ce moment :
- **Critique** : sur un poste partagé, le token d'activation Club+ d'un club (stocké en `localStorage`) est rejoué **pour n'importe quel compte** qui se connecte ensuite sur ce navigateur, sans vérification d'identité — la personne B hérite du club de la personne A en administrateur.
- **Critique** : le lien de confirmation d'inscription (e-mail Supabase) court-circuite tout l'onboarding — le compte reste définitivement vide ("Aucun espace n'est encore rattaché à ce compte"), boucle sans issue visible.
- **Critique** : un utilisateur déjà inscrit qui ouvre son lien d'activation Club+ tombe dans une boucle infinie ; le message d'erreur affiché décrit un remède qui n'existe pas dans le code.
- **Critique** (déjà documenté §4.1/OS) : "Accès suspendu" côté club (`toggleSuspend`) ne suspend en réalité aucun accès Connect — corrigé cette nuit côté base (migration v18), mais le bouton lui-même reste dans l'app vanilla, à vérifier une fois la migration exécutée.
- **Élevée** : faille de sécurité similaire à 3.3 côté app vanilla elle-même (même fonction `portal-onboarding`, donc déjà corrigée par le même fix).
- **Élevée** : achat de crédits Club+ ("Demande transmise à SportVision") et bouton contact = toast sans aucun appel réseau, personne n'est jamais prévenu.
- **Élevée** : à vérifier en priorité — le fichier documente une vérification directe (07/08) montrant `clubplus-billing-portal` et `create-clubplus-subscription-checkout` répondant 404 en prod (edge functions non déployées). Si toujours vrai : **aucun club ne peut souscrire ni gérer sa facturation actuellement**, chiffre d'affaires potentiellement bloqué.

### 4.5 — Cohérence bout en bout entre systèmes
Rapport le plus important pour prioriser : confirme indépendamment le point 3.1 (`portail_client_id`, déjà corrigé), et ajoute :
- Un CM ne peut **pas créer de contenu pour un club auto-inscrit** — le sélecteur client des modales OS est alimenté par `clients`/`contrats`, un club sans ces liens n'y apparaît pas. Corollaire direct de 3.1 : maintenant que le lien se crée automatiquement, ce point devrait se résoudre de lui-même une fois la fonction redéployée — **à vérifier**.
- Régression identifiée : un client qui a pris rendez-vous depuis la vitrine voyait son RDV dans l'app vanilla — **aucune trace de `rendez_vous` dans app-next** (0 occurrence). À reconstruire si ce parcours doit être supporté par le rebuild.
- Le parcours "message client → staff" fonctionne bien (le mieux bouclé des 4 tracés), sous réserve du bug FK 3.2 (déjà corrigé).

---

## 5. Recommandation d'ordre de traitement à ton réveil

1. **Relire et exécuter les 4 migrations dans l'ordre du §1**, puis redéployer `clubplus-onboarding` et `portal-onboarding` (Supabase Dashboard).
2. **Vérifier en conditions réelles** qu'un nouveau club self-service obtient bien un `portail_client_id` et apparaît dans l'OS — je n'ai pas pu tester ça moi-même cette nuit puisque ça nécessite le redéploiement que je ne peux pas faire.
3. **App vanilla (§4.4)** : les 3 premiers points critiques (token d'activation rejouable, boucle de confirmation d'inscription, boucle d'activation) touchent de vrais utilisateurs aujourd'hui — à traiter en priorité dès que tu as un créneau, avant le reste.
4. **Facturation/Contrats OS (§4.3)** : à ne pas corriger à la légère — je recommande un vrai passage avec toi (ou un regard juridique sur le contenu du contrat envoyé en signature) avant que j'y touche, vu les implications légales et comptables.
5. Le reste (§4.1, §4.2) : backlog, moins urgent, mais réel.

Rien de plus n'a été exécuté en base cette nuit. Je reste disponible pour continuer sur n'importe lequel de ces points dès que tu veux trancher les priorités.
