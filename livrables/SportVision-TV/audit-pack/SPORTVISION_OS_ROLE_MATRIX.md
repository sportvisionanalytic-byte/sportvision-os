# SportVision OS — Matrice des rôles

9 rôles réels (`const ROLES`, `SportVision-OS-Full.html:693`). Pas de table `permissions` en base pour l'OS lui-même — le contrôle d'accès est **entièrement côté frontend** (gardes `S.role` dans le JS) doublé par la **RLS Postgres** (qui reste la vraie barrière de sécurité, voir § RLS du pack principal). Une garde JS absente ou fausse n'expose donc pas forcément une donnée si la policy RLS est correcte — mais une garde JS incorrecte reste un vrai problème d'expérience/produit et un signal à vérifier.

Légende : ● = accès complet, ◐ = accès partiel/lecture élargie, ○ = pas d'accès, — = notion non applicable à ce rôle.

## Vue d'ensemble — nombre d'écrans par rôle

| Rôle | Écrans (approx.) | Nature |
|---|---|---|
| admin | 47 | Accès le plus large, tous les modules |
| sec | 26 | Opérationnel + CRM + finance limitée |
| prod | 24 | Production, planning, équipe, RH terrain |
| compta | 24 | Finance complète (écriture) |
| expert_comptable | 18 | Finance (lecture seule) |
| auditeur | 15 | Finance (lecture seule, encore plus restreint) |
| cm | 17 | Éditorial/contenu, clients CM |
| com | 13 | Commercial, pipeline, devis |
| photo | 11 | Missions personnelles, revenus, formation |

## Matrice module × rôle × action

