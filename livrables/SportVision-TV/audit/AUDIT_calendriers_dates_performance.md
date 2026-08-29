# Audit calendriers, dates, timezone + performance requêtes

Date : nuit du 29/08/2026 · Fichier audité : `livrables/SportVision-TV/SportVision-OS-Full.html` (~32 140 lignes)
Méthode : lecture exhaustive de toutes les manipulations de date (`new Date(`, `.toISOString()`, `.toLocaleDateString()`), vérification du schéma réel des colonnes en base (`date` vs `timestamptz`) via l'API Supabase, test en conditions réelles (création → modification → suppression d'une mission de test à cheval sur le changement d'heure été/hiver du 25/10/2026), puis nettoyage des données de test.

---

## Corrigé

### 1. Bug systémique — les agrégations "mois courant" reculaient toujours d'un mois
**Cause :** le pattern `new Date(année, mois, 1).toISOString().slice(0,7)` construit une date locale au 1er du mois à minuit, puis la convertit en UTC. La France étant toujours en avance sur UTC (+1h hiver / +2h été), minuit local le 1er tombe systématiquement le dernier jour du mois précédent en UTC — **ce n'est pas un cas limite, c'est un décalage permanent, à chaque appel**.

Vérifié concrètement (Node, `TZ=Europe/Paris`) :
```
targetDate = 1er août 2026 00:00 locale
targetDate.toISOString()        → "2026-07-31T22:00:00.000Z"
targetDate.toISOString().slice(0,7) → "2026-07"   ❌ (devrait être "2026-08")
```

**Impact réel le plus grave — Rapport mensuel (Admin › Rapports) :** `loadRapport()` et `exportRapportCSV()` (lignes ~28664-28779) calculaient `mStart` avec ce pattern. Le "rapport d'août" interrogeait en réalité `date_prestation >= 2026-07-01` (au lieu de `2026-08-01`) jusqu'à `2026-08-31` : **le rapport mensuel incluait silencieusement tout le mois précédent en plus**, faussant CA, nombre de prestations et nouveaux clients affichés. Le nom du fichier CSV exporté était aussi faux (`rapport-2026-07.csv` pour un rapport d'août).

Autres emplacements touchés par le même pattern, corrigés en remplaçant `d.toISOString().slice(0,7)` par `ymdLocal(d).slice(0,7)` :
- Mini-graphique "6 derniers mois" des revenus collaborateur (L15914/15920) : les valeurs affichées sous le label "août" étaient en fait celles de juillet (clé de lookup décalée), et le mois courant n'était jamais surligné dans le graphique.
- Analyse prévisionnelle compta — run-rate 3 mois (L22892).
- Mini-graphique CA 6 mois — écran Finances (L25889).
- CM Planning hebdo — comptage "publié ce mois" élargi à tort à 2 mois (L20163).
- Compta Dépenses / Compta Équipe — mois courant pour filtrer les totaux (L26129, L26224).
- Valeurs par défaut des sélecteurs `<input type="month">` (Compta rapprochement, CM Rapports clients) — corrigées en `ymdLocal().slice(0,7)`.

### 2. "Aujourd'hui" calculé en UTC brut au lieu de l'heure locale
Pattern `new Date().toISOString().split('T')[0]` : entre minuit et ~1h-2h du matin heure de Paris, ceci renvoie encore la date de la **veille**. Corrigé en `ymdLocal()` (helper déjà existant et documenté dans le fichier) à 5 endroits :
- Disponibilité collaborateur (`submitDisponibiliteSousConditions`, `setDisponibilite`) — un collaborateur se déclarant "indisponible" entre minuit et 2h du matin enregistrait la disponibilité sur la mauvaise date (la veille), invisible pour la prod qui planifie sur la vraie date du jour.
- Date d'envoi par défaut lors de la livraison de médias.
- "Mon équipe" (`loadEquipeEnDirect`) — filtre des missions et disponibilités "du jour" pour la vue Admin/Prod.

