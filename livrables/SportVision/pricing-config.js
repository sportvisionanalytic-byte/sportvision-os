/* ============================================================================
 * SportVision — SOURCE UNIQUE DE VÉRITÉ DES TARIFS PUBLICS
 * ============================================================================
 *
 * POURQUOI CE FICHIER EXISTE
 * Le site (livrables/SportVision/) est 37 pages HTML statiques, sans build ni
 * serveur (Netlify sert les fichiers tels quels). Chaque prix affiché dans le
 * HTML visible (catalogue, fiches prestations, Club+...) est donc forcément
 * écrit en dur, et TOUJOURS dupliqué : un même tarif apparaît sur la page
 * d'accueil, sur le catalogue, sur la fiche prestation dédiée, dans son
 * <title>/<meta description>/JSON-LD, et dans le moteur de réservation
 * (reserver.html). L'audit du 30/08/2026 a trouvé et corrigé une incohérence
 * réelle née de cette duplication (« Montage & compilation » affichée à un
 * tarif différent sur 5 pages en même temps, cf. SPORTVISION_SITE_FINAL_AUDIT.md
 * §2 et §14). Ce fichier centralise CHAQUE tarif confirmé pour que ce genre de
 * dérive redevienne détectable en une commande au lieu d'un audit complet.
 *
 * CE QUE CE FICHIER NE FAIT PAS (et pourquoi c'est volontaire)
 * Il ne « template » PAS les <title>/<meta description>/JSON-LD des 36 autres
 * pages. Ces balises doivent rester du texte statique lisible sans exécuter
 * de JavaScript — un moteur de recherche ou un aperçu de partage (Slack,
 * WhatsApp, iMessage...) n'exécute pas le JS de la page pour lire ses <meta>.
 * Remplacer ce texte par du contenu injecté en JS casserait le SEO et les
 * aperçus sociaux. Les prix restent donc écrits en dur dans le HTML de ces
 * pages — ce n'est pas un oubli, c'est une contrainte technique du site.
 *
 * CE QUE CE FICHIER FAIT RÉELLEMENT EN RUNTIME
 * reserver.html (le moteur de réservation) est la seule page du site qui est
 * un vrai tunnel interactif sans enjeu SEO sur son contenu dynamique : il
 * charge ce fichier via <script src="pricing-config.js"></script> puis lit
 * PRICING_CONFIG au chargement pour peupler ses cartes de besoins, la liste
 * déroulante des paliers Montage & compilation, et l'option tarifée « Plans
 * drone ou Véo complémentaires », au lieu de dupliquer ces nombres dans son
 * propre <script>. Voir la fonction applyPricingConfig() dans reserver.html.
 * Si ce fichier ne charge pas (erreur réseau, etc.), reserver.html retombe
 * silencieusement sur les valeurs déjà présentes dans son HTML statique
 * (qui restent à jour) — aucune régression possible.
 *
 * COMMENT VÉRIFIER LA COHÉRENCE DU SITE
 * Lancer depuis livrables/SportVision/ :
 *   python3 scripts/check-pricing-consistency.py
 * Le script scanne les 37 pages HTML à la recherche de motifs de prix,
 * associe chaque prix trouvé à la prestation la plus proche dans le texte, et
 * vérifie sa valeur contre PRICING_CONFIG (via le miroir JSON canonique
 * décrit ci-dessous). Il sort avec un code non-nul si une vraie incohérence
 * est trouvée.
 *
 * MIROIR JSON — LEQUEL EST LA SOURCE CANONIQUE
 * Le script Python n'embarque pas de moteur JS : il lit pricing-config.json,
 * un miroir strict de l'objet PRICING_CONFIG ci-dessous (mêmes clés, mêmes
 * valeurs, structure JSON valide). CE FICHIER (pricing-config.js) EST LA
 * SOURCE CANONIQUE — c'est lui que reserver.html charge réellement dans le
 * navigateur. pricing-config.json n'est qu'une projection technique pour le
 * script Python et DOIT être maintenu identique à la main à chaque édition.
 *
 * PROCÉDURE POUR TOUT CHANGEMENT DE PRIX FUTUR
 * 1. Modifier la valeur ici, dans PRICING_CONFIG (ce fichier).
 * 2. Reporter le même changement dans pricing-config.json (miroir).
 * 3. Relancer python3 scripts/check-pricing-consistency.py.
 * 4. Corriger chaque fichier HTML signalé par le script (le prix y reste
 *    écrit en dur, volontairement — voir plus haut).
 * 5. Vérifier reserver.html dans un navigateur (le tunnel doit refléter le
 *    nouveau prix sans autre modification, puisqu'il le lit depuis ce fichier).
 *
 * RÈGLE
 * N'invente aucun prix ici. Toute valeur ajoutée doit être vérifiée contre au
 * moins deux endroits déjà en production (ou l'historique git de correction
 * de prix) avant d'être considérée confirmée. En cas de doute, documenter
 * "ACTION HUMAINE REQUISE" dans le commentaire de l'entrée plutôt que de
 * trancher — voir livrables/SportVision/audit/PRICING_CENTRALISATION.md.
 * ============================================================================ */

