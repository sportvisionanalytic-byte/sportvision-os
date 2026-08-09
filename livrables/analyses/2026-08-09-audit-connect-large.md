# Audit large — SportVision Connect (app-next)

**Date :** 09/08/2026
**Méthode :** 5 agents d'exploration en parallèle, un par zone fonctionnelle, chacun avec consigne de ne rapporter que ce qu'il a vérifié dans le code réel (grep, lecture de schéma, croisement mock vs UUID réel) — pas d'impression. Environ 260 findings bruts, consolidés et dédoublonnés ci-dessous.

---

## Le fait qui change la lecture de tout le reste

`src/lib/supabase/entitlements.ts` (`READY_MODULES`) ne contient qu'une douzaine de modules. `canAccess()` retourne `false` en premier pour tout module absent de cette liste, **quel que soit le type de compte**. Sont donc **verrouillés pour 100 % des comptes réels aujourd'hui** :

`billing` (branche club), `contracts`, `services`, `documents`, `studio`, `communication`, `publications`, `mycm`, `validations`, `analytics`, `reports`, `presences`, `sessions`, `camps`, `eventtimeline`, `live`, `notifications`, `messages`.

Soit **18 routes sur ~40**. Ça change la sévérité de beaucoup de findings ci-dessous : une donnée fictive sur un écran verrouillé n'est vue par personne aujourd'hui — mais reste une bombe à retardement si le module est ungate un jour sans que le contenu soit fini. J'ai séparé les deux cas.

---

## Tier A — bugs sur des écrans que des vrais comptes voient AUJOURD'HUI

### Cassé pour tout le monde, à corriger en premier
- **Aucun moyen de se déconnecter.** Le bouton "Se déconnecter" de la sidebar n'a aucun handler. (`Sidebar.tsx:109-114`)
- **Avatar "SM" (Sophie Martin) codé en dur** dans le pied de la sidebar, à côté du vrai nom de l'utilisateur — corrigé une fois dans le header (commit 4d6d99d), pas dans la sidebar. (`Sidebar.tsx:101`)
- **Tous les messages d'erreur s'affichent avec une coche verte de succès** — le composant `Toast` n'a pas de variante d'échec. Touche au moins 6 écrans (users, newsroom, requests, requests/new, authorizations, billing).
- **`LockedModule` → boucle fermée** : le CTA "Découvrir les offres" de tout module verrouillé pointe vers `/billing`, qui est lui-même verrouillé pour tout le monde sauf l'Espace Projet.

### Tableau de bord club (`ClubPlusDashboard`, vu par tout club réel)
- "Renouvellement le [date de création de l'organisation, en ISO brut]" au lieu de la vraie date de renouvellement.
- Jauges Présences et Stockage figées à 0 (quota de stockage codé à **1 octet**).
- 9 boutons sans `onClick` : "Demander une prestation", "Gérer l'offre", les 5 actions rapides, "Valider" sur un item "à traiter" réel.
- Les brouillons de contenu remontent dans "À traiter" alors que le commentaire du code dit l'inverse.

### Tableau de bord persona (`PersonaDashboard`, vu par TOUT joueur/parent/coach/académie/sponsor réel)
- Tâches "à traiter", événements "à venir" et vignettes "derniers contenus" **entièrement inventés**, y compris un cas où un vrai prénom d'enfant est mélangé à une date fictive (indiscernable du vrai).
- Coach/académie/sponsor voient "Prestation unique" comme nom de leur offre, alors qu'ils n'ont jamais souscrit ça (`planCode` forcé côté session).
- Bouton d'action de chaque item prioritaire sans `onClick` — y compris celui qui prétend débloquer la publication des contenus d'un enfant.

