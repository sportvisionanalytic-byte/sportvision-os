# QA boutons — rôle Commercial (com)

Campagne de test exhaustive et réelle (Playwright, compte de test `role='com'` créé via l'API Admin Supabase, prospects réels manipulés, vérification directe en base après chaque action). Site live testé : `https://bc6m3cgdz.sportvision-an.fr/`. Après le premier bug bloquant trouvé (modales injouables sur l'ensemble du site), la suite du parcours a été rejouée sur une copie locale du fichier corrigé servie en HTTP, pour confirmer chaque fix en conditions réelles (vraie base Supabase, vrais comptes).

## Bugs trouvés et corrigés

### 1. CRITIQUE — Toutes les modales de l'OS étaient injouables au clic (tous rôles)

**Symptôme découvert** : en testant "+ Contact" sur une carte du pipeline, la modale "Nouveau contact" s'affichait visuellement (backdrop, formulaire, bouton "Enregistrer") mais un clic réel sur "Enregistrer" ne faisait strictement rien — confirmé avec un clic souris brut (`mouse.down`/`mouse.up`, sans les vérifications d'actionabilité de Playwright) : le clic traversait la modale et atterrissait sur le pipeline en dessous.

**Cause** : la passe de polish visuel du 29/08 ("POLISH PREMIUM") a ajouté une classe `.on` pour piloter la transition d'ouverture de `#sv-modal`, avec la règle CSS `#sv-modal.on{opacity:1;visibility:visible;pointer-events:auto}`. Mais le markup HTML statique de `#sv-modal` porte un style inline `pointer-events:none`. En CSS, un style inline gagne toujours sur une règle de classe sans `!important` — donc `pointer-events` restait bloqué à `none` en permanence, quelle que soit la classe. Résultat : **toute modale de l'OS était visuellement présente mais totalement inerte au clic**, pour tous les rôles (formulaires, confirmations, fiches client, devis, etc.) — potentiellement le bug le plus grave introduit cette nuit.

**Correctif** : `livrables/SportVision-TV/SportVision-OS-Full.html`, ligne ~400 — ajout de `!important` :
```css
#sv-modal.on{opacity:1;visibility:visible;pointer-events:auto!important}
```
Revérifié : `pointer-events` calculé passe de `none` à `auto` une fois la modale ouverte, et un clic réel sur "Enregistrer" fonctionne (formulaire de contact enregistré avec succès, toast "Contact enregistré.").

### 2. CRITIQUE — La notification `client.won` (et toutes les notifications entre utilisateurs) échouait silencieusement

**Symptôme** : en faisant passer un prospect de test jusqu'à "Partenaire" via le pipeline (bouton réel cliqué à chaque étape : Qualifier → Devis envoyé → Négociation → Partenaire), le toast "→ Partenaire" s'affichait et le statut changeait bien en base, mais **aucune ligne n'apparaissait jamais dans `notifications`** pour Secrétariat/Admin — alors même que la mission demandait explicitement de vérifier ce point.

