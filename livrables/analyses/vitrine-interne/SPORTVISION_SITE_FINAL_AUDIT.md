# SPORTVISION_SITE_FINAL_AUDIT.md

Audit + refonte premium autonome du site public `sportvision-an.fr` (37 pages statiques, `livrables/SportVision/`), campagne du 30/08/2026. Méthode : 5 agents parallèles en worktrees isolés, chacun propriétaire d'un sous-ensemble disjoint de fichiers, audit réel (Playwright, clics/saisies réels, jamais `page.evaluate()`), correction directe de tout ce qui était sûr et réversible, fusion séquentielle avec vérification de non-régression avant chaque push. Rapports détaillés sources : `livrables/SportVision/audit/AUDIT_*.md`.

---

## 1. État initial

Le site (`NOTES-VITRINE.md`, 37 pages HTML autonomes, aucun framework, déployé sur Netlify) était déjà fonctionnel et globalement propre : design system cohérent (palette noir/bleu nuit/bleu électrique/cyan/violet, typographies Manrope/Inter), catalogue de 12 prestations, 5 pages Full Communication, Club+, Connect, 5 pages Accompagnements, galerie Réalisations avec un vrai fonds de photos/vidéos SportVision, formulaires connectés à Supabase, pages légales complètes. Les défauts principaux relevaient de la sous-exploitation du contenu réel disponible, d'un hero 100 % abstrait sur la Home, d'une promesse produit inexacte sur Full Communication, et d'une structure de conversion incomplète sur la majorité des fiches prestations — pas d'un site cassé.

## 2. Problèmes trouvés

**P0 (aucun trouvé)** — aucune faille de sécurité, aucun formulaire cassé de bout en bout, aucune route principale cassée.

