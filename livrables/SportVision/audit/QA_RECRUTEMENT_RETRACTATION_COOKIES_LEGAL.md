# QA fonctionnelle — Recrutement / Rétractation / Cookies / Pages légales

Campagne QA fonctionnelle (pas seulement visuelle), une parmi 4 lancées en parallèle sur des périmètres disjoints. Périmètre de cette campagne :
- `recrutement-photographe-videaste.html` + `recrutement-community-manager.html` (formulaire de candidature)
- `retractation.html` (formulaire de rétractation)
- Bandeau cookies (`#cookie-banner`), testé sur `index.html`, `recrutement-photographe-videaste.html`, `cgv.html`, `retractation.html`
- `cgv.html`, `confidentialite.html`, `cookies.html`, `mentions-legales.html` (liens internes + rendu mobile)

Méthode : serveur statique local (`python3 -m http.server`) servant les fichiers du worktree tels quels, piloté par Playwright (Chromium) — clics, saisies, sélections, upload de fichier réels, jamais `page.evaluate()`. Les appels réseau visent le vrai backend Supabase (`lulgezzpvrlbftbykzrc`) : les soumissions de formulaires sont donc de vraies écritures en base, nettoyées après vérification (voir § 4).

---

## 1. Résultat en un coup d'œil

| Zone | Statut |
|---|---|
| Recrutement — soumission réelle (2 pages, CV inclus) | OK après correction (voir § 2) |
| Recrutement — validation champs requis / format e-mail | Bug trouvé et corrigé |
| Recrutement — honeypot | OK, ne bloque pas un humain, bloque bien un bot |
| Recrutement — champ `source` en base | Bug trouvé et corrigé (edge function) |
| Rétractation — soumission réelle, validation, honeypot | OK, aucun bug |
| Bandeau cookies — 4 pages, persistance, "Gérer mes cookies" | OK, aucun bug |
| Pages légales — liens internes, ancres, rendu mobile | OK, aucun lien cassé |

---

## 2. Bugs trouvés et corrigés

