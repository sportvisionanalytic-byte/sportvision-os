# Standardisation des CTA principaux — 3 familles

Date : 2026-08-30
Périmètre : 37 pages `livrables/SportVision/*.html`
Objectif : réduire les libellés des CTA **principaux** (hero, CTA final de section, cartes de prestations/offres) à 3 familles cohérentes.

## Les 3 familles cibles

1. **PRESTATION** (réservation ponctuelle, prix fixe ou sur devis simple) → **« Réserver »** (variante précise autorisée, verbe "réserver" obligatoire)
2. **OFFRE / STRUCTURE** (Club+, abonnement, structure qui veut s'équiper) → **« Demander une démonstration »**
3. **FULL COM / PROJET COMPLEXE** (délégation complète, accompagnement sur-mesure, gros projet) → **« Parler à SportVision »**

Les micro-CTA secondaires (FAQ, "Découvrir X"/"en savoir plus" vers une fiche détaillée, navigation croisée, ajout d'option à une prestation déjà réservée) n'ont **pas** été touchés — hors périmètre de la mission.

Vérification : le comportement de chaque bouton renommé (destination, modale ouverte, `data-devis-context`) a été contrôlé en lecture de code puis testé en clic réel via Playwright (Chromium headless, serveur statique local) — seul le texte a changé, jamais l'action déclenchée.

---

## Tableau page par page — CTA renommés

| Page | Emplacement | Avant | Après | Famille |
|---|---|---|---|---|
| accompagnements-academies.html | Hero | Présenter mon académie | Parler à SportVision | 3 — Full Com |
| accompagnements-academies.html | CTA final | Présenter mon académie | Parler à SportVision | 3 — Full Com |
| accompagnements-coachs.html | Hero | Parler de mon activité | Parler à SportVision | 3 — Full Com |
| accompagnements-coachs.html | CTA final | Parler de mon activité | Parler à SportVision | 3 — Full Com |
| accompagnements-evenements.html | Hero | Obtenir un devis événement | Parler à SportVision | 3 — Full Com |
| accompagnements-evenements.html | CTA final (section devis) | Obtenir un devis événement | Parler à SportVision | 3 — Full Com |
| accompagnements-joueurs.html | Hero (lien ancre vers #regulier) | Créer mon accompagnement joueur | Parler à SportVision | 3 — Full Com |
| accompagnements-joueurs.html | Carte "Un suivi sur toute la saison" | Créer mon accompagnement joueur | Parler à SportVision | 3 — Full Com |
| accompagnements-joueurs.html | CTA final | Créer mon accompagnement joueur | Parler à SportVision | 3 — Full Com |
| accompagnements.html | CTA final (hub) | Contactez-nous | Parler à SportVision | 3 — Full Com |
| full-communication.html | Hero | Demander mon audit | Parler à SportVision | 3 — Full Com |
| full-communication.html | CTA final | Demander mon audit | Parler à SportVision | 3 — Full Com |
| full-communication-clubs.html | Hero | Demander mon audit | Parler à SportVision | 3 — Full Com |
| full-communication-clubs.html | CTA final | Demander mon audit | Parler à SportVision | 3 — Full Com |
| full-communication-coachs.html | Hero | Parler de mon activité | Parler à SportVision | 3 — Full Com |
| full-communication-coachs.html | CTA final | Parler de mon activité | Parler à SportVision | 3 — Full Com |
| full-communication-academies.html | Hero | Parler de mon académie | Parler à SportVision | 3 — Full Com |
| full-communication-academies.html | CTA final | Parler de mon académie | Parler à SportVision | 3 — Full Com |
| full-communication-evenements.html | Hero | Obtenir mon devis | Parler à SportVision | 3 — Full Com |
| full-communication-evenements.html | CTA final | Obtenir mon devis | Parler à SportVision | 3 — Full Com |
| club-plus.html | Carte formule "Club+ Performance" | Demander Club+ Performance | Demander une démonstration | 2 — Offre/Structure |
| prestation-coachs.html | Hero | Préparer mon tournage | Réserver mon tournage | 1 — Prestation |
| prestation-coachs.html | CTA final | Préparer mon tournage | Réserver mon tournage | 1 — Prestation |
| prestation-creations.html | Hero | Demander une création | Réserver ma création | 1 — Prestation |
| prestation-creations.html | CTA final | Demander une création | Réserver ma création | 1 — Prestation |
| prestation-media-day.html | Hero | Demander un Media Day | Réserver mon Media Day | 1 — Prestation |
| prestation-media-day.html | Section "organisée de bout en bout" | Demander un Media Day | Réserver mon Media Day | 1 — Prestation |
| prestation-media-day.html | CTA final | Demander un Media Day | Réserver mon Media Day | 1 — Prestation |
| prestation-shooting-equipe.html | Hero | Organiser ce shooting | Réserver ce shooting | 1 — Prestation |
| prestation-shooting-equipe.html | Section "session organisée" | Organiser ce shooting | Réserver ce shooting | 1 — Prestation |
| prestation-shooting-equipe.html | CTA final | Organiser ce shooting | Réserver ce shooting | 1 — Prestation |
| prestation-shooting-joueur.html | Hero | Organiser mon shooting | Réserver mon shooting | 1 — Prestation |
| prestation-shooting-joueur.html | Section "séance pensée..." | Organiser mon shooting | Réserver mon shooting | 1 — Prestation |
| prestation-shooting-joueur.html | CTA final | Organiser mon shooting | Réserver mon shooting | 1 — Prestation |
| prestation-tournois.html | Hero | Obtenir un devis tournoi | Réserver mon tournoi | 1 — Prestation |
| prestation-tournois.html | CTA final | Obtenir un devis tournoi | Réserver mon tournoi | 1 — Prestation |
| prestation-camera-isolee.html | Carte "Plusieurs joueurs suivis" (option options, sur devis) | Demander un devis | Réserver ce suivi | 1 — Prestation |
| prestation-montage-compilation.html | Carte "Compilation saison complète" (sur devis) | Demander un devis | Réserver cette compilation | 1 — Prestation |
| prestations.html | Carte "Shooting joueur" ×2 | Demander un devis | Réserver cette prestation | 1 — Prestation |
| prestations.html | Carte "Media Day" | Demander un devis | Réserver cette prestation | 1 — Prestation |
| prestations.html | Carte "Tournois & stages" | Demander un devis | Réserver cette prestation | 1 — Prestation |
| prestations.html | Carte "Créations graphiques" | Demander un devis | Réserver cette prestation | 1 — Prestation |
| prestations.html | Carte "Coachs & préparateurs" | Demander un devis | Réserver cette prestation | 1 — Prestation |

**Synchronisation texte/JSON-LD** : `accompagnements-academies.html` avait une FAQ (visible + `FAQPage` JSON-LD, question "Comment démarrer l'accompagnement ?") qui citait littéralement l'ancien libellé « Présenter mon académie ». Les deux occurrences (JSON-LD et texte visible identique) ont été mises à jour pour citer « Parler à SportVision ». Aucune autre référence textuelle à un libellé de bouton renommé n'a été trouvée ailleurs sur le site (recherche exhaustive des citations entre guillemets « » et `bouton "..."`).

**Déjà conformes, aucun changement nécessaire** :
- `a-propos.html` hero + section contact : « Demander une démonstration » (×2) — déjà famille 2.
- `club-plus.html` hero : « Demander une démonstration » — déjà famille 2.
- Tous les CTA « Réserver » / « Réserver une prestation » / « Réserver ce match » / « Réserver cette prestation » déjà présents sur les pages `prestation-*.html`, `prestations.html`, `index.html`, `reserver.html`, le header et le menu mobile (sitewide).

---

## Cas ambigus non tranchés (recommandation, à valider)

| Page | CTA | Comportement réel | Pourquoi c'est ambigu | Recommandation |
|---|---|---|---|---|
| a-propos.html | « Nous contacter » (section contact, à côté de « Demander une démonstration ») | Lien vers `demande-de-devis.html`, formulaire générique multi-motifs | Ne correspond à aucune des 3 familles ; c'est une alternative de contact générique, pas une action de conversion typée | Laisser en l'état : c'est un lien secondaire à côté du vrai CTA de la section, pas le CTA principal |
| realisations.html | « Demander un devis » (CTA final, à côté de « Réserver une prestation ») | Ouvre la modale devis générique, sans `data-devis-context` | Contexte flou : peut viser une prestation ponctuelle *ou* un besoin structure ; le libellé actuel ne trahit pas l'intention | Si l'intention est "showcase pour convaincre une structure" → renommer en « Demander une démonstration » (famille 2). Sinon laisser tel quel |
| demande-de-devis.html | « Aller au formulaire » (hero) + CTA sticky | Ancre de scroll vers le formulaire de la page elle-même | Cette page est un formulaire générique multi-motifs (photo/vidéo/Club+/Full Com) ; "Aller au formulaire" n'est ni Réserver, ni Démo, ni Parler à SportVision — c'est une action de scroll, pas de conversion typée | Laisser en l'état ; hors périmètre des 3 familles par nature |
| index.html | « Trouver mon accompagnement » (hero, onglet accompagnement) | Lien vers `accompagnements.html` (page hub) | C'est une redirection vers un hub de choix, pas un engagement direct vers une des 3 familles | Laisser en l'état (navigation, pas conversion) |
| index.html | « Choisir mon accompagnement » (CTA final, bouton secondaire ghost) | Lien vers `accompagnements.html` | Même remarque que ci-dessus | Laisser en l'état |
| prestation-match-photo.html / prestation-match-video.html | « Demander un devis » (option "Déplacement — selon distance") | Ouvre la modale devis générique pour calculer un supplément de déplacement | Ce n'est pas une réservation de prestation autonome mais un ajout tarifaire à une réservation déjà engagée — proche d'« Ajouter... » mais le texte dit "devis" | Laisser en l'état, ou par cohérence avec « Ajouter drone ou Véo » juste au-dessus, renommer en « Demander mon tarif déplacement » — mais ce n'est pas un des 3 CTA principaux au sens strict (mission tranchera) |

---

## Hors périmètre (rappel, non modifié intentionnellement)

- Liens "Découvrir X" / "Voir la fiche complète" / "Découvrir la compilation" etc. (cross-sell, fiche détaillée)
- Boutons d'ajout d'option à une prestation déjà en cours de réservation : « Ajouter drone ou Véo », « Ajouter cette option » (toutes occurrences, badge "En option")
- Liens de connexion (« Se connecter », « Se connecter à Connect »)
- Boutons de formulaire (étapes `reserver.html`, candidatures recrutement, rétractation, cookies)
- CTA du header/menu mobile « Réserver une prestation » (sitewide, déjà conforme famille 1)
- Bouton « Demander un devis » du visualiseur photo (`#photo-devis-btn`, lightbox galerie) — micro-fonction annexe, pas un CTA principal de section

---

## Vérification Playwright

Site servi en local (`python3 -m http.server`), navigation Chromium headless : pour chaque bouton renommé, clic réel confirmé — ouverture de la modale devis (`#devis-overlay.on`) avec le bon `data-devis-context` inchangé, ou navigation vers l'ancre/le lien identique à avant renommage. Aucune régression de comportement détectée, seul le texte visible a changé.