Actions : **V**oir (accès à l'écran), **C**réer, **É**diter, **S**upprimer, **A**ssigner, **Val**ider, **Exp**orter/Finance.

| Module | admin | sec | prod | compta | expert_comptable | auditeur | cm | com | photo |
|---|---|---|---|---|---|---|---|---|---|
| Tableau de bord (dashboard personnalisé par rôle) | V | V | V | V | V | V | V | V | V |
| Prestations (liste + fiche) | V/C/É/S | V/C/É | V/É (pas de suppression) | ○ | ○ | ○ | ○ (lecture seule, `canEdit=role!=='cm'`) | ○ | V (ses missions seulement, via `prestations_equipe`) |
| Équipe affectée à une prestation | V/C/É | V/C/É | V/C/É | ○ | ○ | ○ | ○ | ○ | ○ |
| Devis | V/C/É | V/C/É | ○ | ○ | ○ | ○ | ○ | V/C/É | ○ |
| Contrats | V/C/É/S | V/C/É | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Clients / CRM | V/C/É | V/C/É | ○ | ○ | ○ | ○ | V (visibilité restreinte à ses clients assignés) | ○ | ○ |
| Prospection / Pipeline | V | ○ | ○ | ○ | ○ | ○ | ○ | V | ○ |
| Planning | V | V | V (planning production) | ○ | ○ | ○ | ○ | ○ | V (son planning) |
| Réservations clubs | V | V | ○ | ○ | ○ | ○ | ○ | V | ○ |
| Paiement collectif (cotisations) | V | V | ○ | V | ○ | ○ | ○ | ○ | ○ |
| Demandes Club+ (modale) | V | V | ○ | ○ | ○ | ○ | ○ | V | ○ |
| Comptes Club+ / Connect | V | V | ○ | ○ | ○ | ○ | ○ | V | ○ |
| Collaborateurs (fiches RH) | V/C/É | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Utilisateurs & accès | V/C/É | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Grades & XP | V/Val (réservé admin **et** photo par contrôle JS explicite, cf. code) | ○ | ○ | ○ | ○ | ○ | ○ | ○ | V (sa progression) |
| Centre de formation | V/C (admin gère le catalogue) | V (suit sa formation) | V | ○ | ○ | ○ | V | V | V |
| Kits / matériel | V/C/É | ○ | V/C/É | ○ | ○ | ○ | ○ | ○ | V (ses réservations) |
| Incidents | V/C | ○ | V/C | ○ | ○ | ○ | ○ | ○ | ○ |
| Finances (vue globale) | V | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Compte de résultat | V/Exp | ○ | ○ | V/Exp | V (lecture) | V (lecture) | ○ | ○ | ○ |
| Rentabilité | V | ○ | ○ | V | V | V | ○ | ○ | ○ |
| Commissions | V | ○ | ○ | V | V | ○ | ○ | V (les siennes uniquement) | ○ |
| Immobilisations | V | ○ | ○ | V | V | V | ○ | ○ | ○ |
| Budgets & prévisions | V | ○ | ○ | V | V | V | ○ | ○ | ○ |
| TVA & provisions | V | ○ | ○ | V | V | V | ○ | ○ | ○ |
| Rapprochement | V | ○ | ○ | V | ○ | ○ | ○ | ○ | ○ |
| Factures | V/C | ○ | ○ | V/C | V (lecture) | V (lecture) | ○ | ○ | ○ |
| Acomptes | V | ○ | ○ | V | ○ | ○ | ○ | ○ | ○ |
| Impayés | V | ○ | ○ | V | ○ | ○ | ○ | ○ | ○ |
| Avoirs & remises | V/C | ○ | ○ | V/C | V (lecture) | V (lecture) | ○ | ○ | ○ |
| Encaissements Stripe | V | ○ | ○ | V | ○ | ○ | ○ | ○ | ○ |
| Dépenses | V | ○ | ○ | V | V (lecture) | V (lecture) | ○ | ○ | ○ |
| Frais & km | V | ○ | V/C (déclare ses frais) | V | V (lecture) | V (lecture) | ○ | ○ | ○ |
| Paiements équipe | V | ○ | ○ | V | ○ | ○ | ○ | ○ | ○ |
| Rémunérations | V (**canSeePaie=admin/compta uniquement**, y compris dans la fiche collaborateur — voir note sécurité ci-dessous) | ○ (accès RLS lecture/écriture à `prestations_equipe` pour affecter, mais montants masqués côté UI) | ○ (masqué) | V | V (lecture) | V (lecture) | ○ | ○ | ○ (voit sa propre rémunération via "Mes revenus") |
| Clôtures mensuelles | V/Val | ○ | ○ | V/Val | V (lecture) | V (lecture) | ○ | ○ | ○ |
| Exports comptables / FEC | V/Exp | ○ | ○ | V/Exp | V/Exp | ○ | ○ | ○ | ○ |
| Journal d'audit | V | ○ | ○ | V | V (lecture) | V (lecture) | ○ | ○ | ○ |
| Documents (centre documentaire) | V | V | ○ | V | V | ○ | ○ | ○ | ○ |
| Annuaire équipe | V | V | V | V | ○ (non présent dans sa nav) | ○ | V | V | V |
| Messagerie interne | V | V | V | V | ○ | ○ | V | V | ○ (non présent dans sa nav) |
| Mon équipe (en direct) | V | ○ | V | ○ | ○ | ○ | ○ | ○ | ○ |
| Intégrations | V/C/É | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Agences CM | V/É | V/É | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Contenus / éditorial | ○ | ○ | ○ | ○ | ○ | ○ | V/C/É/Val | ○ | ○ |
| Publications | ○ | ○ | ○ | ○ | ○ | ○ | V/C | ○ | ○ |
| Analytics contenu | ○ | ○ | ○ | ○ | ○ | ○ | V | ○ | ○ |
| Médias (liens/rushs) | V (via prestation) | ○ | V/C/É | ○ | ○ | ○ | ○ | ○ | V/C (upload) |
| Postproduction | V | ○ | V/Val | ○ | ○ | ○ | ○ | ○ | V (ses versions) |
| Livrables | V | V (peut marquer livré, voir note ci-dessous) | V/Val | ○ | ○ | ○ | ○ | ○ | ○ |

### Notes de sécurité issues de l'analyse du code (pas de la spéculation)

- **Rémunération/paie** : `employee_costs` (salaire brut, charges patronales) est réservée admin/compta par un contrôle JS explicite (`canSeePaie`). Le code lui-même documente un **risque résiduel assumé** : `sec` a un accès RLS légitime en lecture/écriture à `prestations_equipe` (pour affecter les équipes) et pourrait donc, via un appel API direct (hors interface), lire la colonne `remuneration` que l'UI lui masque — la RLS ne permet pas de restreindre une seule colonne par ligne. Ce n'est pas un bug caché : c'est écrit noir sur blanc dans le code comme limite connue.
- **Livraison de contenu** : le bouton "Marquer livrée" sur l'écran Livrables est ouvert à `admin`, `prod` **et `sec`** (pas seulement production) — à confirmer que c'est le comportement métier voulu (secrétaire habilitée à livrer un contenu client) plutôt qu'un oubli de restriction.
- **Client CM** : le rôle `cm` a une visibilité restreinte à ses propres clients assignés (`cm_id`) ou, si un contrat Full Communication existe, aux clients rattachés à ce contrat — logique conditionnelle plus fine qu'un simple accès binaire, voir `_cmVisibleClients()` dans le code.
- **Cotisations (paiement collectif)** : le code documente lui-même une **dépendance RLS non résolue** — sans une policy staff explicite sur `group_fundings`/`funding_contributions`/`user_groups`, l'écran affichera "Aucune cotisation" pour tout le monde (y compris admin) même si des données existent réellement, sans erreur visible. À vérifier en base réelle si cette policy a été ajoutée depuis.

### Ce que cette matrice NE couvre PAS

Elle documente le contrôle d'accès **frontend** (ce que l'interface montre/cache par rôle). Elle ne remplace pas un audit RLS direct — voir § 58 de `SPORTVISION_OS_AUDIT_PACK.md` pour les policies Postgres réelles, qui sont la vraie barrière de sécurité en cas de contournement de l'interface (appel API direct, extension navigateur, etc.).