### P1 — Validation e-mail manquante côté client sur les 2 formulaires de recrutement
Les deux formulaires (`#candidature-form`) sont en `novalidate`, ce qui désactive la validation native du navigateur pour `type="email"`. Contrairement à `retractation.html` (déjà corrigé lors d'un audit du 30/08, cf. commentaire dans son propre code), les pages de recrutement n'avaient **aucun** contrôle de format e-mail côté client : une adresse invalide (`pas-un-email`) passait le contrôle "champs obligatoires" (le champ est non-vide) et partait en requête réseau vers `submit-recruitment-application`, qui la rejetait côté serveur (400 "Adresse e-mail invalide"). Fonctionnellement pas cassé (l'utilisateur voyait bien une erreur), mais aller-retour réseau inutile et incohérence avec le reste du site.

**Corrigé** dans `recrutement-photographe-videaste.html` et `recrutement-community-manager.html` : même regex et même message que `retractation.html`, appliqué avant tout appel réseau.

**Preuve** (avant/après, Playwright réel, champ e-mail = `pas-un-email`, tous les autres champs requis remplis) :
- Avant : `networkFired: true`, erreur affichée après réponse serveur.
- Après : `networkFired: false` sur les deux pages, erreur `"Merci de renseigner une adresse e-mail valide."` affichée immédiatement côté client.

### P1 — Champ `source` toujours "photographe_videaste" en base, même pour les candidatures Community Manager
Dans `submit-recruitment-application/index.ts`, l'insert écrivait `source: "photographe_videaste"` en dur, quel que soit le formulaire d'origine. Vérifié en base sur une candidature réelle déjà existante (antérieure à cette campagne, `id 98a17320…`) : `poste: "community_manager"` mais `source: "photographe_videaste"` — confirmé également par mes deux soumissions de test (§ 4). `poste` restait correct (donc les candidatures étaient toujours identifiables individuellement), mais `source` était trompeur pour toute exploitation/filtrage côté staff.

**Corrigé** : `source` déduit de `poste` (`community_manager` → `"community_manager"`, sinon `"photographe_videaste"`).

**⚠️ ACTION HUMAINE REQUISE** : cette edge function ne se déploie pas automatiquement (avertissement en tête du fichier, comme pour toutes les edge functions du projet). Le correctif est dans le code du repo mais **doit être redéployé manuellement** via Supabase Dashboard → Edge Functions → `submit-recruitment-application` → coller le code → Deploy, pour prendre effet en production.

---

## 3. Vérifié, aucun bug trouvé

### Recrutement — soumission complète réelle (les deux pages)
- Tous les champs (prénom, nom, e-mail, téléphone, zone, ville, expérience, matériel, permis, véhiculé, disponibilités, portfolio, message) transmis et retrouvés à l'identique en base.
- Upload de CV (PDF réel) : transmis en base64, uploadé dans le bucket privé `sportvision-media-prive/recrutement-cv/`, `cv_path` bien renseigné en base. Fichier vérifié présent dans le storage puis supprimé en nettoyage.
- Réponse serveur `{ok: true, id: ...}`, état de succès affiché (« Candidature envoyée »), 0 erreur console sur les deux pages.
- Champs requis strictement différents entre les deux pages testés et confirmés corrects : `zone` obligatoire sur photographe/vidéaste (pas sur CM), message d'erreur adapté à chaque page.

### Recrutement — honeypot
- Soumission normale (champ caché `site_web` vide, comme le fait un humain réel) : jamais bloquée, fonctionne normalement (cas testé ci-dessus).
- Soumission avec le champ honeypot rempli (simulation bot) : réponse `{ok: true}` sans identifiant, **aucune ligne créée en base** (vérifié par requête directe) — le comportement "réponse succès sans écriture, pour ne pas révéler la détection" documenté dans le code fonctionne comme prévu.

### Rétractation — soumission réelle
Le formulaire nécessite un client existant en base (`clients.email`) — la fonction ne crée jamais de client, elle ne fait que rattacher une demande à un client déjà connu. Pour tester le chemin de succès sans toucher à un vrai client, un client de test clairement identifié (`"QA TEST - NE PAS UTILISER"`, e-mail `qa.retract.test.30082026@example.com`) a été créé, utilisé, puis supprimé (§ 4).
- Succès : réponse `{success: true, demande_id, reference_resolue: null}` (la référence inventée `SV-QA-DOES-NOT-EXIST` n'existant pas pour ce client, correctement non résolue et mentionnée dans le motif stocké — comportement attendu, pas un bug), état "Rétractation transmise" affiché avec le bon identifiant.
- Client introuvable (e-mail inconnu) : 404, message d'anti-énumération générique affiché tel quel, aucune fuite d'information sur la cause réelle.
- Validation champs vides : bloqué côté client, aucune requête réseau.
- Validation e-mail invalide (`pas-un-email`) : déjà bien bloquée côté client sur cette page (le correctif du 30/08 mentionné dans son propre code est bien en place) — contrairement aux pages recrutement où il manquait (§ 2).
- Case de confirmation non cochée : bloqué côté client, aucune requête réseau.
- Honeypot rempli : réponse `{success: true, demande_id: null}`, aucune ligne créée.

### Bandeau cookies — cohérence sur 4 pages (`index.html`, `recrutement-photographe-videaste.html`, `cgv.html`, `retractation.html`)
Tous les clics ci-dessous sont de vrais clics Playwright, la persistance a été vérifiée en navigant réellement d'une page à l'autre (pas de lecture directe du `localStorage` en JS) :
- Bandeau visible au premier chargement (aucun consentement stocké), même clé `sv_cookie_consent_v2` utilisée sur les 36 pages du site qui ont le bandeau (seule `offres.html`, une page de redirection pure sans contenu, ne l'a pas — normal).
- « Tout accepter » : bandeau se ferme, ne réapparaît pas en changeant de page.
- « Gérer mes cookies » (lien de footer) : rouvre le bandeau + panneau, avec les 3 catégories (audience/externes/marketing) correctement pré-cochées selon le choix précédemment enregistré — testé après "Tout accepter" (tout coché) et après modification via "Enregistrer mes choix" (état exact reflété).
- « Tout refuser » : bandeau fermé, ne réapparaît pas ; réouverture via "Gérer mes cookies" montre bien toutes les catégories optionnelles décochées.
- « Personnaliser » : ouvre le panneau détaillé directement depuis le bandeau initial (sans passer par accepter/refuser) ; case cochée manuellement + "Enregistrer mes choix" : choix bien persisté et retrouvé à l'identique sur une autre page.
- Le lien "Gérer mes cookies" est présent et fonctionnel sur les 4 pages testées (et présent sur les 36 pages avec bandeau, vérifié par recherche textuelle).

### Pages légales — liens internes et cohérence
- Tous les `href` internes (`.html` et `.html#ancre`) des 4 pages légales + `retractation.html` + les 2 pages recrutement pointent vers des fichiers réellement présents dans `livrables/SportVision/`.
- `retractation.html` → `cgv.html#article-35` : l'ancre `id="article-35"` existe bien dans `cgv.html` (ARTICLE 35 - Droit de rétractation des consommateurs).
- `index.html#faq` (référencé depuis les 4 pages légales + les 2 pages recrutement) : l'ancre `id="faq"` existe bien.
- Aucun `href="#"` orphelin : le seul cas (`#cookie-manage`) est intercepté par `preventDefault()` et rouvre le bandeau, sur les 4 pages.
- Rendu mobile (iPhone 13, 390px) : **0 débordement horizontal** sur les 7 pages testées (4 légales + rétractation + 2 recrutement), formulaires lisibles et utilisables, menu burger testé avec un vrai tap (ouverture + navigation + fermeture automatique).

### Non modifié (hors périmètre, signalé pour information)
- `confidentialite.html`, `cookies.html`, `mentions-legales.html` affichent les adresses `contact@sportvision-an.fr` en texte brut (non cliquables), alors que `cgv.html` et `retractation.html` en font un vrai `mailto:`. Ce n'est pas un lien cassé (rien ne pointe nulle part), juste une incohérence mineure de confort ; non corrigé car limite avec le contenu/forme éditoriale de pages légales — à trancher si souhaité.
- Le commentaire de `netlify.toml` décrivant la CSP (`connect-src`) liste les fonctions appelées par le site mais omet `submit-recruitment-application`. Sans impact réel : la CSP autorise tout le domaine `https://lulgezzpvrlbftbykzrc.supabase.co`, donc les appels recrutement fonctionnent déjà ; c'est uniquement le commentaire qui est incomplet. Non corrigé (pure documentation, hors du périmètre "bug fonctionnel").

---

## 4. Traçabilité des tests réels et nettoyage

**Recrutement** (2 candidatures réelles soumises avec CV PDF de test) :
- `recrutement-photographe-videaste.html` → id `4733bdb6-7421-4b76-a04a-7ef56711b0af`, e-mail `qa.photovid.qatest_…@example.com`
- `recrutement-community-manager.html` → id `e8d38b64-5a8e-4576-b407-09d6da254109`, e-mail `qa.cm.qatest_…@example.com`
- Vérifiées en base (tous les champs corrects, `cv_path` renseigné), puis **supprimées** (ligne `recruitment_applications` + fichier dans le bucket `sportvision-media-prive/recrutement-cv/`), absence reconfirmée par requête après suppression.
- Honeypot testé avec un 3ᵉ e-mail (`qa.honeypot.…@example.com`) : confirmé **aucune ligne créée**, rien à nettoyer.

**Rétractation** :
- Client de test créé pour permettre le test du chemin de succès : `id 24685e7d-aeaf-4f33-b5a1-e8aa18bdd1cd`, nom `"QA TEST - NE PAS UTILISER"`, e-mail `qa.retract.test.30082026@example.com`.
- Demande de rétractation réelle créée : `id 173564dc-6d2d-447e-b1d7-d84808a91124`.
- Les deux **supprimés** après vérification, absence reconfirmée.

**Vérification finale de nettoyage** (requêtes directes en base après toutes les suppressions) : aucune ligne `recruitment_applications` ou `clients` portant un marqueur de test (`qa.`/`QA`), aucune `retractation_demandes` liée au client de test supprimé.

**Effet de bord assumé et inévitable** : chaque soumission réelle déclenche un vrai e-mail (Resend) — notification staff à `contact@sportvision-an.fr` pour les 2 candidatures de test et l'accusé de réception au "candidat"/"consommateur" (adresses `@example.com`, donc non délivrable côté destinataire test, mais l'e-mail staff, lui, est bien arrivé dans la vraie boîte). C'est le prix d'un test fonctionnel réel sans mock : à connaître en consultant `contact@sportvision-an.fr`, 2 notifications intitulées "Candidature Photographe & Vidéaste — Test QARecrutement" et "Candidature Community Manager — Test QACommunityManager" sont attendues et sans suite à donner.

Compteurs de rate-limit (`guest_rate_limits`, préfixes `recrut:` et `retract:`) : non nettoyés, ce sont de simples compteurs IP/e-mail sans donnée personnelle exploitable, à fenêtre glissante d'1h — s'auto-expirent, aucune action requise.

---

## 5. Fichiers modifiés

- `livrables/SportVision/recrutement-photographe-videaste.html` — validation e-mail client ajoutée.
- `livrables/SportVision/recrutement-community-manager.html` — validation e-mail client ajoutée.
- `livrables/SportVision-TV/supabase/functions/submit-recruitment-application/index.ts` — `source` déduit du `poste` réel au lieu d'être codé en dur. **Redéploiement manuel requis** (voir § 2).

Aucune modification du fond juridique des pages légales — uniquement vérification de liens et de rendu, rien à corriger sur ce point.