### 3. Comparaisons "en retard" incohérentes (Date-avec-heure vs colonne `date` sans heure)
Vérifié via le schéma réel (`factures.date_echeance`, `contrats.date_fin` = colonnes `date`, sans heure). Comparer `new Date(date_only) < new Date()` (qui embarque l'heure courante) déclare l'échéance "dépassée" dès ~1h-2h du matin **le jour même de l'échéance**, pas seulement le lendemain.

- **Impayés (`isEnRetard`, L22131-22146)** : une facture devenait "en retard" (highlight rouge + badge) dès potentiellement 2h du matin le jour de son échéance. Corrigé en comparant des chaînes `'YYYY-MM-DD'` (`f.date_echeance < ymdLocal()`), cohérent avec le pattern déjà utilisé correctement dans l'Agenda commercial.
- **Contrats/Abonnements — "expire bientôt" (L28804-28806) — bug réel confirmé et le plus visible :** `new Date(c.date_fin) >= now` excluait de la liste "expire bientôt" tout contrat se terminant **le jour même**, dès potentiellement 2h du matin (minuit UTC de `date_fin` < l'instant présent). Un contrat Club+/Full Com expirant aujourd'hui disparaissait donc de son propre rappel de renouvellement pour le reste de la journée. Corrigé en comparaison de chaînes.
- Même correctif appliqué à l'écran Abonnements (KPI "à renouveler", L24222-24233) pour cohérence.

### 4. Re-fetch réseau inutile — Planning secrétaire/admin
`setPlanningView('cal'|'list')` (bascule d'affichage Calendrier ↔ Liste) déclenchait `loadPlanning()`, qui relançait systématiquement le `sbFetch` complet des prestations du mois — alors que la bascule ne change ni le mois ni les données, seulement le rendu. Ajout d'un cache par mois (`_planningRawData` / `_planningRawKey`) : la bascule de vue réutilise désormais les données déjà chargées, seul un changement de mois (`planningPrev`/`planningNext`) redéclenche une requête réseau.

### 5. Test réel création → modification → suppression (cycle calendrier)
Mission de test créée (réf. `TEST-AUDIT-CAL-DST`) au 25/10/2026 — jour exact du changement d'heure été→hiver en France — puis modifiée au 02/11/2026, puis supprimée, en vérifiant `v_calendar_global` (vue SQL derrière `admin.calglobal`) à chaque étape :
- Création : `starts_at` = `2026-10-24 22:00:00+00` pour le 25/10 00:00 Paris (encore en heure d'été CEST +2 avant le basculement à 3h) — correct.
- Modification : une seule ligne retournée pour la mission (pas de doublon à l'ancienne date), `starts_at` recalculé en heure d'hiver (CET +1) — correct, le calcul SQL (`AT TIME ZONE 'Europe/Paris'`) gère nativement le changement d'heure, contrairement à une arithmétique en millisecondes côté JS.
- Suppression : la ligne disparaît immédiatement de la vue.
- Conclusion : `admin.calglobal` est une vue SQL calculée à la volée (pas de table synchronisée) — **aucun risque de doublon ou d'événement orphelin** lors du cycle création/modification/suppression d'une mission.

### 6. Harmonisation `date_prestation` (colonne `date`)
52 emplacements affichant `p.date_prestation` via `new Date(p.date_prestation).toLocaleDateString(...)` sans le correctif `+'T12:00:00'` déjà utilisé à 5 autres endroits du fichier (pattern introduit lors de l'audit du 11/08, documenté en L3177-3195). Harmonisé partout — voir section "Non modifié volontairement" pour le détail de pourquoi ce sens précis n'est pas un bug visible pour un navigateur réglé sur Europe/Paris, mais reste une bonne pratique défensive.

---

## Amélioré

- Écrans Calendrier global (`admin.calglobal`), Planning Production (`admin.planning`/`prod.planning`), Planning CM (`cm.planning`), Agenda Commercial (`com.agenda`), Agenda Secrétaire (`sec.agenda`) : audit complet de leurs fonctions de chargement — toutes utilisent déjà des requêtes uniques avec jointures (`clients(nom)`, `prestations_equipe(...)`), des plages de dates bornées, `Promise.all` pour paralléliser, et des requêtes `in.(...)` batchées plutôt que des boucles de fetch par ligne. **Aucun N+1 trouvé dans les 5 écrans calendrier ciblés par cette mission.**
- Le calcul SQL de `v_calendar_global` (`AT TIME ZONE 'Europe/Paris'`) est nativement DST-safe — confirmé par le test réel ci-dessus.

---

## À surveiller

- **Champs `date` restants non harmonisés avec `+'T12:00:00'`** : `contrats.date_debut/date_fin`, `devis.date_envoi/date_expiration/date_acceptation`, `factures.date_emission/date_echeance`, `contenus.date_prevue/date_publication`, `frais.date_frais`, `commissions.date_calcul/date_paiement`, `expenses.date_depense/date_prochaine_echeance`, `clients.date_prochaine_action` — affichés via `new Date(champ).toLocaleDateString('fr-FR')` sans le padding. **Vérifié que ce sens précis (UTC→local Paris) ne cause pas de décalage visible** pour un navigateur réglé sur Europe/Paris (Paris est toujours en avance sur UTC, jamais en retard), donc pas de bug utilisateur confirmé aujourd'hui. Non corrigé par prudence : plusieurs de ces affichages passent par un helper local `fd(s)`/`fmtD(s)` redéfini à ~20 endroits différents et parfois partagé avec des colonnes `timestamptz` (`created_at`, `envoye_at`...) dans la même fonction — ajouter `+'T12:00:00'` à l'aveugle sur un `fd()` partagé aurait un risque réel de corrompre l'affichage d'un timestamp complet (chaîne invalide type `"...+00:00T12:00:00"`). Un futur passage devrait normaliser à la source (au moment du `sbFetch`/mapping) plutôt qu'au rendu.
- **`renderFinEquipe`/`_fineqCache` (Compta Équipe, L26191-26206)** : agrège dans un même tableau `date:m.date_paiement` (mission → `prestations_equipe.date_paiement`, en réalité `timestamptz`), `date:f.date_frais` (`date`) et `date:c.date_paiement||c.date_calcul` (`date`) — trois types de colonnes différents affichés par le même `new Date(x.date).toLocaleDateString()`. Non corrigé au rendu pour la même raison que ci-dessus (mélange de types) ; à normaliser à la source si un décalage est un jour signalé.
- **Requêtes `clients?select=id,nom&order=nom...` sans `limit=`** (dropdowns de sélection client dans devis/rapports/formulaires, ~10 emplacements) : non plafonnées volontairement — voir "Non modifié volontairement". À surveiller si le nombre de clients dépasse quelques centaines (ajouter une recherche côté serveur plutôt qu'un `limit`).
- **Compteurs de notifications non lues** (`notifications?select=id&lue=eq.false&...`, sans `limit=`, ~4 emplacements) : ne posent pas de problème tant que le volume de non-lues reste faible (cas normal), mais pourraient être remplacés par un `HEAD`+`count=exact` si le volume grossissait beaucoup.
- **`creerTachesAuto`/`dispatchSVEvent`** (notifications automatiques déclenchées par des événements métier — devis accepté, prestation confirmée, etc.) : boucle séquentielle `for(const t of tasks){ await sbFetch(...) }` au lieu de `Promise.all`. N petit (1 à 3 rôles par workflow) et déclenché par événement (pas au rendu d'une liste), donc impact perf négligeable en pratique — non corrigé, optimisation mineure possible.

---

## Action externe nécessaire

Aucune. Toutes les corrections sont des changements de logique JS pure, vérifiées par `node --check` et par des tests réels contre la base Supabase (données de test créées puis supprimées). Aucune migration SQL, aucun credential manquant, aucune décision produit ambiguë n'a été nécessaire pour ce lot.

---

## Non modifié volontairement

- **Calcul d'expiration de devis** (`new Date(new Date(envoi).getTime()+validite*86400000).toISOString().slice(0,10)`, L15140) : vérifié mathématiquement correct — toute l'arithmétique se fait en UTC de bout en bout (parse UTC minuit → ajout d'un nombre entier de jours en ms → lecture UTC), donc cohérente quel que soit le fuseau du navigateur. Pas touché.
- **Sens UTC→local des colonnes `date`** (`new Date('YYYY-MM-DD').toLocaleDateString('fr-FR')`) : la France étant toujours en avance sur UTC, ce sens ne recule jamais d'un jour pour un navigateur réglé sur Europe/Paris — contrairement au sens local→UTC (`.toISOString()` sur une Date locale), qui lui recule systématiquement (cf. section Corrigé #1). La harmonisation `date_prestation` (52 sites) a été faite par cohérence de code et défense contre un navigateur mal configuré (collaborateur en déplacement, VPN, OS mal réglé), pas parce qu'un décalage a été observé dans ce sens précis pour un utilisateur basé en France.
- **Dropdowns clients sans `limit=`** : volontairement non plafonnés — un formulaire de devis/rapport doit pouvoir proposer n'importe quel client existant, pas seulement les N premiers par ordre alphabétique. Ajouter un `limit` casserait la sélection pour les clients situés après la coupure. Une vraie pagination/recherche serait nécessaire si le volume grossit, ce n'est pas un simple `limit` à ajouter — décision produit hors périmètre de cet audit.

---

## Données de test créées puis nettoyées

- 1 prestation de test (`reference = 'TEST-AUDIT-CAL-DST'`, client existant réutilisé) créée le 25/10/2026, modifiée au 02/11/2026, puis **supprimée** en fin de test. Aucune trace résiduelle en base (vérifié).
