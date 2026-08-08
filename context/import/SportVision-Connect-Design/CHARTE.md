# Charte graphique — SportVision Connect

Document de référence pour l'implémentation. Toutes les valeurs sont définitives.

---

## Logo

Fichier fourni : `logo-sportvision.png` — un « S » stylisé traversé d'un triangle de lecture,
dégradé bleu → violet, fond transparent.

**Emplacements dans le produit** : page de connexion (42 px), barre latérale (36 px), écrans de
chargement, e-mails, documents, états vides, écrans mobiles.

Le symbole n'est jamais redessiné ni déformé. Prévoir en production les déclinaisons complète,
compacte, symbole seul, favicon et icône PWA — idéalement en SVG.

Déclinaison textuelle : `SPORTVISION` en 15 px / 700 / interlettrage 0,5 px, puis `CONNECT` en
dessous en 11,5 px / 500 / interlettrage 0,06 em, en bleu pâle `#8FD4FF`.

---

## Couleurs

### Surfaces sombres — chrome de l'application

| Token | Hex | Usage |
|---|---|---|
| Fond principal | `#070A17` | fond de l'application, barre latérale |
| Fond secondaire | `#0B1026` | surfaces alternées, en-têtes de tableau |
| Carte | `#111735` | cartes, panneaux, champs |
| Carte élevée | `#1A2145` | modales, menus, survol de ligne |
| Surface creuse | `#0A0F26` | champs de saisie, jauges vides |
| Bordure | `#252C4A` | contours de cartes |
| Bordure forte | `#343C63` | champs, éléments interactifs |

### Marque

| Token | Hex | Usage |
|---|---|---|
| Bleu SportVision | `#2454FF` | action principale, éléments actifs |
| Bleu électrique | `#1686FF` | liens, accents secondaires |
| Cyan | `#00C8FF` | information, progression |
| Violet | `#832DFF` | accents premium, Club+ |
| Violet lumineux | `#C337FF` | fin de dégradé, points forts |
| Bleu pâle | `#8FB4FF` | texte sur fond sombre premium |

### Neutres — mode clair

| Token | Hex |
|---|---|
| Blanc | `#FFFFFF` |
| Fond clair | `#F5F7FC` |
| Surface alternée | `#FAFBFE` |
| Surface creuse | `#EFF2F8` |
| Bordure | `#E8ECF4` |
| Bordure forte | `#D5DBE7` |
| Texte | `#111827` |
| Texte doux | `#344054` |
| Texte secondaire | `#667085` |
| Texte discret | `#98A2B3` |

### Sémantique

Les puces de statut utilisent un fond pâle et un texte **foncé** en mode clair, un fond
translucide et un texte **clair** en mode sombre. Les valeurs de remplissage pures ne passent pas
le contraste AA en 11 px gras — utilisez les colonnes de ce tableau.

| Sens | Clair — fond / texte | Sombre — fond / texte |
|---|---|---|
| Succès | `#ECFDF3` / `#027A48` | `rgba(40,201,149,.16)` / `#7BE8C3` |
| Alerte | `#FEF0C7` / `#B54708` | `rgba(245,166,35,.16)` / `#FFCE85` |
| Erreur | `#FEF3F2` / `#B42318` | `rgba(239,91,103,.16)` / `#FFA3AB` |
| Information | `#EEF2FF` / `#2454FF` | `rgba(22,142,255,.16)` / `#8FB4FF` |
| Accent | `#F6EEFF` / `#832DFF` | `rgba(116,85,255,.18)` / `#C9A6FF` |
| Cyan | `#E6F9FF` / `#03688A` | `rgba(45,212,227,.16)` / `#8FD9FF` |
| Neutre | `#F2F4F7` / `#667085` | `rgba(255,255,255,.07)` / `#A7B6C9` |

### Dégradés

Réservés aux boutons principaux, cartes premium, indicateurs de progression, en-têtes et éléments
de marque. **Jamais sur une carte ordinaire, jamais deux côte à côte.**

| Usage | Valeur |
|---|---|
| Action principale | `linear-gradient(135deg, #2454FF, #832DFF)` |
| Carte premium | `linear-gradient(135deg, #111735 0%, #1B2A6B 55%, #4A1E9E 100%)` |
| Progression | `linear-gradient(90deg, #00C8FF, #C337FF)` |
| Validation | `linear-gradient(135deg, #28C995, #00C8FF)` |
| Marque | bleu → cyan → violet |

### Mode sombre

Sombre par défaut. Le clair reste disponible via la bascule en barre supérieure et dans les
paramètres personnels.