**P1 (majeurs, corrigés)**
- Full Communication (5 pages) affirmait « certains clients valident chaque publication, d'autres pré-valident un calendrier mensuel » comme fonctionnement standard — contredit le fonctionnement réel (CM autonome, validation interne réservée au binôme CM Junior/tuteur, jamais côté client).
- Home : hero 100 % abstrait (mockup d'interface fictif, aucun média réel) sur un site qui vend justement de l'image.
- `reserver.html` : validation native du navigateur masquait les messages d'erreur personnalisés (bug réel, `novalidate` manquant).
- Incohérence de tarif « Montage & compilation » : 40/60/80/100 € TTC affiché partout au lieu de 39,90 € HT / 40-55-70-80 € HT confirmé.
- 10 des 12 fiches prestations n'avaient ni section « Exemples » (preuve visuelle) ni section « Pour qui ».
- Fiche Créations : photos brutes d'événements légendées à tort « créations graphiques ».
- Catalogue Prestations : 15 cartes génériques sans image, CTA vague (« Voir la fiche X »).
- Réalisations : 42 médias réels déjà curatés dans `assets/realisations/` jamais exposés sur la page.
- Pages recrutement (×2) et À propos : aucune preuve visuelle du travail réel.

**P0/P1 transverse** — `#sv-modal` : cf. campagne OS de la même nuit (fichier séparé), non applicable à ce site statique.

**P2 (notables, corrigés)**
- Cookie banner passant au-dessus du menu mobile (z-index), interceptant les clics réels.
- Sous-menu « Prestations » (11 liens) en simple liste verticale.
- Accessibilité clavier incomplète (menus déroulants, galerie Réalisations sans `tabindex`/rôle).
- CTA options manquants sur 5 cartes (Tournois ×3, Créations ×2).
- Lien secondaire non stylé sur `demande-de-devis.html`.
- Saut de hiérarchie `<h5>` dans le footer partagé (37 pages) et sauts `h1→h3`/`h2→h4` cosmétiques sur ~20 pages (documentés, non corrigés — voir §14).

**P3 (mineurs, en partie corrigés)** — icône Instagram en texte brut, footer visuellement plat, CSS morte héritée (`.case-grid`, `.testi-grid`, etc. inutilisées sur certaines pages), portes d'entrée secondaires absentes du hero.

## 3. Corrections appliquées

- **Full Communication (5 pages) + Club+ + Connect** : promesse de validation réécrite (CM publie en autonomie, visibilité complète et temps réel via Club+, ajustement possible à tout moment) — FAQ visible et JSON-LD alignés partout. Nouvelle section « Le cycle qui tourne chaque semaine » (Planning → Terrain → Production → Création → Publication → Performance). Rôles Club+ passés d'une liste de tags à des cartes bénéfices (Administrateur/Coach/Communication/Directeur sportif/Secrétaire/Trésorier).
- **Accompagnements (5 pages)** : études de cas réelles ajoutées sur la page Événements, galerie multi-sport sur la page Joueurs, lien FAQ Académies corrigé.
- **Home** : hero reconstruit autour de vrais médias (1 vidéo + 3 photos réelles en bande façon bibliothèque de contenus), deux faits vérifiés affichés (délai 24h, tarif dès 120 €), CTA header harmonisé, portes d'entrée secondaires ajoutées sous le hero.
- **Navbar/footer (36 pages)** : correctif z-index cookie banner/menu mobile, sous-menu Prestations en 2 colonnes, accessibilité clavier complète (`aria-haspopup`/`aria-expanded`, Échap), icône Instagram en SVG, signature visuelle du footer (liseré dégradé + glow discret).
- **Catalogue + 11 fiches Prestations** : structure Promesse → Inclus → Exemples → Pour qui → Livraison → Prix → Réserver appliquée partout, cartes catalogue avec vraie photo/vidéo + CTA explicite, 5 CTA d'option manquants ajoutés, légende trompeuse de la fiche Créations corrigée.
- **Réalisations** : galerie passée de 62 à 104 vignettes (42 médias réels remis en valeur), mosaïque « bento » premium, navigation clavier complète.
- **À propos** : bandeau de 6 photos réelles ajouté en preuve visuelle.
- **Recrutement (×2)** : hero avec composition photo réelle, section « réalité du terrain ».
- **Formulaires** : `novalidate` + contrôle regex e-mail sur les 4 formulaires publics, CTA sticky mobile sur `demande-de-devis.html` (masqué automatiquement quand le formulaire est à l'écran).
- **Tarifs** : incohérence « Montage & compilation » corrigée sur les 37 pages (39,90 € HT / 40-55-70-80 € HT), tout le reste des tarifs vérifié cohérent.
- **Sécurité** : CSP (`netlify.toml`) resserrée (retrait des domaines Google Fonts non utilisés, polices déjà auto-hébergées).

## 4. Changements UI

Hero Home entièrement reconstruit (médias réels vs mockup abstrait). Galerie Réalisations en mosaïque bento (grandes images, `grid-auto-flow: dense`) au lieu d'une grille uniforme. Cartes catalogue Prestations avec image en tête au lieu de pictogrammes sur fond uni. Rôles Club+ en cartes bénéfices au lieu d'une liste de tags. Cycle de production Full Communication visualisé en 6 étapes. Footer avec signature lumineuse (liseré dégradé + glow). Icône Instagram en SVG.

## 5. Changements UX

Navigation clavier complète sur les menus déroulants et la galerie Réalisations (`tabindex`, `role`, `aria-*`, Échap). Menu mobile toujours au-dessus du bandeau cookies (avant : clics interceptés). Sous-menu Prestations en 2 colonnes (11 liens, plus lisible). CTA systématiquement explicites (« Réserver cette prestation », « Demander un devis ») au lieu de « Voir la fiche X ». CTA sticky contextualisé sur la page devis longue. États de formulaire déjà solides (anti double-soumission, succès non optimiste) confirmés et étendus aux 4 formulaires.

## 6. Corrections produit

Correction la plus importante de la campagne : suppression de la fausse promesse de validation client obligatoire avant publication sur Full Communication (5 pages) — remplacée par le fonctionnement réel (CM autonome, visibilité totale côté client). Vérification croisée Club+/Connect : séparation des rôles déjà correcte (Club+ = professionnel, Connect = personnel), confirmée intacte après toute la campagne. Légende trompeuse corrigée sur la fiche Créations (photos brutes présentées à tort comme livrables graphiques finis).

## 7. SEO

Audit complet des 37 pages (title/description/canonical/OG/Twitter/JSON-LD/alt/hiérarchie de titres) : déjà propre sur l'essentiel — aucun doublon title/description, canonical cohérent avec `sitemap.xml` (vérifié 1:1), OG/Twitter complets sur les 37 pages, 27 blocs JSON-LD FAQ vérifiés mot pour mot contre le texte visible (27/27 conformes), `sitemap.xml`/`robots.txt` déjà à jour. Points restants documentés en dette (§14).

## 8. Performance

Vidéo hero conditionnée à un viewport ≥ 1024px et à l'absence de `prefers-reduced-motion` (vérifié en JS, pas seulement CSS) — pas de téléchargement vidéo inutile sur mobile. `loading="lazy"` sur toutes les images ajoutées sous la ligne de flottaison. CSP allégée (retrait de domaines de polices non utilisés). Aucune régression de poids de page identifiée lors des vérifications Playwright (0 requête en échec sur l'ensemble des pages testées).

## 9. Responsive

144 combinaisons page × viewport testées au total (desktop 1440×900, tablette 768×1024, mobile 390×844) sur l'ensemble des pages touchées par la campagne : 0 débordement horizontal, 0 CTA hors écran, mosaïque/galeries avec effondrement propre en grille simple sous 560-980px.

## 10. Sécurité

Rien de critique trouvé. CSP resserrée (retrait de `fonts.googleapis.com`/`fonts.gstatic.com`, non utilisés). Formulaires déjà protégés côté backend (honeypot, rate-limit) — non modifiés, uniquement la couche de validation client renforcée.

## 11. Formulaires

Bug réel corrigé : `reserver.html` n'avait pas `novalidate`, la validation HTML5 native bloquait la soumission avant l'exécution du JS et masquait les messages d'erreur personnalisés — corrigé, avec compensation regex e-mail sur les 4 formulaires concernés (`reserver.html`, `demande-de-devis.html` ×2, `retractation.html`). Anti double-soumission, états de succès (jamais d'`alert()`), et appels réseau vers les edge functions (`create-guest-request`, `create-guest-rdv`, `check-disponibilite`, `submit-retractation-demande`, `submit-recruitment-application`) vérifiés fonctionnels et non cassés par les changements visuels.

