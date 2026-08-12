# Rapport de migration CONNECT → CONNECT (personnel) + CLUB+ (séparé)

Demandé par MASTER-ECOSYSTEME-V2.md Partie XV, avant tout gros chantier de code. Périmètre : `app-next` (code actuel de Connect), en vue de remplacer sa partie personnelle par le nouveau design fourni le 12/08 (dossier `design-connect-personnel-12-08/`), et de faire migrer sa partie club vers une future application Club+ séparée.

**Méthode : audit en lecture seule, aucun fichier modifié.**

---

## 1. Architecture actuelle

`app-next` est **une seule application** qui sert 9 "org types" avec un menu qui change selon `(orgType, planCode)` — voir `src/lib/navigation.ts:resolveNavigation()` :

- `club`, `academy`, `coach`, `event`, `sponsor`, `cm_agency` → **B2B / organisations** (deviennent Club+)
- `player`, `parent` → **personnel** (deviennent le nouveau Connect)
- `generic` avec `planCode="one_off"` → **Espace Projet** (client individuel/freelance, personnel aussi)

Toutes les routes vivent sous `src/app/(app)/<module>/page.tsx` (35 dossiers), partagées entre tous les org types — un même `page.tsx` peut brancher son contenu selon `ctx.organization.type` (ex. `team-requests/page.tsx:65-71` distingue club/player/parent dans le même fichier).

Le shell (`AppShell.tsx`, `Sidebar.tsx`, `Header.tsx`, `OrganizationSwitcher.tsx`) est unique et rendu pour tout le monde ; c'est `resolveNavigation()` qui décide quelles entrées de menu afficher.

## 2. Ce qui doit devenir Club+ (application séparée)

Navigations concernées : `NAV_CLUB_PLUS`, `NAV_CLUB_FULLCOM`, `NAV_COACH_FULLCOM`, `NAV_ACADEMY_FULLCOM`, `NAV_EVENT_FULLCOM`, `NAV_ACADEMY_CLUBPLUS`, `NAV_COACH_CLUBPLUS`, `NAV_CM_AGENCY`, `NAV_SPONSOR`, `NAV_GENERIC`.