**La barre latérale reste `#070A17` dans les deux thèmes.** C'est un chrome, pas une surface
thématisée : ne la reliez pas au token de fond de page.

| Token | Clair | Sombre |
|---|---|---|
| Fond de page | `#F5F7FC` | `#070A17` |
| Surface | `#FFFFFF` | `#111735` |
| Surface alternée | `#FAFBFE` | `#0B1026` |
| Surface creuse | `#EFF2F8` | `#0A0F26` |
| Élevée | `#FFFFFF` | `#1A2145` |
| Bordure | `#E8ECF4` | `#252C4A` |
| Bordure forte | `#D5DBE7` | `#343C63` |
| Séparateur | `#F5F7FC` | `rgba(255,255,255,.07)` |
| Texte | `#111827` | `#F5F7FB` |
| Texte doux | `#344054` | `#A7B6C9` |
| Texte secondaire | `#667085` | `#A7B6C9` |
| Texte discret | `#98A2B3` | `#93A6BD` |
| Champ de saisie | `#FFFFFF` | `#0A0F26` |
| Survol de ligne | `#FBFCFE` | `#1A2145` |

Les couleurs d'échéance sont thématisées séparément : `due`, `dueWarn`, `dueLate`, `dueMuted`.

---

## Typographie

**Plus Jakarta Sans** — 400, 500, 600, 700, 800 — pour toute l'interface.
**JetBrains Mono** — 400, 500 — pour les références techniques : numéros de facture, identifiants
de demande, timecodes vidéo, libellés de placeholder.

À auto-héberger en production.

| Rôle | Taille | Graisse | Interlettrage |
|---|---|---|---|
| H1 connexion | 50 px | 800 | −0,038em |
| H1 | 44 px | 800 | −0,038em |
| H1 tableau de bord | 29 px | 800 | −0,035em |
| H2 | 24 px | 800 | −0,03em |
| H3 — carte | 18 px | 800 | −0,025em |
| Titre de section | 15 px | 800 | −0,015em |
| Corps | 14 px | 500 | 0 |
| Corps fort | 13,5 px | 700 | 0 |
| Libellé de champ | 12,5 px | 700 | 0 |
| Métadonnée | 11,5 px | 600 | 0,02em |
| Puce de statut | 11 px | 800 | 0 |
| En-tête de tableau | 11 px | 800 | 0,04em · majuscules |
| Sur-titre | 11,5 px | 800 | 0,09em · majuscules |
| Titre de section de nav | 10 px | 800 | 0,11em · majuscules |

`text-wrap: pretty` sur les paragraphes, `text-wrap: balance` sur les titres longs.
**Rien en dessous de 10 px.** Sur mobile, texte principal 16 px, boutons 15 à 16 px.

---

## Espacements, rayons, ombres

Échelle : 2 · 3 · 4 · 6 · 7 · 9 · 11 · 13 · 14 · 16 · 18 · 20 · 22 · 26 · 28 · 32 · 44 · 56 px.

Pas dominant : 9 px entre éléments d'une liste, 14 px entre cartes, 16 px entre blocs, 18 à 22 px
entre sections.

Les groupes d'éléments utilisent `display:flex` ou `grid` avec `gap`, **jamais des marges
individuelles**.

| Élément | Rayon |
|---|---|
| Puce, badge, jauge | `99px` |
| Avatar | `50%` |
| Petit bouton, case à cocher | 5 à 9 px |
| Bouton, champ | 10 à 12 px |
| Carte imbriquée | 12 à 14 px |
| Carte de contenu | 15 à 16 px |
| Panneau, section | 18 px |
| Modale, bloc premium | 20 à 22 px |

| Usage | Clair | Sombre |
|---|---|---|
| Carte au repos | `0 1px 2px rgba(16,24,40,.04)` | `0 1px 2px rgba(0,0,0,.35)` |
| Carte au survol | `0 12px 26px -16px rgba(16,24,40,.45)` | idem |
| Menu déroulant | `0 20px 44px -18px rgba(16,24,40,.35)` | idem |
| Modale | `0 40px 90px -24px rgba(7,10,23,.55)` | idem |
| Panneau latéral | `-30px 0 70px -20px rgba(7,10,23,.5)` | idem |
| Bouton principal | `0 8px 20px -10px rgba(36,84,255,.8)` | idem |

---

## Boutons

