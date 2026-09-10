# Dette V1.1 — Normalisation des relations d'équipe vers `team_id`

**Statut** : ouverte · priorité V1.1 · **ne bloque pas le lancement multi-clubs**
**Décidée par** : Fouka, 10/09/2026
**Origine** : incident mesuré en production le 10/09/2026, corrigé en palliatif par la migration v113

---

## Le problème

Une équipe est désignée à plusieurs endroits par son **nom**, pas par son identifiant. Le cas qui
compte : `club_members.teams`, dont dépendent les droits d'un éducateur.

`is_team_educateur` compare ce nom à la lettre près :

```sql
cm.teams @> to_jsonb(ct.name::text)
```

Mesuré le 10/09/2026, avant correction : un coach rattaché à « Séniors R2 » passait de **28 matchs
visibles à 0** dès que le CM renommait son équipe en « Séniors R2 Élite ». Aucune erreur, aucun
message.

## Ce qui tient aujourd'hui (palliatif V1)

La migration **v113** rend le renommage sûr sans supprimer la cause :

1. **Unicité du nom par club** — trigger `verifier_unicite_nom_equipe` + index
   `club_teams_nom_unique_par_club`. Deux équipes homonymes donneraient au même coach l'accès aux
   deux.
2. **Propagation transactionnelle** — trigger `propager_renommage_equipe`. Renommer une équipe met
   à jour, dans **la même transaction**, toutes les références nominales listées ci-dessous.

⚠ **Ces deux garde-fous sont obligatoires tant qu'une seule référence nominale subsiste.** Les
retirer avant la fin de la migration recréerait l'incident.

Test permanent : **`tests/renommage-equipe.test.sql`** — il porte un contrôle de vitalité du décor,
et il **vire au rouge** si le trigger de propagation disparaît (vérifié en le neutralisant).

## Inventaire des 12 colonnes concernées

| Table | Colonne | Type | `team_id` à côté ? | Couverte par v113 |
|---|---|---|---|---|
| `club_members` | `teams` | jsonb | non | ✅ **critique — porte les droits** |
| `club_invitations` | `teams` | jsonb | non | ✅ |
| `club_sponsors` | `teams` | jsonb | non | ✅ |
| `club_matches` | `team` | text | **oui** | ✅ (suit `team_id` quand il est posé) |
| `club_calendar_events` | `team` | text | **oui** | ✅ (suit `team_id` quand il est posé) |
| `club_bookings` | `team` | text | **oui** | ✅ (suit `team_id` quand il est posé) |
| `club_creations` | `team` | text | non | ✅ |
| `club_media` | `team` | text | non | ✅ |
| `club_newsroom_items` | `team` | text | non | ✅ |
| `club_requests` | `team` | text | non | ✅ |
| `planned_presences` | `equipe` | text | non | ✅ (rattachée par le match ou l'événement) |
| `connect_declared_club_players` | `team` | text | non | ❌ **pas de `club_id`** — vide au 10/09/2026 |

Et ce qui **lit** ces noms :

- fonctions : `is_team_educateur`, `is_real_team_educateur`
- policies : `club_calendar_events.ccal_family_select`, `club_calendar_events.ccal_player_select`,
  `club_matches.cma_family_select`

## Démarche proposée pour V1.1

Progressive, avec compatibilité transitoire — **pas de bascule en un bloc**.

1. **Ajouter** une colonne `team_ids uuid[]` (ou `team_id uuid`) à côté de chaque colonne
   nominale. Ne rien retirer.
2. **Remplir** depuis le nom, par jointure sur `club_teams (club_id, name)` — l'unicité posée par
   v113 garantit une correspondance sans ambiguïté.
3. **Écrire les deux** pendant la transition : tout code qui écrit un nom écrit aussi l'identifiant.
4. **Basculer les lecteurs** un par un — `is_team_educateur` en premier, puisqu'il porte les droits.
   Chaque bascule accompagnée de son test.
5. **Retirer** les colonnes nominales seulement quand plus aucun lecteur ne les utilise — et alors
   seulement, retirer les triggers de v113.

`connect_declared_club_players` demande une décision à part : sans `club_id`, rien ne permet de
rattacher une de ses lignes à un club sans deviner.

## Ce qui NE fait PAS partie de cette dette

Les permissions. Le chantier « Permissions CM / Club V1 » est fermé ; cette dette concerne la forme
des données, pas qui a le droit de quoi.