Routes **exclusivement club/B2B** (aucune nav personnelle n'y renvoie) :
`studio`, `newsroom`, `matchcenter`, `communication`, `validations`, `publications`, `presences`, `analytics`, `reports`, `mycm`, `requests` (visual_requests), `sessions`, `camps`, `eventtimeline`, `live`, `teams` (roster club — distinct de `team-requests`), `sponsors`, `contracts`, `users`, `appointments`, `accompagnement`.

Composants dédiés club : `ClubOfferCard.tsx`, `ClubServicesBoard.tsx`, `ClubBookingWizard.tsx`, `ClubBookingDetail.tsx`, `KanbanBoard.tsx`, tout `components/communication/`, `components/contracts/`, `components/sponsors/`, `components/teams/`, `components/users/`.

Tunnel d'inscription club : `app/signup/club-request/*` (déjà refait cette nuit pour la faille admin-sans-validation) — reste côté Club+.

## 3. Ce qui reste/devient Connect (personnel)

Navigations sources : `NAV_PLAYER`, `NAV_PARENT`, `NAV_ONE_OFF`.

Routes réutilisables telles quelles ou à étendre : `dashboard`, `content`, `calendar`, `team-requests` (partie player/parent seulement), `messages`, `settings/profile`, `support`, `services` (partie catalogue personnel), `documents`, `billing`, `children`, `authorizations`.

**Écart majeur avec le nouveau design** : `NAV_PLAYER` actuel n'a que 7 entrées (Accueil, Mes contenus, Calendrier, Mon équipe, Messages, Mon profil, Aide) — aucune notion d'**affiliations multiples**, de **groupes/équipes personnels**, de **cotisations collectives**, de **commandes séparées des documents**. Le nouveau design ajoute tout ça (Partie I et II du master doc) : c'est la partie qui n'existe pas encore et doit être construite, pas juste réhabillée.

Tunnel d'inscription joueur : `app/signup/type`, `org`, `needs`, `plan`, `account`, `done` — la maquette de connexion/inscription fournie (`Connect Connexion Web.dc.html`, `Connect Inscription.dc.html`) recouvre ce même tunnel, à fusionner.

## 4. Commun (à ne pas dupliquer)

- **Shell** : `AppShell.tsx`, `Header.tsx`, `Sidebar.tsx`, `OrganizationSwitcher.tsx`, `NoActiveSpace.tsx` — un même utilisateur peut être joueur ET admin de club (switcher), donc ce shell doit continuer d'exister quelque part de commun aux deux apps, ou être dupliqué avec un composant switcher qui bascule d'app.
- **Auth/session** : `lib/supabase/session.ts`, `lib/supabase/mappers.ts` — identité unique (users/profiles), c'est la base du "une seule identité utilisateur" du master doc §5.
- **`services`** : le module le plus mélangé. `NewServiceTunnel.tsx` et `ServicesBoard.tsx` sont utilisés à la fois par le tunnel personnel (Espace Projet/joueur) et par le club (`ClubServicesBoard.tsx` est séparé mais partage `tunnel/*`, `tabs/*`). Table `prestations`/`catalogue_offres` commune — le master doc Partie IV le confirme déjà ("un seul objet métier `service_requests`").
- **`content`** : `ContentLibrary.tsx`, `MediaCard.tsx`, etc. — contenus livrés par SportVision, consultés à la fois par le club et par les joueurs affiliés.
- **`billing`/`documents`** : mélange factures/devis club ET factures/devis personnels sur la même table (`client_factures`, `client_devis`, `client_contrats`) — nécessite un filtre par identité, pas une nouvelle table.

## 5. Tables Supabase réutilisées telles quelles

Repérées dans `lib/data/player/`, `lib/data/family/`, `lib/data/projet/`, `lib/data/shared/` :

`organizations`, `memberships`, `membership_requests`, `club_members`, `club_teams`, `clubs`, `team_memberships`, `player_profiles`, `parent_profiles`, `parent_player_relationships`, `parental_authorizations`, `prestations`, `client_prestations`, `catalogue_offres`, `client_contrats`, `client_devis`, `client_factures`, `client_media_livrables`, `contenus`, `contenu_favoris`, `contenu_stats`, `calendar_events`, `event_checklist_items`, `rendez_vous`, `requests`, `messages_client`, `member_notifications`, `notification_quiet_hours`, `organization_entitlements`, `cm_agency_club_access`.

Ces tables couvrent déjà : identité, affiliations (`memberships`/`membership_requests`), club/équipes, prestations/catalogue, documents financiers, contenus + favoris, calendrier, messages, notifications.

## 6. Tables potentiellement nouvelles (vs. nouveau design)

Le nouveau design introduit des concepts absents du modèle actuel :

- **Cotisations collectives** (`group_fundings`, `funding_contributions` — déjà nommées dans le master doc Partie II §47-49). Rien d'équivalent trouvé dans le code actuel — **à créer entièrement** (RPC, RLS, intégration Stripe, page publique sans compte).
- **Groupes personnels** (`user_groups`, `user_group_members` — master doc Partie VI). Différent de `club_teams`/`team_memberships` (qui sont liés à une organisation) — **à créer**.
- **Affiliation multiple + club non-partenaire déclaré** : `memberships`/`membership_requests` existent mais semblent scopés à une seule organisation active par défaut (voir `OrganizationSwitcher.tsx`, à vérifier en détail) ; le concept de "club déclaré non-partenaire" (sans vraie ligne `organizations` administrable) n'a pas d'équivalent trouvé — **à vérifier/étendre**.
- **`resolve_player_client_id`** existe déjà (migration v43, nuit du 12/08) — bonne base pour que le nouveau catalogue personnel écrive dans `prestations` sans compte club.

## 7. Risques identifiés

1. **`team-requests/page.tsx` (585 lignes) et `services`/`ServicesBoard.tsx`/`NewServiceTunnel.tsx` sont branchés par `orgType` dans le même fichier.** Retirer les branches club sans casser les branches player/parent demande une relecture ligne à ligne, pas un simple split de dossier.
2. **`resolveNavigation()` est LE point de vérité du menu pour toute l'app.** Si Connect et Club+ deviennent deux apps séparées, cette fonction doit être scindée en deux — risque d'oubli d'un cas (`filterAffiliatedPlayerNav`, `filterClubRoleNav` en dépendent aussi).
3. **`billing`/`documents` mélangent des lignes club et des lignes personnelles sur les mêmes tables** (`client_factures` etc. — le nom `client_*` suggère déjà un scope par client/personne, à confirmer qu'aucune ligne "club" n'y transite par erreur).
4. **Écart de fonctionnalités, pas juste de design** : cotisations et groupes personnels n'existent pas côté backend — ce n'est pas un "reskin", c'est une vraie feature à construire (paiement Stripe collectif compris, point le plus sensible du chantier).
5. **Le shell commun (AppShell/Sidebar/switcher) est un point de couplage fort** entre les deux futures apps — décision d'architecture à trancher explicitement (deux apps 100% séparées avec un lien de bascule, vs. un même repo avec deux "surfaces").

## 8. Ordre des modifications recommandé

1. Décision d'architecture : deux apps Next distinctes, ou une seule app avec deux surfaces routées différemment (impacte tout le reste). **Point de validation avec Fouka, pas une décision technique libre.**
2. Socle commun : confirmer que `users`/`memberships`/`organizations` supportent bien "un joueur ET un admin de club" sans dupliquer l'identité (déjà largement en place, à vérifier seulement).
3. Construire les deux nouvelles briques backend (cotisations, groupes personnels) — le plus gros risque technique, à isoler du reste.
4. Remplacer le shell/nav personnel par le nouveau design (auth, inscription, accueil, affiliations, équipes) en réutilisant `player_profiles`/`memberships`/`team_memberships` existants.
5. Brancher prestations/cotisations/contenus/calendrier/messages/documents personnels sur les tables existantes.
6. Retirer du menu personnel (déjà fait pour `NAV_PLAYER` en grande partie) tout ce qui est club — vérifier qu'aucune route club n'est encore accessible en direct par URL depuis un compte joueur/parent.
7. Migrer/isoler le code club vers Club+ en dernier (le plus gros volume de fichiers, mais le risque fonctionnel le plus faible puisqu'il ne change pas de design).

## 9. Estimation de complexité

- **Volume** : 35 dossiers de routes, ~7200 lignes cumulées rien que dans les `page.tsx` de premier niveau (hors composants), 27 fichiers dans `components/services/`, 8 dans `components/content/`.
- **Chantier design (Connect personnel)** : gros — le nouveau design couvre ~15 écrans/flows inédits (affiliations, groupes, cotisations création/détail/page publique, catalogue personnel restructuré, commandes séparées des factures) contre 7 entrées de menu existantes seulement.
- **Chantier backend** : moyen à gros — la majorité des tables existent déjà et sont réutilisables, mais cotisations + groupes personnels sont des features neuves de bout en bout (UI + DB + RLS + Stripe).
- **Chantier séparation Club+** : gros en volume de fichiers à déplacer, mais faible risque fonctionnel nouveau (le code club ne change pas de comportement, juste d'emplacement).
- **Estimation globale** : ce n'est pas un chantier de quelques heures — c'est plusieurs vagues d'agents sur plusieurs jours, avec la brique cotisations comme sous-chantier à part entière.

## 10. Points nécessitant validation de Fouka avant de coder

1. **Deux apps séparées ou une seule app à deux surfaces ?** Décide l'ordre et la difficulté de tout le reste.
2. **Sort de `clubplus.sportvision.fr`** (le site résiduel déjà mentionné en mémoire, faille corrigée cette nuit) — reste-t-il en service en parallèle du futur Club+, ou est-il retiré au profit du nouveau ?
3. **Cotisations : Stripe collectif** — confirmer le modèle de remboursement/webhook avant d'écrire le moindre code (le master doc §55-56 pose la règle mais pas l'implémentation Stripe précise).
4. **Priorité** : construire d'abord le nouveau Connect personnel (le design est prêt, le backend personnel existe déjà à 80%), ou d'abord séparer Club+ (aucun nouveau design à faire, mais gros volume de code à déplacer) ?

---

**Prochaine étape suggérée** : trancher les points de la section 10, puis lancer la construction du nouveau Connect personnel par petites vagues (auth/inscription d'abord, ça réutilise le plus de code existant et a le moins de dépendances).