### Équipes / Match Center / Calendrier
- **Lien cassé systématique** : cliquer sur une équipe ou un joueur depuis `/teams` mène à "introuvable" pour tout compte réel (ids mock vs UUID réels).
- **Feuille de match : 9 champs sur 14 jetés en silence** derrière "Résultat enregistré" (adversaire, compétition, lieu, affluence, passeurs, cartons... non sauvegardés, ré-affichés localement puis perdus au rechargement).
- **Calendrier : heure et lieu jamais enregistrés** (colonnes inexistantes), le lieu est ré-fabriqué à l'affichage puis disparaît au rechargement ; le type d'événement est silencieusement changé pour 4 types sur 10 ("Stage" devient "Tournage").
- Rôle `lecture_seule` peut écrire un résultat de match ou créer un événement calendrier : la policy RLS ne vérifie que l'appartenance au club, pas le rôle — seul le `disabled` côté client protège.
- Bug React réel : hook appelé après un `return` conditionnel dans `calendar/page.tsx` (plantera au changement d'espace).

### Espace Projet — Facturation / Prestations (le seul module financier réellement branché)
- **Écran Prestations toujours vide** : la requête demande deux colonnes qui n'existent pas dans la vue SQL → erreur avalée silencieusement.
- **Statuts de facture entièrement faux** : le code utilise l'énumération d'une autre colonne. Aucune facture n'est jamais "à payer", "Aucune échéance à venir" s'affiche même avec des factures en retard.
- **Bouton "Signer" engage juridiquement en un clic**, sans jamais afficher le contrat, sans confirmation — et échouera silencieusement dans la majorité des cas (nom du signataire vide). La version historique (app vanilla) traite ce même écran en lecture seule, par design.
- Seuls 1 devis et 1 contrat sont exposés au client (pas de liste) ; aucune action de paiement (lien PDF/payer) sur les factures.

### Gestion des membres (`/users`)
- Un membre non-admin peut cliquer "Désactiver" sur un autre membre : l'écriture échoue silencieusement côté RLS mais l'UI affiche un faux succès.
- Aucune vérification de rôle sur la page : un rôle lecture-seule voit et peut cliquer les mêmes boutons qu'un admin.
- La protection "un admin ne peut pas se verrouiller lui-même hors du club" n'existe que côté client — la base l'autorise.

### Studio / Newsroom / Demandes
- **Une demande de visuel soumise depuis Studio ne va nulle part de réel** : elle écrit dans un store mémoire local, jamais dans la vraie base — alors que le vrai backend existe et est utilisé ailleurs (`/requests/new`). Un club qui passe par Studio croit avoir fait une demande ; SportVision ne la reçoit jamais.
- Newsroom et Match Center redirigent tous les deux vers `/studio`, qui est verrouillé pour tout le monde → impasse depuis deux modules par ailleurs fonctionnels.
- `/requests` : un item "annulé" affiche un faux succès avant la réponse serveur ; 2 onglets sur 5 sont structurellement toujours vides (statuts qui n'existent pas côté mapping) ; une demande "Express" payée 3 crédits s'affiche "Prioritaire" (dégradée silencieusement).
- `/requests/new` : pour coach/académie/sponsor, les crédits sont forcés à 0 → bouton d'envoi **définitivement désactivé** ; les pièces jointes sont listées à l'écran puis jamais transmises malgré le message de succès ; le coût en crédits est contrôlé côté client sans vraie limite serveur.

### Espace Parent — Autorisations
- Les autorisations se chargent après la liste des enfants → chaque enfant affiche une fausse alerte "autorisation manquante" au premier rendu.
- Une autorisation qui vient d'être signée reste affichée "manquante" indéfiniment (la RPC pose le statut `a_verifier`, le code ne teste que `valide`) — boucle sans issue pour le parent.

---

## Tier B — modules verrouillés aujourd'hui, personne ne les voit, mais backlog avant de les activer

Pour mémoire, sans détail (le rapport complet liste chaque fichier) : `/communication`, `/publications`, `/studio`, `/mycm` sont ~100 % mock (données indexées par des id d'organisation fictifs, jamais un vrai club) ; `/billing` branche club, `/contracts`, `/documents` idem ; `/notifications` et `/messages` sont doublement morts (verrouillés ET non persistés — même s'ils étaient déverrouillés, rien n'est sauvegardé) ; `/presences`, `/sessions`, `/camps`, `/analytics`, `/reports`, `/validations`, `/eventtimeline`, `/live`, `/accompagnement` sont verrouillés et mock. `FullCommunicationDashboard` (et ses 4 entrées de navigation) ne peut jamais s'afficher : aucun compte réel n'a `planCode: "full_communication"`. `/media` est une page orpheline, doublon exact de `/content`, référencée nulle part.

**Recommandation : ne pas y toucher maintenant.** Ce sont des heures de travail pour des écrans que personne ne peut voir tant que `READY_MODULES` ne les ouvre pas — mieux vaut consacrer le temps au Tier A d'abord, et re-visiter le Tier B module par module au moment de vouloir l'activer.

---

## Sécurité — synthèse

Aucune fuite de données entre clubs/utilisateurs trouvée (les policies RLS ferment bien la porte à chaque fois que le client fait confiance à un id fourni par l'URL). Le seul pattern répété est **rôle vérifié côté client uniquement, pas dans la policy RLS** : lecture-seule peut écrire un résultat de match, un événement calendrier, et un admin peut se verrouiller lui-même hors de son club en appel direct. Impact limité (il faut déjà être membre actif du club), mais à corriger.

Une faille indépendante (RPC `notify_staff_by_role` appelable sans authentification) a déjà été trouvée et une migration de correction préparée lors du travail sur l'inscription — toujours en attente d'exécution de ton côté.

---

## Ce que je propose

1. **Corriger le Tier A maintenant** — c'est concrètement ce que voient tes vrais utilisateurs aujourd'hui. Environ 25-30 corrections, la plupart petites (un handler manquant, une colonne mal mappée) mais 4-5 qui touchent au modèle de données (feuille de match, calendrier, statuts de facture).
2. **Laisser le Tier B de côté** pour l'instant — pas urgent puisque personne ne peut y accéder.
3. Je découpe le Tier A en lots cohérents (ex. "Équipes/Match/Calendrier", "Espace Projet Facturation", "Dashboards", "Users/Sidebar") et je les traite un par un, en testant et committant à chaque lot plutôt qu'un seul énorme commit.
