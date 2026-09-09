# Module Opérateurs — V1 stable / observation production

**Gelé le 09/09/2026.** Pas de refactor, pas de nouvelle fonctionnalité pendant les premières
vraies prestations. Seule exception : un bug P0 ou P1.

La suite est décidée par le retour terrain, pas par une nouvelle liste de fonctionnalités.

---

## Ce que couvre la V1

```
Mission proposée → Acceptation → Préparation → Kit → Jour J → Prestation réalisée
→ Sécurisation → Post-production → Livraison → Validation Production
→ Correction éventuelle → Matériel → Mission terminée → Notifications
```

## Les garde-fous sont en base, pas dans l'interface

C'est le point qui rend la V1 solide : un écran qui grise un bouton n'empêche rien.

| Règle | Où elle vit | Migration |
|---|---|---|
| Un opérateur ne touche que les livraisons de ses missions | policy RESTRICTIVE `operateur_perim_media_liens` | v1 |
| Une carte n'est libérable qu'après sécurisation **et** transfert confirmé | déclencheur `proteger_liberation_cartes` | v3 |
| « Mission terminée » exige les vrais livrables de la couverture | `mission_cloture_manquant()` + `proteger_cloture_mission` | v4 |
| Le SIRET reste hors de portée du CM | `proteger_identite_legale_club` | cm-v10 |
| Un rappel ne part qu'une fois par fenêtre | `notifications.cle_occurrence` + index unique | v5 |
| Les événements notifient depuis la base | déclencheurs sur `media_liens`, `incidents`, `prestations_equipe` | v6 |

## Source unique de classement

`v_production_missions` décide du groupe d'une mission. Le frontend ne teste jamais un statut
pour choisir une file, et les compteurs sortent de la même requête que les listes.

**Aucun statut nouveau n'a été créé** : `statut_prestation` traduisait déjà toute la timeline.

## Tests

| Suite | Portée |
|---|---|
| `operateur-livraisons-cloisonnement.test.sql` | deux opérateurs réels, aucune fuite croisée |
| `operateur-cartes-sd.test.sql` | la règle carte SD, en appel direct |
| `mission-cloture.test.sql` | 6 scénarios de clôture selon la couverture |
| `notifications-operateur.test.sql` | 16 scénarios, dont l'anti-spam |
| `os-parcours-operateur.test.mjs` | badges, checklists, Guide terrain |
| `os-cockpit-390.test.mjs` | cockpit à 390 px, cibles tactiles |

Chaque protection a été **vérifiée rouge puis verte** : retirée, le test la signale.

---

## Le seul test qui reste : une vraie prestation

Pas 150 tests de plus. Une mission réelle, avec un vrai photographe, de bout en bout.

### Ce que l'opérateur doit réellement faire

- [ ] recevoir la mission et l'accepter
- [ ] préparer son kit depuis la checklist
- [ ] utiliser le Mode Jour J sur le terrain
- [ ] déclarer « Prestation réalisée »
- [ ] sauvegarder de vraies photos ou vidéos
- [ ] passer par Lightroom ou le montage
- [ ] transmettre de vrais liens
- [ ] faire valider par Production
- [ ] régler le kit (rendu ou conservé)
- [ ] atteindre « Mission terminée »
- [ ] ne recevoir que des notifications pertinentes

### Ce que Production doit vérifier

Une mission doit traverser proprement les sept files :

`En attente → À venir → Sur le terrain → Post-production → À vérifier → Corrections → Terminées`

Si une mission passe proprement dans tout ce circuit, le chantier est officiellement fermé.

---

## Le débrief, à faire avec le photographe juste après

Cinq questions, et ce sont elles qui décideront de la V1.1 :

1. Qu'est-ce qui t'a ralenti ?
2. Qu'est-ce que tu n'as pas compris ?
3. Quelle étape tu as failli oublier ?
4. Quel bouton tu as cherché ?
5. Quelle notification était inutile ?

## Et après quelques semaines d'usage

Décider objectivement, sur des données réelles et pas sur une intuition :

- quelles notifications sont ouvertes ;
- lesquelles provoquent une action ;
- lesquelles sont ignorées ;
- lesquelles méritent réellement un e-mail ;
- lesquelles doivent être supprimées ou espacées.

**Pas de push mobile, pas de nouvel e-mail avant cette mesure.** Tout reste en notification OS.
