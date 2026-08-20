# SportVision — Incohérences connues entre OS / Connect / Club+ / Vitrine / Full Communication

Ce document liste les incohérences **déjà rencontrées et documentées dans le code lui-même** (commentaires d'audits précédents), pas des suppositions. La plupart sont **déjà corrigées** au moment de la rédaction de ce pack — elles restent listées car (a) elles montrent des classes de bugs récurrentes utiles à un audit, et (b) certaines dépendent encore d'une migration ou d'une action manuelle non faite. Le statut de chacune est précisé.

Complété au fur et à mesure de l'avancement du pack — voir aussi § 60/61 du plan d'audit (recherche TODO/FIXME/mock à venir).

---

### INC-001 — Migrations marquées "À EXÉCUTER PAR FOUKA", jamais exécutées

- **Sévérité** : Moyenne à Haute selon la migration (bloque une fonctionnalité entière, mais échoue proprement plutôt que silencieusement).
- **Systèmes impactés** : Club+.
- **Comportement actuel** : au moins 3 migrations connues sont explicitement marquées comme non exécutées dans les commentaires du code : `migration-clubplus-v34-club-messages-contenus-access.sql` (accès club aux messages/contenus), `migration-connect-v17-club-presences.sql` (module Présences terrain), `migration-cm-agency-club-access.sql` (accès délégué agence CM).
- **Comportement attendu** : ces modules devraient fonctionner pour un club qui y a droit.
- **Cause probable** : exécution manuelle de migration jamais faite depuis leur écriture.
- **Correctif recommandé** : vérifier en base réelle (comme fait plusieurs fois ce soir pour d'autres migrations marquées à tort "NON EXÉCUTÉE") si elles ont finalement été appliquées entre-temps ; si non, les exécuter.
- **Fichiers concernés** : `livrables/SportVision-Connect/app-next/src/lib/supabase/entitlements.ts:27-40, 72-73`.
- **Statut** : **À VÉRIFIER** (peut être obsolète si exécuté depuis la rédaction du commentaire).

### INC-002 — Rôles club "directeur_sportif"/"administratif" référencés côté frontend, migration marquée non exécutée

- **Sévérité** : Moyenne.
- **Systèmes impactés** : Club+.
- **Comportement actuel** : `mappers.ts` (Club+) référence ces deux rôles de `migration-clubplus-v40`, marquée "NON EXÉCUTÉE" dans son propre en-tête.
- **Comportement attendu** : les deux rôles doivent exister en base pour être assignables réellement.
- **Cause probable** : idem INC-001 — en-tête de migration à vérifier contre l'état réel de la base (leçon déjà établie ce soir : cet en-tête ment parfois).
- **Fichiers concernés** : `livrables/SportVision-Connect/app-next/src/lib/permissions.ts:27-45`.
- **Statut** : **À VÉRIFIER**.

### INC-003 — Module Studio promis à l'onboarding mais verrouillé pour 100% des comptes réels

- **Sévérité** : Haute (fausse promesse produit, trouvée par audit pré-lancement).
- **Systèmes impactés** : Club+.
- **Comportement actuel (avant correctif)** : `OnboardingOverlay.tsx` promettait explicitement le Studio à tout nouveau club, alors que "studio" était absent de `READY_MODULES` — verrouillé pour tous, sans exception, malgré une page "100% fonctionnelle" (47 modèles réels).
- **Comportement attendu** : un module promis à l'onboarding doit être accessible.
- **Cause probable** : `READY_MODULES` jamais mis à jour après que la page Studio a été rendue fonctionnelle.
- **Correctif appliqué** : "studio" ajouté à `READY_MODULES` le 19/08/2026 (audit pré-lancement), sans nouvelle gate par plan.
- **Fichiers concernés** : `livrables/SportVision-Connect/app-next/src/lib/supabase/entitlements.ts:110-122`.
- **Statut** : **CORRIGÉ** (19/08/2026).

### INC-004 — Full Communication invisible pour tous les vrais clubs Full Communication

- **Sévérité** : Critique (fonctionnalité vendue, jamais accessible).
- **Systèmes impactés** : Club+, contrats.
- **Comportement actuel (avant correctif)** : confirmé par 5 agents lors d'un audit UI/UX le 11/08/2026 — aucun vrai club Full Communication n'a jamais pu obtenir `isFullCommunication=true` (mauvais dashboard affiché, mauvaise navigation, jamais mis en avant Validations/Publications/Statistiques/Rapports).
- **Comportement attendu** : un club sous contrat Full Communication actif doit voir le dashboard dédié.
- **Cause probable** : logique de résolution du contrat (`client_contrats`) buguée ou jamais branchée correctement.
- **Correctif appliqué** : corrigé (date exacte non précisée dans le commentaire retrouvé, antérieure au 11/08/2026 audit qui l'a confirmé résolu).
- **Fichiers concernés** : `livrables/SportVision-Connect/app-next/src/lib/supabase/session.ts:238-250`.
- **Statut** : **CORRIGÉ**, mais rappel méthodologique important : ce cas prouve qu'un composant frontend existant ("le dashboard Full Communication existe dans le code") ne garantit pas qu'il ait jamais été atteint par un vrai client avant correction.

### INC-005 — 4 types d'organisation tombaient sur "Aucun espace disponible" malgré un backend fonctionnel

- **Sévérité** : Haute.
- **Systèmes impactés** : Club+.
- **Comportement actuel (avant correctif)** : `structure_coaching`, `tournoi`, `stage`, `cm_agency` redirigeaient tous vers l'écran "Aucun espace disponible", alors que le backend et le dashboard associé étaient "entièrement fonctionnels".
- **Cause** : `layout.tsx` maintenait une **copie locale dupliquée** de la liste des types génériques d'organisation, jamais synchronisée avec la vraie liste utilisée ailleurs dans le code.
- **Correctif appliqué** : bascule vers la vraie source de vérité, plus de liste dupliquée.
- **Fichiers concernés** : `livrables/SportVision-Connect/app-next/src/lib/supabase/session.ts:644-651`.
- **Statut** : **CORRIGÉ**. Leçon générale : toute liste de types/statuts dupliquée entre deux fichiers est un risque récurrent dans ce codebase — pattern déjà vu ce soir (v15 self-demote, v81 rejoin-after-retire) sous une forme différente (logique dupliquée plutôt que donnée dupliquée).

### INC-006 — Rôle du bureau du club jamais vérifié avant le 12/08/2026

- **Sévérité** : Critique (accès financier non contrôlé).
- **Systèmes impactés** : Club+.
- **Comportement actuel (avant correctif)** : `club_members.role` ne filtrait ni la navigation ni les écrans financiers — un `communication_manager` ou un `coach` voyait exactement le même menu qu'un admin, avec Contrats/Factures/Utilisateurs/Documents grand ouverts.
- **Comportement attendu** : accès financier réservé au bureau (admin/president/treasurer/board_member).
- **Correctif appliqué** : audit du 12/08/2026, fonctions `hasClubFinancialAccess`/`canViewClubFinancialDocuments`/etc. ajoutées.
- **Fichiers concernés** : `livrables/SportVision-Connect/app-next/src/lib/permissions.ts:140-151`.
- **Statut** : **CORRIGÉ**, mais **à re-vérifier explicitement en audit de sécurité** — c'est exactement le type de bug qu'un audit externe doit re-tester lui-même plutôt que faire confiance au commentaire (voir § 59/89 du plan d'audit).

### INC-007 — Secrétaire/Administratif club bloqués sur leur propre menu

- **Sévérité** : Moyenne (régression UX, pas de faille de sécurité — trop restrictif, pas trop permissif).
- **Systèmes impactés** : Club+.
- **Comportement** : `NAV_CLUB_SECRETAIRE`/`NAV_CLUB_ADMINISTRATIF` pointaient vers `/documents`, mais la page gatait tout son contenu derrière `hasClubFinancialAccess` — ces rôles tombaient sur "Accès refusé" en cliquant sur leur propre lien de menu.
- **Correctif appliqué** : oui.
- **Fichiers concernés** : `livrables/SportVision-Connect/app-next/src/lib/permissions.ts:178-182`.
- **Statut** : **CORRIGÉ**.

### INC-008 — Modèle multi-affiliations décrit dans le master doc, absent du backend réel

- **Sévérité** : Information structurelle (pas un bug — un écart de scope assumé).
- **Systèmes impactés** : Connect, Club+.
- **Comportement actuel** : `player_profiles.club_id` est une colonne UNIQUE — un joueur n'a qu'une seule affiliation active possible à la fois.
- **Comportement décrit dans le cadrage** : `MASTER-ECOSYSTEME-V2.md` Partie VI décrit un modèle conceptuel `player_affiliations` (plusieurs affiliations par joueur).
- **Cause** : chantier de schéma jamais entamé, explicitement repoussé.
- **Recommandation déjà écrite dans le code** : ne pas construire cette table sans trancher explicitement avec Fouka au préalable, pour ne pas dupliquer/désynchroniser la source de vérité utilisée par Club+ (qui ne lit que `player_profiles`/`membership_requests`).
- **Fichiers concernés** : `livrables/SportVision-Connect/app-connect/src/lib/supabase/session.ts:9-16`.
- **Statut** : **NON IMPLÉMENTÉ** (assumé, documenté comme décision en attente, pas comme bug).

### INC-009 — Vocabulaire "adhésion" vs "affiliation" non unifié

- **Sévérité** : Basse (cohérence terminologique, pas fonctionnelle).
- **Systèmes impactés** : Connect, Club+, documentation.
- **Comportement actuel** : `README.md` (SportVision-Connect) et plusieurs fichiers `data/club|family|player/team-requests.ts` emploient "adhésion" pour une demande de rattachement à une équipe. Le modèle de données réel et `MASTER-ECOSYSTEME-V2.md` emploient systématiquement "affiliation" pour le rattachement joueur↔club et "cotisation" pour le financement collectif entre joueurs.
- **Cause probable** : dérive naturelle de vocabulaire entre plusieurs sessions de développement, jamais unifiée.
- **Recommandation** : glossaire unique à faire trancher (le code n'a lui-même jamais signalé cette coexistence comme un problème, contrairement aux autres entrées de cette liste — trouvé par recherche croisée pour ce pack, pas par un commentaire d'auto-audit).
- **Fichiers concernés** : `README.md` (SportVision-Connect) l.84 ; `livrables/SportVision-Connect/app-next/src/lib/data/{club,family,player}/team-requests.ts`.
- **Statut** : **NON CORRIGÉ**, purement terminologique.

### INC-010 — Cahier des charges mentionne Yousign, le code réel utilise Youtrust

- **Sévérité** : Basse (documentation obsolète, pas un bug fonctionnel).
- **Systèmes impactés** : documentation uniquement.
- **Comportement** : le code réel (edge functions `youtrust-webhook`, `send-signature-request`) utilise **Youtrust**. Un ancien cahier des charges citait "Yousign".
- **Correctif** : déjà signalé explicitement dans `ARCHITECTURE-CONNECT.md:224` "pour éviter toute confusion dans le cahier des charges ou les specs futures".
- **Statut** : **DOCUMENTÉ**, aucune action de code nécessaire.

### INC-011 — CSP bloquait silencieusement Google Fonts depuis le premier déploiement (Connect)

- **Sévérité** : Basse (dégradation visuelle silencieuse, pas de panne fonctionnelle).
- **Systèmes impactés** : Connect.
- **Comportement (avant correctif)** : la CSP bloquait le chargement de Google Fonts "depuis le tout premier déploiement" — dégradation vers police système, erreur console à chaque connexion, alors que le commentaire d'origine affirmait à tort l'absence de police externe.
- **Correctif** : appliqué le 09/08/2026.
- **Fichiers concernés** : `livrables/SportVision-Connect/app-connect/netlify.toml:24-28` (et équivalents dans les autres netlify.toml).
- **Statut** : **CORRIGÉ**.

### INC-012 — HSTS sans `includeSubDomains`, assumé comme provisoire

- **Sévérité** : Basse à Moyenne (durcissement sécurité incomplet, volontairement).
- **Systèmes impactés** : Vitrine, Club-Plus (legacy), Connect (legacy + actuel).
- **Comportement** : configuration HSTS répétée dans 4 `netlify.toml` sans `includeSubDomains`, commentaire explicite : "on ne connaît pas encore tous les sous-domaines éventuels du domaine définitif".
- **Recommandation** : à revisiter une fois la cartographie finale des sous-domaines stabilisée (vitrine, Connect, Club+, OS).
- **Statut** : **ASSUMÉ COMME PROVISOIRE**, pas un bug — à re-décider avant lancement définitif.

### INC-013 — Edge function `connect-org-signup` dépréciée, remplacée mais toujours présente dans le repo

- **Sévérité** : Information (pas un risque actif si bien désactivée).
- **Systèmes impactés** : Connect.
- **Comportement** : cette edge function créait une organisation active immédiatement après un simple `auth.signUp()`, **sans aucune validation staff** — contraire au principe produit "aucune structure ne doit être créée sans vérification SportVision".
- **Correctif appliqué** : désactivée le 17/08/2026, retourne systématiquement 410 (Gone). Remplacée par le tunnel unifié (`connect-club-signup-request` + `connect-club-signup-review` + `connect-org-activate`).
- **Statut** : **CORRIGÉ/DÉSACTIVÉ**, mais **à vérifier que le déploiement Supabase réel reflète bien cette désactivation** — rappel : ce repo n'est PAS la source de vérité déployée en continu pour les edge functions (redéploiement manuel requis, déjà oublié au moins 5 fois par le passé selon les propres commentaires du code).

### INC-014 — Deux applications legacy (Club+ ancien, Connect vanilla) toujours configurées pour déploiement Netlify

- **Sévérité** : À déterminer — dépend de leur statut réel côté Netlify (voir § 5.2 de `SPORTVISION_OS_AUDIT_PACK.md`).
- **Systèmes impactés** : Club+, Connect (versions historiques).
- **Recommandation** : vérifier manuellement dans le dashboard Netlify si ces deux sites legacy sont encore actifs ; si oui, décider s'ils doivent être désactivés avant tout audit de sécurité externe (deux implémentations différentes des mêmes fonctionnalités, avec des états de sécurité potentiellement différents, est un risque en soi).
- **Fichiers concernés** : `livrables/SportVision-Club-Plus/netlify.toml`, `livrables/SportVision-Connect/app/netlify.toml`.
- **Statut** : **À VÉRIFIER MANUELLEMENT** (hors capacité de ce pack, qui n'a accès qu'au code, pas au dashboard Netlify).

### INC-015 — Signature électronique désactivée dans l'OS (côté staff)

- **Sévérité** : Moyenne.
- **Systèmes impactés** : SportVision OS.
- **Comportement actuel** : `demanderSignatureDoc` (l.10485-10491) est temporairement désactivée — le bouton affiche un toast invitant à faire signer en papier/PDF au lieu d'appeler `send-signature-request`. Le commentaire du code précise explicitement : implémentation réelle conservée dans l'historique git, "à restaurer une fois la production Yousign active et le secret `YOUTRUST_API_URL` configuré dans Supabase."
- **Point notable** : le commentaire mentionne encore "Yousign" alors que l'intégration réelle est Youtrust (voir INC-010) — trace supplémentaire de la confusion de nommage, cette fois dans un commentaire actif plutôt que dans une doc.
- **Recommandation** : vérifier si `YOUTRUST_API_URL` est configuré côté Supabase et réactiver cette fonction si oui.
- **Fichiers concernés** : `SportVision-OS-Full.html:10485-10491`.
- **Statut** : **DÉSACTIVÉ, à vérifier si la dépendance est maintenant levée**.

### INC-016 — Réservations clubs potentiellement bloquées par une policy RLS non exécutée

- **Sévérité** : Haute si toujours vrai (écran staff visible mais non fonctionnel).
- **Systèmes impactés** : SportVision OS, Club+.
- **Comportement actuel (au moment de l'écriture du commentaire dans le code)** : la RLS staff nécessaire (`migration-connect-v34-club-bookings-staff-access.sql`) était **NON EXÉCUTÉE** — l'écran "Réservations clubs" affiche alors une liste vide et tout changement de statut échoue en HTTP 42501 (permission refusée), sans message d'erreur clair pour l'utilisateur staff.
- **Précédent connu** : la même nuit, plusieurs migrations marquées "NON EXÉCUTÉE" se sont révélées en fait déjà appliquées en prod (leçon déjà établie : ne jamais faire confiance à cet en-tête seul).
- **Recommandation** : vérifier en base réelle l'état de cette migration précise avant de conclure quoi que ce soit.
- **Fichiers concernés** : `SportVision-OS-Full.html:18575-18581`.
- **Statut** : **À VÉRIFIER EN BASE**.

### INC-017 — Cotisations (paiement collectif) : policy RLS staff potentiellement absente

- **Sévérité** : Haute si toujours vrai.
- **Systèmes impactés** : SportVision OS.
- **Comportement actuel (au moment de l'écriture du commentaire)** : le code documente lui-même l'absence d'une policy `is_staff()` sur `group_fundings`/`funding_contributions`/`user_groups` — sans elle, l'écran Cotisations affiche "Aucune cotisation" pour tout le monde, y compris admin, même si des données existent réellement (comportement PostgREST normal sous RLS trop stricte, pas une erreur visible).
- **Recommandation** : vérifier en base réelle si cette policy a été ajoutée depuis l'écriture de ce commentaire.
- **Fichiers concernés** : `SportVision-OS-Full.html:18869-18879, 18934`.
- **Statut** : **À VÉRIFIER EN BASE**.

### INC-018 — Plusieurs tables/migrations backend non garanties présentes en production

- **Sévérité** : Moyenne à Haute selon la table.
- **Systèmes impactés** : SportVision OS.
- **Comportement** : le code contient des blocs `catch` défensifs avec message explicite "Table X manquante, migration Y.sql à exécuter" pour au moins ces cas : `frais` (déclaration de frais), `formations_custom`/`formations_quiz_custom` (`migration-formations-admin.sql`), `paiements` (`migration-portail-v1.sql`), `expenses` (`migration-finance-lot0.sql`), `commissions` (`migration-finance-lot0.sql`), `contrats` (`migration-contrats.sql`, + `migration-contrats-v3-description.sql` pour le champ description du périmètre spécifiquement), `centre_ressources`.
- **Point positif à noter** : c'est une pratique de développement disciplinée — écran vide avec message explicite plutôt qu'écran blanc ou erreur brute — mais cela confirme qu'un nombre notable de fonctionnalités ne sont pas garanties opérationnelles sans vérification directe en base.
- **Recommandation** : vérifier chacune de ces migrations en base réelle (méthode déjà établie ce soir : requête directe sur le schéma, jamais confiance dans un en-tête de fichier).
- **Fichiers concernés** : voir tableau détaillé dans l'inventaire OS complet (nombreuses lignes dans `SportVision-OS-Full.html`, zone 7000-23000).
- **Statut** : **À VÉRIFIER EN BASE, liste probablement partiellement obsolète** (cohérent avec le pattern déjà observé ce soir sur d'autres migrations).

### INC-019 — Écran "Demandes" du CM lit une table différente de celle peuplée en démo

- **Sévérité** : Basse (limitation du mode démo, pas un bug de production).
- **Systèmes impactés** : SportVision OS (mode démo uniquement).
- **Comportement** : l'écran "Demandes" du rôle Community Manager lit la table `club_requests`, distincte de `connect_clubplus_signup_requests` — les deux noms se ressemblent et concernent tous deux des "demandes", ce qui peut prêter à confusion lors d'une revue rapide du schéma.
- **Recommandation** : si le mode démo doit un jour couvrir cet écran, peupler `club_requests` spécifiquement (ne pas réutiliser `connect_clubplus_signup_requests` en pensant que c'est la même chose).
- **Statut** : **NOTÉ**, sans impact sur la production réelle.

### INC-021 — L'enum `statut_prestation` mélange statuts opérationnels et financiers (CONFIRMÉ par audit externe 20/08)

- **Sévérité** : Haute — signalé comme P0 par un audit externe qui a pu, pour la première fois, observer de vraies données via les pages `/demo/<module>` statiques.
- **Systèmes impactés** : SportVision OS (colonne `prestations.statut`, écran Production, Kanban, Dashboard).
- **Comportement** : la séquence de valeurs de `statut` (voir `prestation_statuses_sequence` dans `SPORTVISION_OS_AUDIT_DATA.json`) inclut `facturée`, `partiellement_payée`, `payée` ET `clôturée` — des notions financières — directement dans la même colonne/enum que les statuts opérationnels (`demande_reçue`, `équipe_affectée`, `production_terminée`...). Concrètement, une prestation peut afficher `statut: 'payée'` comme si "payée" était une étape de production, alors que c'est un état financier — observable sur `SV-DEMO-0005` dans `/demo/production`.
- **Pourquoi c'est un problème réel (pas juste esthétique)** : ça empêche de représenter des combinaisons pourtant normales (ex. "Livrée + Impayée", "Planifiée + Payée d'avance", "Clôturée + Facture non payée") puisque le statut opérationnel et le statut financier sont censés être indépendants mais partagent la même colonne pour certaines valeurs terminales.
- **Correctif appliqué le 20/08** : vérifié avant migration que 0 ligne de production n'était dans un état `facturée`/`partiellement_payée`/`payée` sur `statut` (2 prestations réelles au total, toutes `demande_reçue`) — migration sûre, sans backfill. `_NEXT_ST` (frontend) fait maintenant avancer `'livrée'` directement vers `'clôturée'`. Migration `migration-prestations-v87-decouple-statut-financier.sql` exécutée en production : `validate_prestation_statut_transition()` n'autorise plus les transitions vers `facturée`/`partiellement_payée`/`payée` depuis `statut` (testé en réel avec un compte jetable : `livrée→facturée` rejetée, `livrée→clôturée` acceptée). L'événement `payment.confirmed` (tâches auto "Paiement reçu") déplacé vers `majStatutFinancier()`/`majStatutFacture()`, où le paiement se confirme réellement désormais. Les valeurs `facturée`/`partiellement_payée`/`payée` restent dans l'enum Postgres `statut_prestation` (Postgres ne permet pas de retirer proprement une valeur d'enum) mais ne sont plus atteignables par transition — dette résiduelle mineure, sans impact fonctionnel.
- **Statut** : **CORRIGÉ** (20/08/2026).

### INC-022 — L'écran "Factures" ne lisait pas la vraie table `factures` (CONFIRMÉ par audit externe 20/08, CORRIGÉ)

- **Sévérité** : Haute — P0 selon l'audit externe.
- **Systèmes impactés** : SportVision OS (écran Factures vs Finance vs Dashboard), table `factures`, Pennylane.
- **Précision importante** : contrairement à l'hypothèse initiale, "Facture" **était déjà** une entité métier réelle — `getOrCreateFacture()`/`emettreFacture()` créent et numérotent correctement des lignes `factures` (numéro `FAC-2026-00XX`, échéance, snapshot montant/TVA, lien Pennylane), déclenché automatiquement quand une prestation atteint `production_terminée`. Le vrai bug était plus étroit : `loadComptaFactures()` (l'écran LISTE "Factures") ne lisait jamais cette table — il dérivait un pseudo-affichage depuis `prestations.statut_financier`, donc affichait des références de PRESTATION (`SV-DEMO-0004`) comme si c'étaient des références de facture. Résultat observable avant correctif : Dashboard/Finance affichaient `FAC-2026-0041`, l'écran Factures affichait `SV-DEMO-0004` pour la même prestation.
- **Correctif appliqué le 20/08** : `loadComptaFactures()`/`renderComptaFactures()` interrogent maintenant `factures` directement (avec embed `clients`/`prestations`). Nouvelle fonction `majStatutFacture()` (équivalent de `majStatutFinancier` mais sur une vraie ligne `factures`), qui répercute sur `prestations.statut_financier` pour garder Dashboard/Rentabilité/Impayés synchronisés. `exportCSV('factures')` et les boutons de filtre corrigés sur le même vocabulaire réel (`emise`/`payee`/`partiellement_payee`/`en_retard`, sans accent — colonne `factures.statut` distincte de `statut_financier`). 0 ligne réelle dans `factures` au moment du correctif (aucune prestation n'avait encore atteint `production_terminée` en production) : aucun backfill nécessaire.
- **Statut** : **CORRIGÉ** (20/08/2026).

### INC-023 — 20 des 49 edge functions Supabase avaient du code non déployé (CONFIRMÉ et CORRIGÉ, 20/08)

- **Sévérité** : Haute — plusieurs fonctions concernées sont sur des chemins critiques (paiement, réservation, notifications).
- **Systèmes impactés** : `stripe-webhook`, `create-checkout-session`, `create-guest-request`, `connect-player-prestations`, `dispatch-notifications`, `send-devis-email`, `send-facture-pennylane`, `send-signature-request`, `invite-collaborateur`, `notify-account-change`, `request-password-reset`, `admin-delete-portal-account`, `check-disponibilite`, `clubplus-activate`, `clubplus-generate-activation`, `clubplus-invite`, `clubplus-onboarding`, `connect-club-signup-request`, `connect-club-signup-review`, `connect-staff-create-org`.
- **Comportement découvert** : en croisant la date du dernier commit git de chaque `supabase/functions/<nom>/index.ts` avec le `updated_at` réel de la fonction déployée (API Management Supabase), 20 fonctions sur 49 avaient un fichier local modifié APRÈS leur dernier déploiement — parfois de quelques minutes, parfois de plusieurs jours (`invite-collaborateur`/`notify-account-change`/`request-password-reset`/`send-facture-pennylane` : code local du 08/08, encore sur la version du 02-05/08). Plusieurs de ces fonctions portent d'ailleurs un commentaire d'en-tête explicite ("REDÉPLOIEMENT MANUEL REQUIS après toute modification") — un rappel qui n'avait pas toujours été suivi.
- **Pourquoi c'est un problème réel** : du code corrigé/testé dans le repo pouvait ne jamais atteindre la production. `stripe-webhook` et `create-checkout-session` étant sur le chemin de paiement, un correctif de fiabilité resté local y aurait un impact direct sur de vrais paiements.
- **Correctif appliqué le 20/08** : les 20 fonctions redéployées via `supabase functions deploy <nom> --project-ref lulgezzpvrlbftbykzrc`. Revérifié après coup : 0 fonction en dérive (commit ≤ déploiement pour les 49), toutes au statut `ACTIVE`. Smoke-testées (stripe-webhook, create-checkout-session, dispatch-notifications) : réponses structurées (400/401/erreur applicative), aucun crash.
- **Dette résiduelle** : ce contrôle n'est pas automatisé (comparaison manuelle git vs API Management) — un futur commit sur une edge function peut recréer la même dérive si le redéploiement manuel est oublié. À envisager : un check CI ou un script de vérification à relancer périodiquement.
- **Statut** : **CORRIGÉ** (20/08/2026).

### INC-024 — Le workflow crédits de club_requests était cassé pour le cas normal (CONFIRMÉ et CORRIGÉ, 20/08)

- **Sévérité** : Critique — bloquait le cœur du modèle économique Club+/Full Communication (demande de visuel à crédits).
- **Systèmes impactés** : `submit_club_request`, `update_club_request_status`, `staff_update_club_request_status`, trigger `trg_protect_sensitive_club_fields` sur `clubs`.
- **Découvert en testant en réel le test croisé Club+/Full Communication ↔ OS explicitement demandé par l'audit** (§67 : demande de visuel → crédits réservés → OS reçoit → production → OS livre) — pas trouvé par lecture de code, seulement par exécution réelle avec un compte membre jetable.
- **Comportement** : `trg_protect_sensitive_club_fields` bloque toute écriture sur `clubs.credits_reserved`/`credits_balance` sauf pour `service_role` ou un membre `profiles.role IN (admin,com,sec,compta)`. Les 3 RPC qui gèrent légitimement ces crédits sont `SECURITY DEFINER` — ça change les droits objets, pas `auth.uid()`/`auth.role()` (lus depuis les claims JWT), donc la protection continue de voir l'appelant réel : un simple membre club (jamais staff) ne peut jamais soumettre une demande avec des crédits > 0 (`submit_club_request` avec `p_credits=0` fonctionne, `p_credits=2` échouait systématiquement) ; le rôle `cm` — responsable réel de ces demandes selon la policy `creq_staff_select` — est absent de la liste staff de la protection, donc `update_club_request_status`/`staff_update_club_request_status` échouaient aussi quand un CM termine ou refuse une demande à crédits.
- **Correctif appliqué le 20/08** (`migration-clubplus-v40-fix-credits-trigger-block.sql`) : bypass ciblé via un GUC de transaction (`app.trusted_credit_op`), positionné par ces 3 RPC juste avant leur propre écriture contrôlée — pas un contournement général de la protection.
- **Vérifié en réel après correctif, cycle complet** : membre soumet une demande à 2 crédits (`credits_reserved` club 0→2) → staff CM (rôle spécifiquement absent de la protection, testé exprès) la termine → crédits déduits correctement (2→0, transaction loggée `club_credit_transactions`) → membre voit le statut "terminee" en retour. Toutes les données de test supprimées après coup.
- **Statut** : **CORRIGÉ** (20/08/2026).

### INC-027 — E2E cross-app (Vitrine/Connect/Club+ → OS) : 3 pipelines certifiés, 1 faille critique corrigée, 2 gaps restants

- **Sévérité** : la faille crédits était Critique (corrigée). Les 2 gaps restants sont Moyenne (discoverability) et Moyenne-Haute (produit).
- **Systèmes impactés** : Vitrine, Connect (app-connect), Club+ (app-next), OS.
- **Contexte** : l'audit du 20/08 demandait explicitement de CERTIFIER (pas juste supposer depuis la lecture du code) que Vitrine→OS, Connect→OS et Club+→OS fonctionnent réellement de bout en bout avant de considérer l'OS comme source de vérité. Un agent dédié a tracé le vrai code de chaque app et testé en direct avec des données jetables (créées puis supprimées, résidu vérifié à zéro).
- **Résultat** :
  1. **Vitrine → OS** : CERTIFIÉ. `create-guest-request` (edge function) crée bien une `prestations` avec `source='vitrine'`, visible dans l'Inbox unique (`loadSecDemandes`).
  2. **Connect → OS** (réservation perso + paiement collectif) : CERTIFIÉ. RPC `create_group_funding` + `contribute_funding_especes` fonctionnent, trigger `trg_fc_recompute` recalcule bien `montant_collecte`.
  3. **Club+ → OS** (demande de visuel + crédits) : CERTIFIÉ fonctionnel, MAIS a révélé une **faille critique** : `submit_club_request()` n'avait aucun garde-fou serveur contre une réservation de crédits dépassant le solde disponible (seul un contrôle côté client existait, contournable par un appel RPC direct). Reproduit en live (100 crédits réservés contre un solde de 10) puis **corrigé** le 20/08 (`migration-clubplus-v92-credits-guard.sql` : verrou de ligne + rejet serveur, E2E vérifié dans les deux sens).
  4. **Visibilité de la livraison côté client** : **CASSÉE pour Connect (particuliers)**, **fonctionnelle pour Club+**. `app-next` lit déjà `client_media_livrables` (vue filtrée sur statut livré/consulté) — un club voit ses livrables. `app-connect` ne lit **jamais** `media_livrables` ni `media_liens` nulle part dans son code — quand le staff marque une livraison `statut='livre'` pour un client Connect individuel (joueur/famille), rien ne change dans Connect ; le seul signal que reçoit le client est un e-mail/message manuel envoyé à part par le staff. Écran "Mes contenus" lit `club_media` (RPC différente, une galerie de contenu éditorial, pas les livrables).
  5. **Note secondaire** : la "demande de visuel" Club+ (table `club_requests`) n'apparaît PAS dans l'Inbox unique (`sec.demandes`, qui agrège prestations + réservations club) — elle vit uniquement sur un écran CM dédié. Fonctionnellement correct mais incohérent avec le principe "un seul endroit pour tout voir" que l'Inbox unique visait à résoudre.
- **Comportement attendu** : un client Connect individuel devrait voir/télécharger ses livrables directement dans l'app, comme un club le fait déjà.
- **Statut** : point 3 (faille crédits) **CORRIGÉ**. Points 4 et 5 **NON FAITS** — le point 4 nécessite d'ajouter la lecture de `media_livrables`/`media_liens` côté `app-connect` (edge function `connect-player-prestations` + UI `CommandeDetailView.tsx`), une vraie fonctionnalité à construire dans une app pas encore touchée cette nuit, pas un simple correctif.

### INC-032 — Full Communication : détection cassée pour les rôles non financiers (P0 §29, CORRIGÉ)

- **Sévérité** : Haute — même classe de panne qu'INC-004 (11/08), jamais totalement fermée.
- **Comportement trouvé (E2E re-testé de bout en bout le 20/08)** : `buildClubActiveContext()` détecte le statut Full Communication via la vue `client_contrats`, dont la RLS restreint la lecture à `club_member_has_financial_view_access` (admin/president/tresorier/membre_bureau/secretaire/administratif). Un membre `coach`/`resp_equipe`/`cm_externe`/`sponsor_mgr`/`lecture_seule`/`directeur_sportif` d'un VRAI club Full Communication obtenait 0 ligne → mauvais dashboard, Validations/Publications/Statistiques/Rapports jamais affichés. Le 2ᵉ site d'appel (délégation agence CM externe, `cm_agency_club_access`) était encore plus cassé : ce chemin n'a jamais de ligne `club_members`, donc toujours faux quel que soit le contrat.
- **Correctif** (`migration-clubplus-v96-fullcomm-detection-fix.sql`) : nouveau RPC `client_has_active_fullcomm_contract()` — booléen pur, réutilise `is_club_member()` qui couvre déjà les deux chemins d'accès. `session.ts` (2 sites d'appel) basculé dessus.
- **E2E vérifié** : admin=true (inchangé), coach=true (corrigé, était false), utilisateur sans lien=false, contrat non actif=false même pour l'admin. Résidu de test à zéro.
- **Statut** : **CORRIGÉ** (20/08/2026).

### INC-031 — Audit systématique des 148 fonctions SECURITY DEFINER : 4 failles réelles trouvées et corrigées (CRITIQUE)

- **Sévérité** : Critique pour 2 des 4 points (exploitables par un appelant totalement anonyme, sans compte).
- **Contexte** : suite à la découverte de la faille crédits (`submit_club_request`, plus tôt cette nuit), audit systématique des 148 fonctions `SECURITY DEFINER` du schéma public (8 fonctions critiques déjà auditées individuellement plus tôt, exclues de cette passe). Fait par un agent dédié, chaque trouvaille reproduite et corrigée par une vérification manuelle directe en base avant tout correctif.
- **Trouvailles et corrections** (`migration-securite-v97-audit-security-definer.sql`) :
  1. **`connect_athlete_profile_coalesce_update` / `connect_declare_club` — CRITIQUE.** Aucune vérification `auth.uid()` interne, `EXECUTE` accordé à `anon`. Un appelant totalement anonyme (juste la clé anon, publique dans tout bundle frontend) pouvait écrire des champs de profil sportif (taille/poids/poste/maillot) pour un `user_id` arbitraire, ou fabriquer une affiliation de club pour n'importe qui. Vérifié : les deux ne sont légitimement appelées que via `service_role` depuis des edge functions qui valident déjà l'appelant avant l'appel — `revoke execute` pour public/anon/authenticated, service_role intact. **Reproduit en live avant correctif** (appel anon réussissait), **testé après correctif** (42501 pour anon, toujours fonctionnel en service_role).
  2. **`enqueue_notification` — un correctif existait déjà dans le repo (`migration-securite-enqueue-notification.sql`) mais n'avait JAMAIS été exécuté** — exactement le pattern "migration jamais appliquée" documenté ailleurs cette nuit (INC-001/002/016/017), cette fois sur une vraie faille de sécurité active : relais de phishing/spam vers n'importe quelle adresse via le canal d'envoi vérifié SportVision. Exécuté ce soir. **`notify_client_members`/`connect_notify_by_client_id` — même faille, jamais couverte par ce correctif** : ajoutées au `revoke`.
  3. **`staff_update_club_request_status` / `update_club_request_status` / `update_request_status` — race condition, même classe de bug que `submit_club_request` (corrigé plus tôt cette nuit).** Lecture de l'ancien statut sans verrou de ligne avant la décision de déduire des crédits — deux appels concurrents (double-clic, deux onglets staff) pouvaient déduire les crédits deux fois. Corrigé par `SELECT ... FOR UPDATE`. **Reproduit en live avec 2 appels réellement parallèles** (résultat avant correctif attendu : solde 10→0 avec 2 lignes de transaction ; après correctif, confirmé : solde 10→5, 1 seule ligne de transaction).
  4. Note secondaire (non corrigée, faible sévérité) : `rpc_complete_formation`/`rpc_submit_quiz` ont le même défaut de verrou sur de l'XP de formation (pas de l'argent réel) — dette mineure, pas traitée cette nuit.
- **67 fonctions sur 148 n'ont pas de `search_path` explicite** (liste complète dans le rapport de l'agent, non reproduite ici) — dette de durcissement systématique, pas traitée cette nuit (aucune n'est individuellement exploitable de la même façon que les 4 corrigées ci-dessus, mais standardiser reste recommandé).
- **Statut** : **CORRIGÉ** pour les 4 points critiques/haute sévérité. Les 67 `search_path` manquants et le défaut mineur sur l'XP restent en dette, non urgents.

### INC-030 — Vérifications P0 restants de l'audit du 20/08 (batch, tous confirmés/clos)

- **Sévérité** : variable par point, tous **résolus ou confirmés déjà sains**.
- **INC-001/INC-002 (migrations club "peut-être non exécutées")** : vérifié en base — `club_members_role_check` inclut déjà `directeur_sportif`/`administratif`. Migrations bien exécutées, commentaires du code obsolètes. **CONFIRMÉ SAIN.**
- **INC-016 (RLS réservations clubs)** : `cbk_staff_select`/`cbk_staff_update` existent sur `club_bookings`. **CONFIRMÉ SAIN.**
- **INC-017 (RLS cotisations staff)** : `gf_staff_select`, `fc_staff_select`, `ug_staff_select` existent sur `group_fundings`/`funding_contributions`/`user_groups`. **CONFIRMÉ SAIN.**
- **Données orphelines (1 prestation + 2 paiements, voir INC-028)** : investiguées — `SV-2026-0060` (prestation test manuelle, `client_id` jamais renseigné) et 2 paiements à 120€ sans `stripe_payment_intent_id` ni aucune liaison (artefacts de test manifestes, aucune activité Stripe réelle). **SUPPRIMÉS** le 20/08 après vérification qu'aucune donnée réelle n'y était attachée. `prestations`/`paiements` à 0 ligne, cohérent avec le reste de la base (voir INC-028).
- **2 déploiements Netlify legacy (Club+ ancien, Connect vanilla)** : vérifié directement via l'API Netlify (liste des sites du compte) — **seuls 4 sites existent réellement** : `sportvision-clubplus`, `sportvision-connect`, `sportvisionfr` (Vitrine), `sportvision-os`. Le code legacy a toujours un `netlify.toml` dans le repo mais **aucun site Netlify n'a jamais été créé pour lui** — rien à désactiver, le risque était théorique (code présent ≠ site déployé). **CONFIRMÉ SAIN.**
- **Isolation Demo/Staging vs production (Stripe/email/Storage)** : audité le code des routes `/demo/*` de `app-connect` et `app-next` — aucune référence Stripe, les 3 pages qui touchent Supabase le font en lecture seule sur `catalogue_offres` (déjà public, même donnée que la Vitrine non authentifiée) avec CTA d'action explicitement désactivés (`disabled`, tooltip explicite) ou des écritures qui échoueraient proprement faute de session réelle. Le mode démo de l'OS lui-même ne fait **aucun appel réseau réel** (déjà établi et vérifié plus tôt cette nuit). **CONFIRMÉ SAIN.**
- **Build/lint/typecheck Connect + Club+ (jamais exécutés avant ce soir)** : `npm run typecheck` et `npm run build` exécutés en entier sur les deux apps (`app-connect`, `app-next`) — **0 erreur, build de production complet dans les deux cas** (59 routes app-connect, ~70 routes app-next). `npm run lint` : ESLint n'est pas encore configuré sur ces projets (prompt de configuration interactif, non exécuté — décision de configuration à prendre consciemment, pas à la volée pendant un correctif).
- **Statut** : **TOUS CONFIRMÉS/CLOS**, sauf lint (non configuré, décision à prendre séparément — pas un bug).

### INC-029 — Storage : lecture publique sur des chemins conçus comme privés (P0 audit §17, PARTIEL)

- **Sévérité** : Haute (structurelle) mais exposition réelle actuelle nulle — voir détail.
- **Systèmes impactés** : `portail-media` (chemin `messages/<client_id>/...`, pièces jointes de messagerie client↔staff), `clubplus-media` (chemin `family-docs/<player_id>/...`, documents familiaux).
- **Comportement trouvé** : les policies d'ÉCRITURE sur ces deux chemins sont déjà correctement scopées (client propriétaire/joueur avec accès pour `messages/`, parent confirmé pour `family-docs/`), mais la policy de LECTURE était un simple `bucket_id = X` sans aucune restriction de chemin — accessible à tout le monde, authentifié ou non.
- **Correctif partiel appliqué le 20/08** (`migration-storage-v94-restrict-sensitive-reads.sql`) : nouvelles policies SELECT scopées (client propriétaire/parent confirmé/staff au lieu de public). Vérifié en E2E : fonctionne sur les endpoints Storage qui respectent la RLS (`/object/authenticated/`, `/object/sign/`).
- **Limite trouvée en vérifiant** : **insuffisant seul**. `portail-media` et `clubplus-media` ont `bucket.public=true`, et l'endpoint `/object/public/<bucket>/<path>` (celui que génère `getPublicUrl()`, utilisé partout dans le code — balises `<img src>`, liens de pièce jointe) sert le fichier **sans jamais consulter la RLS** dès que le bucket est public. Testé en direct : avec `bucket.public=true`, l'objet reste lisible par n'importe qui via `/object/public/` malgré la nouvelle policy. Passer le bucket en `public=false` corrige la lecture (vérifié) **mais casse alors tout le contenu légitimement public du même bucket** (logos, catalogue vitrine, avatars) — `getPublicUrl()` ne s'adapte pas dynamiquement, et une balise `<img src>` ne peut de toute façon pas envoyer d'en-tête d'authentification.
- **Le vrai correctif** (non fait cette nuit) : créer un bucket **privé** dédié au contenu sensible, faire écrire `handleAttach()` (`MessagesThread.tsx`, Connect) dessus au lieu de `portail-media`, stocker le **chemin** plutôt qu'une URL publique permanente dans `messages_client.piece_jointe_url` (les URLs signées expirent, il faut en regénérer une à chaque affichage), et faire de même côté écran "Messages clients" de l'OS pour l'affichage staff. Pour `family-docs/`, moindre urgence — voir ci-dessous.
- **Exposition réelle à ce jour** : **nulle, vérifié**. `family-docs/` n'a **aucun code d'upload** nulle part dans le repo (policy DB créée par `migration-clubplus-v17.sql`, fonctionnalité jamais construite côté UI — mort-né, pas une fuite active). `messages_client` est à **0 ligne** en production (base venant d'être nettoyée, voir INC-028) — aucune pièce jointe n'a donc jamais été uploadée. C'est une faille structurelle à corriger avant un usage réel de la messagerie, pas une fuite de données déjà survenue.
- **Statut** : **PARTIEL**. Policies RLS scopées en place (défense en profondeur utile). Architecture bucket privé + URLs signées + changement du code d'upload/affichage : **NON FAIT**.

### INC-028 — Nettoyage complet clients/organizations/clubs/memberships (test data uniquement)

- **Sévérité** : Info — traçabilité d'une action de nettoyage, pas un bug.
- **Contexte** : en préparant le rewiring CRM (INC-026), vérification de l'état réel de `clients`/`organizations` avant tout changement de schéma/UI. Constat : **les 18 lignes de `clients` et les 31 lignes de `organizations` étaient à 100% des données de test/QA** accumulées depuis le 06/08 (ex. "Test Automatise" ×7, "ZZZ-CROSSTENANT-AUDIT-A-DELETE-ME" jamais supprimé malgré son nom, "abes belabs"/"farod adop" — données de fuzzing, doublons "Club Test SportVision"). Aucune ligne ne correspondait à un vrai prospect/client — cohérent avec le statut du produit (bêta interne, pas encore en usage CRM réel).
- **Action (20/08, autorisée explicitement par Fouka après vérification des dépendances FK)** : suppression complète de `clients` (18), `organizations` (25, dont 6 créées par les tests E2E de cette session elle-même — effet de bord d'un trigger de sync découvert seulement ce soir), `clubs` (2, cascade `club_members`/`memberships`/`organization_entitlements`), + leurs dépendants directs (`prestations`, `devis`, `paiements`, `contenus` liés). Vérifié avant suppression que rien ne ressemblait à une vraie activité business (montants/statuts/libellés tous des artefacts de test).
- **Cas particulier vérifié** : 2 comptes `connect_profile_settings` liés à de VRAIS comptes auth (christian.fouka@gmail.com, c.foukapro@gmail.com — probablement des tests personnels de Fouka) référençaient un `client_id` de test. Contrainte `ON DELETE SET NULL` confirmée avant suppression : les comptes réels sont intacts, seul le lien vers le client de test a été nettoyé (`client_id` repasse à `null`, se re-résout normalement à la prochaine connexion).
- **Résidu trouvé, hors périmètre de ce nettoyage** : 1 prestation (`SV-2026-0060`, 19/08) et 2 paiements (09/08, 10/08, 120€ chacun, statut `en_attente`) ont déjà un `client_id`/`prestation_id` null — orphelins antérieurs à cette session, sans lien avec les lignes supprimées ici. Pas touchés (hors du périmètre autorisé), à trancher séparément par Fouka.
- **Statut** : **FAIT**. `clients`/`organizations`/`clubs`/`memberships`/`club_members` à 0 ligne, vérifié. Le rewiring CRM proprement dit (faire lire l'OS depuis `organizations`/`memberships`) reste à faire — voir INC-026 — mais démarre maintenant sur une base propre plutôt que polluée.

### INC-026 — Personne/Organisation/Membership : un système existe déjà (organizations/memberships), ne pas le réinventer

- **Sévérité** : Info/architecture — pas un bug, un piège pour une future session.
- **Systèmes impactés** : Connect (app-next / Club+), OS.
- **Comportement actuel** : l'OS modélise toujours ses clients dans une seule table `clients` qui mélange Personne, Organisation et relation commerciale (voir INC-025 pour le volet statut, corrigé par migration-crm-v91). Un audit externe du 20/08 a recommandé de séparer Personne/Organisation/Membership. Avant d'écrire un premier octet de migration pour ça, une investigation dédiée (agent, 20/08 soir) a trouvé que **ce système existe déjà** : les tables `organizations` (organization_type club/académie/coach/projet/sponsor, avec `legacy_client_id`/`legacy_club_id`) et `memberships` (user_id/organization_id/role/status/source) ont été créées par `migration-connect-v2-organizations-entitlements.sql` et sont **activement synchronisées en production** par 3 triggers (`trg_sync_client_to_organization`, `trg_sync_club_to_organization`, `trg_sync_club_member_to_membership`). `app-next` (Club+) les lit/écrit déjà (`organizations`, `memberships`, `organization_entitlements`). `player_profiles` (avec `client_id` + `club_id` nullables) est déjà, en pratique, la table "Personne joueur".
- **Comportement attendu** : toute future tentative de "corriger le modèle CRM Personne/Organisation" doit d'abord lire ce constat et **étendre/consommer** `organizations`/`memberships`/`player_profiles`, jamais créer de nouvelles tables `personnes`/`organisations` en parallèle — ça créerait un doublon conceptuel et une désynchronisation avec les triggers déjà actifs.
- **Ce qui reste réellement à faire** (non fait le 20/08, volume trop important pour une passe non review — l'OS a ~47 sites d'appel directs sur `clients` dans `SportVision-OS-Full.html`) : faire lire/écrire l'OS lui-même sur `organizations`/`memberships` au lieu de `clients` brut, pour que `/structures` et `/operateurs` (aujourd'hui des alias démo honnêtes filtrés côté client, pas de vrais écrans séparés) deviennent éventuellement de vrais écrans si le besoin se confirme.
- **Statut** : **NON FAIT** — documenté pour éviter une duplication future, pas engagé faute de revue possible sur un rewiring de cette taille en une seule nuit.

### INC-025 — Ledger crédits Club+ : donnée réelle déjà en base, aucun écran ne l'affiche (P0 #14, PARTIEL)

- **Sévérité** : Haute — recommandation explicite de l'audit (§31, §53) : "je déconseille fortement un simple champ credits_balance... je veux un historique."
- **Systèmes impactés** : `clubs.credits_balance`/`credits_reserved`, table `club_credit_transactions`.
- **Comportement** : contrairement à l'hypothèse initiale de l'audit ("le ledger n'existe pas"), la donnée EST déjà réelle et à jour — `club_credit_transactions` est déjà écrite par `update_club_request_status`/`staff_update_club_request_status` (voir INC-024) à chaque consommation de crédit, avec libellé et montant. Mais **zéro écran de l'OS ne la lit** (vérifié : aucune occurrence de `club_credit_transactions` en lecture dans tout `SportVision-OS-Full.html`) — le staff n'a aujourd'hui aucun moyen de voir l'historique des mouvements de crédits d'un club, seulement le solde final s'il va chercher la ligne `clients` en base directement.
- **Fait le 20/08** : exposé honnêtement dans `/demo/clubplus` (solde par club + mouvements), étiqueté clairement comme donnée réelle sans écran dédié — pas présenté comme une fonctionnalité OS existante.
- **Non fait, à traiter séparément** : construire le vrai écran. Nécessite d'abord de clarifier où les comptes ORGANISATION Club+ sont gérés côté OS — `connect_os_account_detail` (RPC utilisée par la fiche compte de `/demo/clubplus`) s'est révélée, en creusant son code, ne couvrir que les JOUEURS Connect affiliés à un club (`player_profiles` join `clubs`), pas le compte organisation Club+ lui-même. Cette confusion de modèle (deux notions différentes de "compte club") doit être résolue avant de brancher un ledger crédits au bon endroit dans l'UI — voir INC-026, c'est le même nœud de fond.
- **Statut** : **PARTIEL** — donnée honnêtement documentée, écran réel non construit (nécessite une clarification de modèle au préalable).

### INC-020 — Duplication du dispatch financier admin / compta

- **Sévérité** : Basse (risque de maintenance, pas un bug actif).
- **Systèmes impactés** : SportVision OS.
- **Comportement** : les ~15 écrans financiers détaillés sont dispatchés deux fois dans `loadViewData` — une fois pour le groupe `_isComptaLike` (compta/expert_comptable/auditeur), une fois explicitement pour `admin`, avec un commentaire assumant ce choix pour éviter de dupliquer d'autres dispatches (`dash`/`docs`) déjà gérés séparément pour admin.
- **Risque** : une future modification d'un écran financier peut être faite sur une branche du dispatch et oubliée sur l'autre, désynchronisant le comportement admin vs compta sans qu'aucune erreur ne le signale.
- **Recommandation** : envisager de fusionner les deux branches (`_isComptaLike.push('admin')` plutôt que deux blocs de code séparés), à évaluer sans urgence.
- **Fichiers concernés** : `SportVision-OS-Full.html:3610-3733` (bloc `loadViewData`).
- **Statut** : **NOTÉ**, refactor optionnel.

---

## Résumé § 60/61 du plan d'audit d'origine (recherche TODO/FIXME/HACK/mock)

Recherche effectuée sur l'ensemble de `SportVision-OS-Full.html` (~25 000 lignes) : **aucun marqueur `TODO`/`FIXME`/`HACK` de dette technique réel trouvé**. Les seules occurrences du mot "hack" dans le fichier appartiennent au contenu pédagogique d'un quiz de formation interne (texte fictif destiné aux collaborateurs), sans rapport avec le code lui-même.

En revanche, la recherche a mis au jour un pattern répété et cohérent : des blocs `catch` défensifs annonçant explicitement qu'une table est absente et quelle migration l'ajouterait (voir INC-018 ci-dessus) — c'est la vraie forme que prend la dette technique dans ce codebase : jamais un commentaire "TODO" oublié, toujours un garde-fou utilisateur explicite en attendant qu'une migration soit exécutée.
