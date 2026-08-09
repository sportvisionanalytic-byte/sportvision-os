# SportVision Connect — reconstruction complète (Next.js)

Nouvelle plateforme externe unique de SportVision. Construite à partir du handoff de design
dans `../../../context/import/SportVision-Connect-Design/` :

- `README.md` — vue d'ensemble, arborescence des routes, logique d'abonnement, treize expériences
- `CHARTE.md` — couleurs, typographie, espacements, ombres, animations (déjà encodés dans
  `tailwind.config.ts` et `src/app/globals.css`, à consulter pour tout ce qui n'a pas encore
  d'utilitaire Tailwind dédié)
- `ACTIONS.md` — **document à suivre pour câbler chaque écran** : chaque bouton, sa cible, son
  effet, sa condition d'affichage
- `DATA_MODEL.md` — entités, champs, relations, énumérations, séquences serveur

**Ces trois documents sont la source de vérité produit.** En cas de doute sur un comportement,
elle prime sur toute supposition.

L'ancienne app `../app` (vanilla JS, sans build) reste en service en lecture pendant cette
construction, sans coupure — voir la politique de non-régression dans le README du dossier de
design.

## Ce qui est déjà posé (architecture commune)

| Fichier | Contenu |
|---|---|
| `tailwind.config.ts` + `src/app/globals.css` | Tokens exacts de CHARTE.md, sombre par défaut, bascule via `[data-theme]` |
| `src/lib/types.ts` | Types fondamentaux (`User`, `Organization`, `Membership`, `Subscription`, `ActiveContext`, `ModuleKey`...) |
| `src/lib/plans.ts` | Catalogue d'offres — **source de vérité unique**, ne jamais dupliquer ces chiffres ailleurs |
| `src/lib/permissions.ts` | `canAccess` / `canCreate` / `hasEntitlement` / `hasQuota` — **interdiction absolue de tester `plan.code` ou `organization.type` directement dans un écran** |
| `src/lib/navigation.ts` | `resolveNavigation(orgType, planCode)` — reproduit exactement la logique « l'offre décide avant le type » du README |
| `src/lib/session-context.tsx` | `useSession()` — organisation active + changement d'organisation. **Mock pour l'instant**, voir plus bas |
| `src/lib/mock-data.ts` | Données fictives (FC Fontainebleau, US Varenne, Lucas Mendes) pour faire tourner l'architecture commune sans backend |
| `src/components/layout/*` | `Sidebar`, `Header`, `OrganizationSwitcher` |
| `src/components/ui/*` | `Button`, `Badge` (StatusChip), `Card` / `CardPremium` |
| `src/app/(app)/layout.tsx` | Coque authentifiée (sidebar + header). Toute nouvelle route applicative se place sous `src/app/(app)/` |
| `src/app/(app)/dashboard/page.tsx` | Écran de référence — copiez ses conventions plutôt que d'en inventer de nouvelles |
| `src/app/auth/login/page.tsx` | Écran de référence pour les pages d'accès (deux panneaux, formulaire, gestion d'erreur) |

## Décision volontairement pas prise ici

**Aucun backend n'est branché.** `session-context.tsx` et `mock-data.ts` sont un mock côté
client assumé, pas une anticipation d'architecture serveur. Le choix du backend (Supabase — déjà
utilisé par le reste de l'écosystème SportVision, voir `../app/netlify.toml` — ou autre) est une
décision produit séparée, à valider avec Fouka avant d'écrire la moindre requête réseau. Tant que
ce n'est pas tranché, continuez à étendre `mock-data.ts` avec des données fictives mais réalistes
(voir README.md § Fidélité) plutôt que d'appeler un service externe.

## Conventions pour construire un nouveau module

1. **Ne dupliquez pas les entités déjà dans `src/lib/types.ts`.** Les entités propres à votre
   module (`VisualRequest`, `Service`, `MediaAsset`, `Publication`...) vont dans
   `src/lib/types/<module>.ts` — un fichier par module, pour ne jamais entrer en conflit avec un
   autre agent qui travaille en parallèle sur un module différent.