const PRICING_CONFIG = {

  // ── Prestations à l'unité (catalogue, fiches prestations, reserver.html) ──
  // Clés alignées sur les data-slug de reserver.html quand la prestation y
  // apparaît, pour que le tunnel puisse indexer directement dessus.

  'match-photo': {
    label: 'Match photo',
    price: 120,
    unit: 'TTC',
    note: null,
    sources: ['index.html', 'prestations.html', 'prestation-match-photo.html', 'reserver.html'],
  },
  'match-video': {
    label: 'Match vidéo',
    price: 120,
    unit: 'TTC',
    note: null,
    sources: ['index.html', 'prestations.html', 'prestation-match-video.html', 'reserver.html'],
  },
  'pack-match': {
    label: 'Pack Match Complet',
    price: 160,
    unit: 'TTC',
    note: 'Match photo + Match vidéo combinés',
    sources: ['index.html', 'prestations.html', 'prestation-pack-match.html', 'reserver.html'],
  },
  'camera-isolee': {
    label: 'Caméra isolée joueur',
    price: 150,
    unit: 'TTC',
    note: 'Par joueur suivi',
    sources: ['prestations.html', 'prestation-camera-isolee.html', 'reserver.html'],
  },
  'match-filme-drone': {
    label: 'Match filmé drone',
    price: 120,
    unit: 'TTC',
    note: null,
    sources: ['prestations.html', 'reserver.html'],
  },
  'combo-drone-photo': {
    label: 'Combo Drone + Photo',
    price: 160,
    unit: 'TTC',
    note: null,
    sources: ['prestations.html', 'reserver.html'],
  },
  'match-camera-veo': {
    label: 'Match filmé caméra Véo',
    price: 120,
    unit: 'TTC',
    note: null,
    sources: ['prestations.html', 'reserver.html'],
  },
  'combo-veo-photo': {
    label: 'Combo Véo + Photo',
    price: 180,
    unit: 'TTC',
    note: null,
    sources: ['prestations.html', 'reserver.html'],
  },

  // Montage & compilation : pas de prix fixe unique, un tarif "à partir de"
  // (le palier le moins cher) + une grille de paliers. C'est l'incohérence
  // corrigée par l'audit du 30/08 (40/60/80/100 € TTC erronés partout ->
  // 39,90 € HT / 40-55-70-80 € HT confirmé). Valeur vérifiée dans
  // prestation-montage-compilation.html (hero + JSON-LD FAQ + FAQ visible),
  // index.html, prestations.html et reserver.html (select étape 3).
  'montage-compilation': {
    label: 'Montage & compilation',
    price: null,
    priceFrom: 39.90,
    unit: 'HT',
    note: 'À partir de 39,90 € HT — grille par volume de matière à monter',
    tiers: [
      { value: 'Rushs prédécoupés (≤6 min)', price: 39.90 },
      { value: '1 match complet', price: 40 },
      { value: '2 matchs complets', price: 55 },
      { value: '3 matchs complets', price: 70 },
      { value: '4 matchs complets', price: 80 },
      { value: '5 matchs et plus', price: null, note: 'Sur devis' },
    ],
    sources: ['index.html', 'prestations.html', 'prestation-montage-compilation.html', 'reserver.html'],
  },

  // ── Prestations sur devis (aucun prix public affiché — normal, pas un oubli) ──
  'shooting': { label: 'Shooting (joueur ou équipe)', price: null, note: 'Sur devis', sources: ['prestation-shooting-joueur.html', 'prestation-shooting-equipe.html', 'reserver.html'] },
  'couverture-tournoi': { label: 'Couverture tournoi', price: null, note: 'Sur devis', sources: ['prestation-tournois.html', 'reserver.html'] },
  'couverture-stage': { label: 'Couverture stage', price: null, note: 'Sur devis', sources: ['prestation-tournois.html', 'reserver.html'] },
  'creation-contenu': { label: 'Création graphique', price: null, note: 'Sur devis', sources: ['prestation-creations.html', 'reserver.html'] },
  'coach-preparateur': { label: 'Coach / préparateur', price: null, note: 'Sur devis', sources: ['prestation-coachs.html', 'reserver.html'] },
  'media-day': { label: 'Media Day', price: null, note: 'Sur devis', sources: ['prestation-media-day.html', 'reserver.html'] },

  // ── Options tarifées (s'ajoutent à une prestation à l'unité) ──
  'option-drone-veo': {
    label: 'Plans drone ou Véo complémentaires',
    price: 40,
    unit: 'TTC',
    note: 'Complément sur une prestation existante (match photo/vidéo, Pack Match, tournoi, stage)',
    sources: ['prestation-match-photo.html', 'prestation-match-video.html', 'prestation-pack-match.html', 'reserver.html'],
  },

  // ── Club+ (3 formules) — club-plus.html ──
  'club-plus-gratuit': {
    label: 'Club+ Gratuit',
    price: 0,
    unit: 'TTC/mois',
    engagement: null,
    users: 1,
    teams: 1,
    creditsPerMonth: 0,
    discountPct: 0,
    note: 'Sans engagement, résiliable à tout moment. Réservation au tarif standard.',
    sources: ['club-plus.html'],
  },
  'club-plus-start': {
    label: 'Club+ Start',
    price: 49,
    priceNoEngagement: 59,
    unit: 'TTC/mois',
    engagement: '12 mois (ou 59 €/mois sans engagement)',
    users: 5,
    teams: 2,
    creditsPerMonth: 10,
    discountPct: 5,
    note: 'Remise de 5 % sur les prestations ponctuelles éligibles SportVision — confirmée par Fouka le 11/08/2026, cf. PLAN_SERVICE_DISCOUNT_PCT dans SportVision-Connect/app-next/src/lib/types/services.ts (source de calcul réelle du panier Connect).',
    sources: ['club-plus.html'],
  },
  'club-plus-performance': {
    label: 'Club+ Performance',
    price: 129,
    priceNoEngagement: 139,
    unit: 'TTC/mois',
    engagement: '12 mois (ou 139 €/mois sans engagement)',
    users: 'Illimité',
    teams: 'Illimité',
    creditsPerMonth: 40,
    discountPct: 10,
    note: 'Remise de 10 % sur les prestations ponctuelles éligibles SportVision — même source que Club+ Start.',
    sources: ['club-plus.html'],
  },

  // Full Communication : aucun prix public affiché sur le site (accompagnement
  // sur devis, personnalisé par structure) — pas une prestation à catalogue.
  // Club+ est inclus dans l'accompagnement sans coût supplémentaire (wording
  // confirmé sur full-communication.html, JSON-LD FAQ + FAQ visible + section
  // formule). Entrée gardée ici pour que le script de vérification sache que
  // "Full Communication" est légitimement sans prix chiffré, plutôt que de le
  // signaler comme suspect.
  'full-communication': {
    label: 'Full Communication',
    price: null,
    note: 'Sur devis. Club+ inclus sans coût supplémentaire.',
    sources: ['full-communication.html', 'full-communication-academies.html', 'full-communication-clubs.html', 'full-communication-coachs.html', 'full-communication-evenements.html'],
  },

  // ── Mentions légales (pas une "prestation", mais un montant en € affiché) ──
  // Capital social de la SASU — inclus ici uniquement pour que le script de
  // vérification sache reconnaître ce montant et ne pas le signaler à tort
  // comme un tarif de prestation non reconnu.
  'capital-social': {
    label: 'Capital social SASU ELKANA GROUP',
    price: 1.00,
    unit: 'TTC',
    note: 'Mentions légales / CGV uniquement — pas un tarif commercial.',
    sources: ['mentions-legales.html', 'cgv.html'],
  },
};

// Export Node/CommonJS optionnel (inutilisé par le site statique, présent
// uniquement si un script Node venait un jour à consommer ce fichier).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PRICING_CONFIG;
}