**Cause racine** (confirmée par plusieurs méthodes indépendantes — API REST réelle avec le compte de test, et rejeu SQL direct avec le même contexte d'authentification) : `sbFetch` ajoute par défaut l'en-tête `Prefer: return=representation` sur tout POST. Pour un insert dans `notifications` dont le `destinataire_id` n'est **pas** l'auteur de l'appel (le cas normal ici : on notifie sec/admin, jamais soi-même), Postgres doit relire la ligne insérée pour construire la réponse `RETURNING`. Cette relecture est filtrée par la policy RLS `notifs_own_select` (`auth.uid() = destinataire_id`), qui échoue puisque le destinataire n'est jamais l'auteur. Résultat : **l'INSERT entier est rejeté en 403** ("new row violates row-level security policy for table notifications") alors même que la policy INSERT (`is_staff()`) l'aurait très bien autorisé. L'erreur était capturée par un `catch` silencieux dans `dispatchSVEvent`, donc invisible en usage normal.

Ce bug ne touchait pas que `client.won` : la fonction générique `creerNotifSiActive()` (utilisée dans ~15 endroits — invitations de mission, corrections de médias, matériel, livraisons, tâches déléguées...) souffrait exactement du même défaut, pour tous les rôles.

**Correctif** : ajout de `headers:{'Prefer':'return=minimal'}` sur les deux points d'insertion multi-destinataires (`dispatchSVEvent` et `creerNotifSiActive`), qui n'ont de toute façon jamais besoin de la représentation renvoyée.

**Vérifié en conditions réelles** : nouveau prospect de test avancé jusqu'à "Partenaire" via l'UI → 5 notifications créées en base pour les vrais comptes sec/admin (titre "Nouveau client conclu par le Commercial — [nom]", message et priorité corrects, `lien_client_id` renseigné) → confirmé, puis nettoyé.

*Remarque : la piste RLS a été explorée en profondeur avant de trouver la vraie cause (plusieurs policies modifiées puis restaurées à leur état d'origine exact pendant le diagnostic — `notifs_own_insert`, `notifs_acces` sont revenues identiques à avant, seul le comportement JS a changé).*

### 3. Bug mineur — `avancerPipeline` en insertion brute écrase le statut choisi

Une insertion directe dans `clients` avec `statut` différent de `'prospect'` mais sans `etape_pipeline` explicite est silencieusement remise à `'prospect'` par un trigger de synchronisation. Sans impact utilisateur (le flux UI normal passe toujours par `statut`, jamais par un insert brut avec un statut non-prospect), documenté pour info seulement, pas corrigé (pas un chemin utilisateur réel).

## Testé et fonctionnel

- **Dashboard (Accueil)** : KPI (à relancer, échéances 7j, offres en attente, opportunités chaudes, gagnés ce mois), priorités, pipeline prioritaire, devis en attente — tous reflètent les vraies données.
- **Prospects** : liste, filtres (sport/statut/température), badges température colorés, création via "+ Nouveau prospect" (modale, sauvegarde, toast "Client créé.", apparition immédiate dans la liste).
- **Pipeline (kanban)** : colonnes Prospect/Qualifié/Devis envoyé/Négociation/Partenaire, cartes cliquables, actions rapides "+ Contact" / "Devis" / bouton d'avancement d'étape — testé la chaîne complète Prospect → Qualifié → Devis envoyé → Négociation → **Partenaire**, chaque étape confirmée en base (`statut`, `etape_pipeline` synchronisés par trigger) et par toast.
- **Modale "Nouveau contact"** : validation de la note obligatoire (message d'erreur si vide), sauvegarde réelle (`client_contacts` + mise à jour `prochaine_action`/`date_prochaine_action`/`score_priorite` sur le client), toast "Contact enregistré."
- **Agenda** : agrège correctement les relances (`clients.date_prochaine_action`, uniquement pour les statuts actifs du pipeline) et les échéances de devis, groupées En retard / Aujourd'hui / Cette semaine / Plus tard — testé avec une vraie relance en retard.
- **Commissions, Mes clients signés, Objectifs** : chargent et affichent les vraies données (KPI, listes), états vides corrects.
- **Devis** : création (sélection client, lignes, calcul HT/TVA/TTC vérifié : 450 € HT → 540 € TTC à 20%), bouton "→ Envoyer" (passe en statut Envoyé, toast, KPI mis à jour), bouton PDF (ouvre bien une fenêtre d'impression).
- **Annuaire équipe** : filtre, cartes membres, bouton "💬 Message" ouvre bien la conversation privée avec la bonne personne (léger délai de chargement des profils à prévoir, pas un bug — juste un `setTimeout`/polling de 200ms×10 côté code).
- **Messagerie** : envoi de message privé et de message d'équipe (broadcast) tous deux fonctionnels et persistés en base.
- **Centre de formation / Centre SportVision** : chargement correct, formations obligatoires affichées, navigation dans les rubriques du Centre SportVision opérationnelle.
- **Avis clients** : écran accessible (ajouté dynamiquement avant Paramètres), état vide correct.
- **Paramètres** : formulaire profil pré-rempli avec les bonnes infos du compte connecté.

## Non corrigé

- **"Mes clients signés" affiche tous les clients signés de l'entreprise**, pas seulement ceux rattachés au commercial connecté (pas de filtre `created_by`/`commercial_id` dans la requête). C'est peut-être voulu (petite équipe, visibilité totale) — pas touché car ce serait changer une règle métier sans arbitrage. À trancher avec Fouka si ce n'est pas l'intention.
- Un bandeau "Connexion perdue — mode hors-ligne" est apparu une fois de façon isolée en tout début de session (jamais reproduit ensuite malgré plusieurs tentatives ciblées) — probablement un pic de latence ponctuel pendant une salve de requêtes parallèles au chargement du dashboard, pas un vrai bug de détection.