2. **Chaque route applicative** vit sous `src/app/(app)/<route>/page.tsx`, protégée par
   `canAccess(ctx, 'module_key')` — voir `src/lib/permissions.ts`. Si l'accès est refusé,
   affichez l'écran « module verrouillé » (ACTIONS.md § 26), ne redirigez jamais silencieusement.
3. **Les composants réutilisables au-delà d'un seul module** vont dans `src/components/ui/`. Les
   composants propres à un module vont dans `src/components/<module>/`, jamais directement dans
   `src/components/ui/` (pour la même raison de non-conflit qu'au point 1).
4. **Toute couleur, taille, rayon ou ombre vient de CHARTE.md.** Pas de valeur inventée. Les
   utilitaires Tailwind existants (`bg-surface`, `text-text-soft`, `shadow-sv-card`, `rounded-sv`,
   `bg-success-bg text-success-fg`...) couvrent l'essentiel ; complétez `tailwind.config.ts` si un
   token de CHARTE.md manque, ne le réécrivez pas en valeur brute dans un composant.
5. **Une seule action principale par écran** (`<Button variant="primary">`), le reste en
   `secondary` / `tertiary` / `dark` selon CHARTE.md § Boutons.
6. **États obligatoires** sur tout composant interactif : par défaut, survol, actif, focus
   (`:focus-visible` uniquement), désactivé, erreur, chargement. Voir CHARTE.md § États
   obligatoires.
7. **Suivez `ACTIONS.md` écran par écran.** C'est l'inventaire exhaustif des boutons, cibles et
   effets ; ne devinez pas un comportement qui y est déjà spécifié.
8. **Toute écriture réelle (`insert`/`update`/RPC/edge function) doit attendre la réponse avant de
   confirmer quoi que ce soit à l'utilisateur.** Anti-pattern trouvé et corrigé 9 fois dans une
   seule session d'audit (08-09/08/2026, comptes réels) : une modale qui fait `onAction(input);
   onClose();` sans attendre, ou un `.then(...)` sans `.catch(...)` — dans les deux cas, en cas
   d'échec (RLS, réseau, contrainte), l'utilisateur voit une confirmation alors que rien n'a été
   écrit, ou un bouton qui reste bloqué en "chargement" indéfiniment. Toujours :
   `submitting`/`error` en state local, `await`/`.then().catch()` explicite, ne fermer/confirmer
   qu'au succès, afficher l'erreur (inline ou `components/feedback/Toast`) sinon — jamais
   deviner que ça a marché. Seul `requests/new/page.tsx` avait ce pattern dès le départ ;
   copiez-le plutôt que d'improviser. Le typecheck/build ne détecte JAMAIS ce bug — seul un test
   en conditions réelles (compte réel, écriture réelle) le révèle.
9. **Ne fabriquez jamais de données ni de confirmation de succès sans backend réel derrière.** Si
   la table/colonne/policy nécessaire n'existe pas encore, verrouillez l'écran (`LockedModule`) ou
   affichez les champs en lecture seule avec une note honnête — jamais un faux "Enregistré".
   Trouvé 3 fois (profil, organisation, préférences de notification) : un `setSaved(true)` sur un
   state React local uniquement, sans aucune écriture réelle derrière.
10. **Une action qui modifie le statut/rôle d'un AUTRE utilisateur doit exclure l'utilisateur
    courant de sa propre cible.** `club_members.status`/`role` sont protégés par un trigger
    (`protect_sensitive_club_member_fields`, migration-connect-v13) qui autorise un admin actif à
    modifier n'importe quelle ligne — y compris la sienne. Se désactiver soi-même est donc
    possible côté base et coupe immédiatement l'accès RLS (`is_club_member`/`is_club_admin`
    exigent `status='actif'`) à tout le club, sans porte de sortie en libre-service pour un club à
    admin unique. Toute action de ce type doit comparer la cible à `ctx.user.id` et se masquer/
    désactiver sur sa propre ligne (voir `/users`), le trigger ne le fait pas à votre place.

## Démarrer

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # vérifie que tout compile avant de considérer un module terminé
npm run typecheck
```