| Variante | Style | Usage |
|---|---|---|
| Principale | dégradé `135deg, #2454FF → #832DFF`, texte blanc, hauteur 40 à 52 px | envoyer, valider, payer, signer, continuer |
| Secondaire | fond transparent ou surface, bordure forte, texte doux | consulter, télécharger, contacter |
| Sombre | fond `#111735`, texte blanc | action secondaire forte |
| Tertiaire | texte seul, bleu `#1686FF` ou secondaire | actions discrètes |
| Danger | `#EF5B67`, confirmation obligatoire | annuler, supprimer |

**Une seule action principale par écran.** Taille tactile minimale 44 px sur mobile.

### États obligatoires

Chaque composant doit couvrir : par défaut, survol, actif, focus, désactivé, erreur, chargement.

- **Survol bouton principal** : `filter: brightness(1.06)`
- **Survol carte** : `translateY(-2px)` + bordure accentuée + ombre portée
- **Focus** : `box-shadow: 0 0 0 4px rgba(36,84,255,.12)` + bordure `#2454FF`, via `:focus-visible`
  uniquement — jamais confondu avec l'état actif de la route
- **Désactivé** : fond `#E4E7EC`, texte `#98A2B3`, `cursor: not-allowed`
- **Chargement** : spinner 14 px, `cursor: wait`, opacité 0,85

---

## Badges de statut

Toujours **couleur + libellé texte**, jamais la couleur seule.

| Couleur | Sens | Exemples |
|---|---|---|
| Bleu | information | Envoyée, Devis disponible, En création, À venir |
| Vert | succès | Acceptée, Signé, Payée, Validé, Livrée, Publié |
| Orange | action attendue | En attente, À signer, À payer, Corrections demandées |
| Violet | production | Planifiée, Postproduction, À valider |
| Rouge | erreur | Annulée, Refusée, En retard, Erreur de publication |
| Gris bleuté | neutre | Brouillon, Clôturée, Expirée, Idée |

---

## Animations

Transitions de 140 à 240 ms sur : survol de carte, changement d'étape, ouverture d'accordéon, mise
à jour de récapitulatif, sélection d'option. **Rien au-delà de 300 ms.**

| Nom | Effet |
|---|---|
| `svfade` | `opacity 0→1` + `translateY(6px→0)` en 160 ms — menus, modales, panneaux |
| `svshimmer` | `background-position -420px → 420px`, 1,3 s linéaire infini — skeletons |
| `svfloat` / `svfloat2` | ±9 px / ±7 px, 6 à 8 s — cartes flottantes de la connexion |
| `svpulse` | opacité 0,45 → 1, 2,2 s — indicateur de statut |

Pas d'animation permanente dans l'application, pas de parallax, pas de néon.
`prefers-reduced-motion: reduce` désactive tout.

**Les deux cartes flottantes de la page de connexion doivent conserver un écart au repos d'au
moins 20 px** : leurs amplitudes se cumulent à ±16 px.

---

## Imagerie

Aucune photographie n'est fournie. Tous les emplacements sont des placeholders :
`repeating-linear-gradient` à 125° dans les teintes de la palette, avec un libellé monospace
décrivant le contenu attendu.

L'espace connecté reste volontairement sobre : peu d'images, priorité aux cartes fonctionnelles et
aux statuts. La page de connexion et les cartes premium sont les seuls endroits où l'imagerie
prend de la place.

Icônes : SVG inline, `viewBox="0 0 24 24"`, `stroke-width` 1,75 à 2, extrémités et jointures
arrondies, tailles 11 à 30 px. À remplacer par la bibliothèque du codebase — Lucide ou équivalent
au tracé fin arrondi.

---

## Style à éviter

Connect ne doit ressembler ni à un CRM générique, ni à une interface bancaire, ni à un tableau
administratif, ni à un SaaS blanc sans identité.

**Privilégier** : grandes cartes, médias sportifs, dégradés maîtrisés, timelines, aperçus vidéo,
indicateurs de progression, micro-animations sobres, badges.

**Éviter** : dégradés sur chaque élément, ombres lourdes, plus de deux couleurs de fond par écran,
tableaux massifs sans filtres, cartes surchargées d'informations.

---

## Accessibilité

- Contrastes AA vérifiés au calcul, y compris sur les puces en 11 px gras
- `aria-label` sur tout bouton à icône seule
- `aria-busy` et `aria-live` sur les zones en chargement
- Focus visible via `:focus-visible` uniquement
- Cibles de clic ≥ 44 px sur mobile
- Labels associés aux champs, messages d'erreur explicites sous le champ
- La couleur n'est jamais seule porteuse d'information : chaque puce porte son libellé
- Navigation clavier complète, ordre de tabulation suivant l'ordre visuel