## 12. Intégrations

Aucune edge function modifiée. Tous les appels réseau existants (Supabase) vérifiés intacts après les refontes visuelles, via l'onglet réseau Playwright sur chaque formulaire concerné.

## 13. Conversion

Structure de conversion (Promesse → Inclus → Exemples → Pour qui → Livraison → Prix → Réserver) désormais appliquée uniformément sur les 12 pages du catalogue Prestations (10 en manquaient tout ou partie). CTA précis partout où un CTA générique existait encore. CTA sticky mobile ajouté sur la page devis (page longue, formulaire perdu de vue au scroll) — délibérément pas ajouté sur `reserver.html` (tunnel court, CTA contextuel déjà présent à chaque étape). Portes d'entrée secondaires (Club+, Full Communication, Réalisations) ajoutées sous le hero de la Home.

## 14. Dette restante

- Saut de hiérarchie `<h5>` dans le footer partagé (37 pages) — un seul correctif dans le template résoudrait toutes les pages, non traité cette nuit (identifié tardivement, hors du périmètre de l'agent qui a livré le footer).
- ~20 pages avec des sauts de titres cosmétiques (`h1→h3` ou `h2→h4`) dans des sections héros/grilles — non bloquant SEO, liste précise disponible dans `audit/AUDIT_FORMULAIRES_LEGAL_SEO_PRICING.md` §3.
- `offres.html` (page `noindex`) : canonical en chemin relatif au lieu d'URL absolue — priorité faible, page non indexée.
- 9 pages sans JSON-LD (légal ×5, normal ; `realisations.html`/recrutement ×2/`reserver.html`) : opportunité de schéma `ImageGallery`/`JobPosting`, pas une erreur.
- CSS morte héritée (`.case-grid`, `.testi-grid`, etc.) sur plusieurs fiches — inoffensive, laissée en l'état pour ne pas gonfler le diff.
- Dossier source `context/import/banque contenue Sportvision/` contient plus de médias que les 104 déjà curatés dans `assets/realisations/` — une nouvelle sélection resterait possible si Fouka veut aller au-delà.

## 15. Actions humaines nécessaires

**Aucune décision bloquante rencontrée** — toutes les corrections appliquées cette nuit étaient sûres, réversibles et documentées. Deux points de transparence, non bloquants :

1. **Direction créative du hero Home** : `NOTES-VITRINE.md` contenait une note plus ancienne préférant un mockup d'interface à une photo sportive dans le hero. Le mandat de cette campagne demande l'inverse (médias réels). Tranché en faveur du mandat (le plus récent et le plus explicite), en conservant un compromis — le cadre « fenêtre d'app » (signal produit/tech) reste, mais son contenu est désormais fait de vrais médias. Isolé dans un seul bloc HTML/CSS, facile à ajuster si ce choix ne convient pas.
2. **Tarif « Montage & compilation »** : le mandat indiquait 39,90 € HT / 40-55-70-80 € HT comme source de vérité confirmée — c'est cette valeur qui a été appliquée sur les 37 pages (y compris `reserver.html`, le moteur qui facture réellement). Si cette valeur ne correspond finalement pas au tarif réellement souhaité, il faudra le confirmer et modifier en un seul endroit récurrent désormais cohérent partout.

---

## AVANT / APRÈS — améliorations majeures

**Home.** Avant : hero avec un dashboard 100 % fictif ("Devis accepté et signé", "238 contenus"...), aucune photo ni vidéo réelle — exactement le type de template SaaS générique que le mandat interdit. Après : bande de 4 médias réels (vidéo de match + 3 photos multi-sports) dans le même cadre "fenêtre d'app", avec deux faits vérifiés affichés (délai, tarif) et des portes d'entrée secondaires vers Club+/Full Communication/Réalisations.

**Full Communication.** Avant : la page affirmait que certains clients "valident chaque publication" avant qu'elle parte — une promesse de fonctionnement inexacte. Après : le texte reflète le fonctionnement réel (CM autonome, visibilité complète et temps réel côté client via Club+), avec un nouveau cycle de production en 6 étapes qui rend l'accompagnement concret plutôt qu'abstrait.

**Catalogue Prestations.** Avant : 15 cartes identiques (icône + texte, aucune image), CTA "Voir la fiche X". Après : chaque carte affiche une vraie photo/vidéo, hover premium, CTA d'action explicite ("Réserver cette prestation") + lien secondaire — et les 11 fiches ont désormais toutes une vraie section "Exemples" (preuve visuelle) et "Pour qui" (profils réels).

**Réalisations.** Avant : 62 vignettes en grille uniforme, aucune interaction clavier possible. Après : 104 vignettes (42 médias réels remis en valeur, jusque-là inexploités) en mosaïque bento premium, entièrement accessible au clavier.

**Cohérence des tarifs.** Avant : "Montage & compilation" affichait un barème différent (40/60/80/100 € TTC) de la source de vérité confirmée, de façon cohérente mais fausse sur les 37 pages. Après : 39,90 € HT / 40-55-70-80 € HT appliqué partout, y compris dans le moteur de réservation qui facture réellement.

**Formulaires.** Avant : sur `reserver.html`, la validation native du navigateur empêchait les messages d'erreur personnalisés de jamais s'afficher. Après : `novalidate` + validation JS cohérente sur les 4 formulaires publics du site.

---

## Score final

| Critère | /10 | Commentaire |
|---|---|---|
| Design | 8 | Palette et identité déjà solides, renforcées (hero, footer, cartes) sans dérive vers un template générique. |
| UX | 8 | Navigation clavier complète, CTA explicites partout, cookie banner ne bloque plus le menu mobile. |
| Mobile | 8 | 0 débordement horizontal sur 144 combinaisons testées, effondrement propre des nouvelles mosaïques/galeries. |
| Conversion | 8 | Structure Promesse→...→Réserver généralisée sur le catalogue, CTA sticky ciblé, portes d'entrée Home enrichies. |
| SEO | 8 | Déjà propre sur l'essentiel (title/desc/canonical/OG/JSON-LD/sitemap) ; dette restante = hiérarchie de titres, non bloquante. |
| Performance | 7 | Vidéo hero conditionnelle et lazy-load appliqués ; pas d'audit Lighthouse chiffré réalisé cette nuit (à faire pour un score définitif). |
| Cohérence produit | 9 | Faille de fond corrigée (validation client Full Communication), Club+/Connect vérifiés séparés, tarifs unifiés sur 37 pages. |
| Crédibilité | 8 | Contenu 100 % réel (aucun chiffre/témoignage inventé), preuve visuelle largement étendue (Réalisations, À propos, Recrutement). |
| Qualité technique | 8 | 0 conflit de fond laissé non résolu, 0 lien mort réel trouvé, formulaires vérifiés de bout en bout. |
| Prêt pour acquisition | 7 | Le site peut recevoir du trafic payant dès maintenant ; un audit Lighthouse chiffré et le traitement de la dette §14 restent recommandés avant une campagne d'ampleur. |
