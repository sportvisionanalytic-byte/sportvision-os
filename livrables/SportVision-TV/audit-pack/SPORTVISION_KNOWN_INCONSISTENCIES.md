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
