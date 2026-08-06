/* ══════════════════════════════════════════════════════════════════════
   SportVision Connect — Module « Projet : Nouvelle demande (configurateur) »

   Portage fidèle (mais autonome) du configurateur multi-étapes du Portail
   SportVision (référence lecture seule, jamais modifiée :
   livrables/SportVision-Portail/SportVision-Portail.html — voir
   CFG_STEPS / renderCfgStep() / submitDemande(), lignes ~1572-1874) vers
   Connect. C'est la dernière brique de l'espace « projet » restée hors
   périmètre lors du portage précédent (cf. le commentaire du module
   « notifications » dans projet-demandes-livrables-messagerie-compte.js,
   qui annonçait explicitement ce chantier séparé).

   Étapes portées (identiques au Portail) : offre → détails (date/lieu/
   équipe/horaire/catégorie) → options (+ frais de déplacement hors
   Île-de-France) → coordonnées (branche « connecté » uniquement, cf.
   ci-dessous) → confirmation.

   Dépendances globales fournies par le shell Connect (app/index.html) :
   sbFetch, sbRpc, sbFunction, esc, toast, et les variables/classes CSS
   (--card, --border, --radius, --shadow, --accent, --accent-2, --muted,
   --text, --ok, --danger, .btn, .btn-primary, .btn-ghost, .badge,
   .empty-state).

   Rappel d'architecture Connect v2 (cf. migration-connect-v2-organizations
   -entitlements.sql §3.2) : pour un espace « projet », organizations.id
   est EXACTEMENT ÉGAL à clients.id. Le paramètre orgId de render() EST
   donc directement client_id. ctx.role vaut toujours 'client' dans cet
   espace : contrairement au Portail public (qui gère un parcours
   « invité » via l'edge function create-guest-request lorsque
   !isLoggedIn()), un utilisateur Connect est TOUJOURS authentifié — seule
   la branche « connecté » de submitDemande() du Portail s'applique donc
   ici. La demande est créée par un INSERT DIRECT dans `prestations`
   (exactement le même mécanisme que le Portail, cf. migration-portail-v2
   .sql §2 — policy "prestations_client_insert" : statut forcé à
   'demande_reçue', tous les champs financiers/internes laissés null,
   client_id vérifié via client_users.id = auth.uid()). Aucune edge
   function, aucun RPC : ce n'est pas un choix, c'est ce que fait déjà le
   Portail pour un client connecté — on ne réinvente pas de chemin
   différent.

   Chaque module est autonome : tout son état vit dans une closure créée
   à chaque appel de render(), et les gestionnaires d'événements sont
   assignés via container.onclick = (jamais addEventListener), pour ne
   jamais accumuler de doublons quand render() est rejoué sur le même
   noeud.

   Règle de sécurité stricte du projet : toute URL dynamique doit être
   validée sur son schéma (http:// / https://) avant toute navigation ou
   tout rendu en lien cliquable. Ce module ne rend aucune URL dynamique
   (le catalogue n'expose qu'un nom/description/prix), mais isSafeHttpUrl
   est tout de même dupliquée ici par cohérence avec les autres fichiers
   modules — voir la note "écarts" dans le résumé de livraison si ce
   fichier est repris plus tard pour y ajouter un lien de paiement.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  window.ProjetModules = window.ProjetModules || {};

  /* ── Styles scopés, injectés une seule fois ── */
  function ensureStyles() {
    if (document.getElementById('pjcfg-styles')) return;
    var style = document.createElement('style');
    style.id = 'pjcfg-styles';
    style.textContent = [
      '.pjcfg-wrap{color:var(--text)}',
      '.pjcfg-header{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}',
      '.pjcfg-eyebrow{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.5px;text-transform:uppercase}',
      '.pjcfg-progress{height:6px;border-radius:999px;background:var(--border);overflow:hidden}',
      '.pjcfg-progress-bar{height:100%;background:var(--accent);border-radius:999px;transition:width .2s ease}',
      '.pjcfg-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:20px}',
      '.pjcfg-card h2{margin:0 0 18px;font-size:21px}',
      '.pjcfg-faint{color:var(--muted);font-size:13.5px;margin:-10px 0 18px}',
      '.pjcfg-offer-row{display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer}',
      '.pjcfg-offer-row:hover{border-color:var(--accent)}',
      '.pjcfg-offer-row.sel{border-color:var(--accent);background:rgba(0,0,0,.02)}',
      '.pjcfg-offer-row b{font-size:14.5px}',
      '.pjcfg-offer-desc{font-size:12.5px;color:var(--muted);margin-top:2px}',
      '.pjcfg-price{font-weight:800;color:var(--accent);white-space:nowrap;flex-shrink:0}',
      '.pjcfg-field{margin-bottom:14px}',
      '.pjcfg-field label{display:block;font-size:12.5px;font-weight:600;margin-bottom:5px;color:var(--muted)}',
      '.pjcfg-field input,.pjcfg-field textarea{width:100%;padding:10px 11px;border:1px solid var(--border);border-radius:9px;font-size:14px;font-family:inherit;box-sizing:border-box}',
      '.pjcfg-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '@media (max-width:560px){.pjcfg-row2{grid-template-columns:1fr}}',
      '.pjcfg-note-card{border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-top:16px;font-size:13px;color:var(--muted)}',
      '.pjcfg-waiver{display:flex;gap:10px;align-items:flex-start;margin-top:10px;font-size:13.5px;line-height:1.5}',
      '.pjcfg-waiver input{width:auto;margin-top:3px}',
      '.pjcfg-err{color:var(--danger);font-size:13px;margin:10px 0 0}',
      '.pjcfg-nav{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:16px}',
      '.pjcfg-nav .btn{width:auto;margin-top:0}',
      '.pjcfg-confirm{text-align:center;padding:20px 0}',
      '.pjcfg-check{width:56px;height:56px;border-radius:50%;background:rgba(31,169,113,.15);border:1px solid rgba(31,169,113,.4);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:24px;color:var(--ok)}',
      '.pjcfg-confirm h2{margin:0 0 12px;font-size:21px}',
      '.pjcfg-confirm p{max-width:460px;margin:0 auto 20px;color:var(--muted);font-size:14px}',
      '.pjcfg-confirm-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}',
      '.pjcfg-confirm-actions .btn{width:auto;margin-top:0}',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* Cf. avertissement de sécurité en tête de fichier : dupliquée ici par
   * cohérence avec les autres modules Projet, non utilisée pour l'instant
   * (aucune URL dynamique rendue par ce module). */
  function isSafeHttpUrl(url) { return typeof url === 'string' && /^https?:\/\//i.test(url.trim()); }

  /* Navigation vers un autre onglet de l'espace « projet » — même
   * technique que dans projet-dashboard-devis-contrats-factures.js
   * (goTab) : on simule un clic sur l'onglet déjà rendu par le shell,
   * seul point d'ancrage stable qui ne dépend pas d'une fonction interne
   * du shell. */
  function goTab(key) {
    var btn = document.querySelector('.workspace-tab[data-key="' + key + '"]');
    if (btn) { btn.click(); }
    else { toast('Utilisez les onglets en haut de la page pour naviguer.'); }
  }

  var CFG_STEPS = ['offre', 'details', 'options', 'coordonnees', 'confirmation'];
  var CFG_EXTRA_FIELDS = ['matchAdversaire', 'matchCategorieAge', 'matchStade', 'tournoiJours', 'tournoiEquipes', 'tournoiSponsors', 'shootingObjectif', 'shootingLieu', 'contenuPlateformes', 'contenuFrequence'];
  var CFG_EXTRA_LABELS = {
    matchAdversaire: 'Adversaire', matchCategorieAge: 'Catégorie/âge', matchStade: 'Stade',
    tournoiJours: 'Jours', tournoiEquipes: 'Équipes/participants', tournoiSponsors: 'Sponsors',
    shootingObjectif: 'Objectif', shootingLieu: 'Lieu souhaité',
    contenuPlateformes: 'Plateformes', contenuFrequence: 'Fréquence',
  };

  // Siège SportVision (Elkana Group), 4 Place Pierre Sémard, 77130 Montereau-Fault-Yonne
  // — mêmes constantes que le Portail (SIEGE_LAT/SIEGE_LON/TARIF_KM_TTC).
  var SIEGE_LAT = 48.380247, SIEGE_LON = 2.943271;
  var TARIF_KM_TTC = 0.50; // €/km, aller-retour, hors Île-de-France uniquement

  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371, toRad = function (d) { return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  window.ProjetModules.nouvelleDemande = {
    label: 'Nouvelle demande',
    espace: 'projet',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      var catalogue = null;

      function freshState() {
        var s = {
          step: 0, offreId: null, date: '', heure: '', ville: '', adresse: '', cp: '',
          sport: '', equipes: '', commentaire: '', options: [],
          retractationRenoncee: false, distanceKm: null, fraisDeplacementHt: null, horsIdf: false,
          reference: null, err: '',
        };
        CFG_EXTRA_FIELDS.forEach(function (f) { s[f] = ''; });
        return s;
      }
      var state = freshState();

      async function loadCatalogue() {
        if (catalogue) return catalogue;
        var r = await sbFetch('catalogue_offres?actif=eq.true&order=ordre.asc');
        catalogue = r.ok ? (r.data || []) : [];
        return catalogue;
      }

      function currentOffer() {
        return (catalogue || []).find(function (o) { return o.id === state.offreId; }) || null;
      }

      function priceLabel(o) {
        return (o.tarif_type === 'fixe' && o.prix_ht != null)
          ? (Math.round(o.prix_ht * 1.2 * 100) / 100).toLocaleString('fr-FR') + ' € TTC'
          : 'Sur devis';
      }

      function categoryGroup(categorie) {
        if (['photo', 'video', 'pack', 'drone', 'veo'].indexOf(categorie) !== -1) return 'match';
        if (['tournoi', 'stage'].indexOf(categorie) !== -1) return 'tournoi';
        if (categorie === 'shooting') return 'shooting';
        if (categorie === 'contenu') return 'contenu';
        return null;
      }

      var CATEGORY_FIELD_IDS = {
        match: ['matchAdversaire', 'matchCategorieAge', 'matchStade'],
        tournoi: ['tournoiJours', 'tournoiEquipes', 'tournoiSponsors'],
        shooting: ['shootingObjectif', 'shootingLieu'],
        contenu: ['contenuPlateformes', 'contenuFrequence'],
      };

      function categoryExtraHtml(categorie) {
        var group = categoryGroup(categorie);
        if (group === 'match') return '<div class="pjcfg-row2">'
          + '<div class="pjcfg-field"><label>Adversaire</label><input type="text" id="pjcfg-matchAdversaire" value="' + esc(state.matchAdversaire) + '"></div>'
          + '<div class="pjcfg-field"><label>Catégorie / âge</label><input type="text" id="pjcfg-matchCategorieAge" value="' + esc(state.matchCategorieAge) + '"></div>'
          + '<div class="pjcfg-field"><label>Stade / complexe</label><input type="text" id="pjcfg-matchStade" value="' + esc(state.matchStade) + '"></div>'
          + '</div>';
        if (group === 'tournoi') return '<div class="pjcfg-row2">'
          + '<div class="pjcfg-field"><label>Nombre de jours</label><input type="text" id="pjcfg-tournoiJours" value="' + esc(state.tournoiJours) + '"></div>'
          + '<div class="pjcfg-field"><label>Nombre d’équipes / participants</label><input type="text" id="pjcfg-tournoiEquipes" value="' + esc(state.tournoiEquipes) + '"></div>'
          + '<div class="pjcfg-field"><label>Sponsors à valoriser</label><input type="text" id="pjcfg-tournoiSponsors" value="' + esc(state.tournoiSponsors) + '"></div>'
          + '</div>';
        if (group === 'shooting') return '<div class="pjcfg-row2">'
          + '<div class="pjcfg-field"><label>Objectif du contenu</label><input type="text" id="pjcfg-shootingObjectif" value="' + esc(state.shootingObjectif) + '" placeholder="Ex : book joueur, réseaux sociaux..."></div>'
          + '<div class="pjcfg-field"><label>Lieu souhaité</label><input type="text" id="pjcfg-shootingLieu" value="' + esc(state.shootingLieu) + '"></div>'
          + '</div>';
        if (group === 'contenu') return '<div class="pjcfg-row2">'
          + '<div class="pjcfg-field"><label>Plateformes visées</label><input type="text" id="pjcfg-contenuPlateformes" value="' + esc(state.contenuPlateformes) + '" placeholder="Instagram, TikTok, LinkedIn..."></div>'
          + '<div class="pjcfg-field"><label>Fréquence souhaitée</label><input type="text" id="pjcfg-contenuFrequence" value="' + esc(state.contenuFrequence) + '" placeholder="Ponctuel, mensuel..."></div>'
          + '</div>';
        return '';
      }

      function collectCategoryExtra(categorie) {
        var ids = CATEGORY_FIELD_IDS[categoryGroup(categorie)] || [];
        ids.forEach(function (id) {
          var el = container.querySelector('#pjcfg-' + id);
          if (el) state[id] = el.value;
        });
      }

      function buildCommentaire() {
        var o = currentOffer();
        var group = o ? categoryGroup(o.categorie) : null;
        var ids = CATEGORY_FIELD_IDS[group] || [];
        var extra = ids.filter(function (id) { return state[id]; })
          .map(function (id) { return CFG_EXTRA_LABELS[id] + ' : ' + state[id]; }).join(' — ');
        var frais = (state.horsIdf && state.fraisDeplacementHt != null)
          ? 'Frais de déplacement (hors Île-de-France, ' + state.distanceKm + ' km A/R) : ' + (Math.round(state.fraisDeplacementHt * 1.2 * 100) / 100).toLocaleString('fr-FR') + ' € TTC à ajouter au devis.'
          : '';
        return [state.commentaire, extra, frais].filter(Boolean).join('\n\n');
      }

      function needsRetractationWaiver() {
        if (!state.date) return false;
        var d = new Date(state.date + 'T00:00:00');
        if (isNaN(d.getTime())) return false;
        var diffDays = Math.ceil((d - new Date(new Date().toDateString())) / 86400000);
        return diffDays >= 0 && diffDays < 14;
      }

      async function computeFraisDeplacement() {
        state.distanceKm = null; state.fraisDeplacementHt = null; state.horsIdf = false;
        var query = [state.adresse, state.cp, state.ville].filter(Boolean).join(' ');
        if (!query) return;
        try {
          var url = 'https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(query) + '&limit=1';
          var res = await fetch(url);
          var r = await res.json();
          var f = r.features && r.features[0];
          if (!f) return;
          var context = f.properties.context || '';
          var horsIdf = context.indexOf('Île-de-France') === -1;
          if (!horsIdf) return; // dans le rayon Île-de-France : pas de frais
          var lon = f.geometry.coordinates[0], lat = f.geometry.coordinates[1];
          var distanceAllerRetour = haversineKm(SIEGE_LAT, SIEGE_LON, lat, lon) * 2;
          state.distanceKm = Math.round(distanceAllerRetour * 10) / 10;
          state.horsIdf = true;
          var fraisTtc = distanceAllerRetour * TARIF_KM_TTC;
          state.fraisDeplacementHt = Math.round((fraisTtc / 1.2) * 100) / 100;
        } catch (e) {
          // Best-effort : en cas d'échec de géolocalisation, on n'ajoute aucun
          // frais plutôt que de bloquer l'envoi de la demande (idem Portail).
        }
      }

      function fieldVal(id) {
        var el = container.querySelector('#' + id);
        return el ? el.value : '';
      }

      function collectStepFields(key) {
        if (key === 'details') {
          state.date = fieldVal('pjcfg-date');
          state.heure = fieldVal('pjcfg-heure');
          state.ville = fieldVal('pjcfg-ville');
          state.cp = fieldVal('pjcfg-cp');
          state.adresse = fieldVal('pjcfg-adresse');
          state.sport = fieldVal('pjcfg-sport');
          state.equipes = fieldVal('pjcfg-equipes');
          state.commentaire = fieldVal('pjcfg-commentaire');
          var o = currentOffer();
          collectCategoryExtra(o ? o.categorie : null);
        }
        if (key === 'coordonnees') {
          var rc = container.querySelector('#pjcfg-retractation');
          if (rc) state.retractationRenoncee = rc.checked;
        }
      }

      /* ── Rendu du corps de chaque étape (mêmes 5 étapes que le Portail) ── */
      function stepBodyHtml(key) {
        if (key === 'offre') {
          var rows = (catalogue || []).map(function (o) {
            return '<div class="pjcfg-offer-row' + (state.offreId === o.id ? ' sel' : '') + '" data-action="select-offer" data-id="' + esc(o.id) + '">'
              + '<div><b>' + esc(o.nom) + '</b><div class="pjcfg-offer-desc">' + esc(o.description || '') + '</div></div>'
              + '<span class="pjcfg-price">' + priceLabel(o) + '</span></div>';
          }).join('');
          return '<h2>Votre prestation</h2>' + (rows || '<div class="empty-state">Aucune prestation disponible pour le moment.</div>');
        }

        if (key === 'details') {
          var o2 = currentOffer();
          var todayMin = new Date().toISOString().slice(0, 10);
          return '<h2>Date, lieu et détails</h2>'
            + (o2 ? '<p class="pjcfg-faint">Prestation : <b style="color:var(--text)">' + esc(o2.nom) + '</b></p>' : '')
            + '<div class="pjcfg-row2">'
            + '<div class="pjcfg-field"><label>Date souhaitée</label><input type="date" id="pjcfg-date" min="' + todayMin + '" value="' + esc(state.date) + '"></div>'
            + '<div class="pjcfg-field"><label>Heure souhaitée</label><input type="time" id="pjcfg-heure" value="' + esc(state.heure) + '"></div>'
            + '<div class="pjcfg-field"><label>Ville</label><input type="text" id="pjcfg-ville" value="' + esc(state.ville) + '"></div>'
            + '<div class="pjcfg-field"><label>Code postal</label><input type="text" id="pjcfg-cp" value="' + esc(state.cp) + '"></div>'
            + '</div>'
            + '<div class="pjcfg-field"><label>Adresse</label><input type="text" id="pjcfg-adresse" value="' + esc(state.adresse) + '"></div>'
            + '<div class="pjcfg-row2">'
            + '<div class="pjcfg-field"><label>Sport</label><input type="text" id="pjcfg-sport" value="' + esc(state.sport) + '"></div>'
            + '<div class="pjcfg-field"><label>Équipe(s) / participants</label><input type="text" id="pjcfg-equipes" value="' + esc(state.equipes) + '"></div>'
            + '</div>'
            + categoryExtraHtml(o2 ? o2.categorie : null)
            + '<div class="pjcfg-field"><label>Commentaire ou besoin précis</label><textarea id="pjcfg-commentaire" rows="3">' + esc(state.commentaire) + '</textarea></div>';
        }

        if (key === 'options') {
          var o3 = currentOffer();
          var opts = (o3 && Array.isArray(o3.options)) ? o3.options : [];
          var optsHtml = opts.map(function (op) {
            var sel = state.options.indexOf(op.nom) !== -1;
            return '<div class="pjcfg-offer-row' + (sel ? ' sel' : '') + '" data-action="toggle-option" data-nom="' + esc(op.nom) + '">'
              + '<b>' + esc(op.nom) + '</b>'
              + '<span class="pjcfg-price">' + (sel ? '−' : '+') + (Math.round((op.prix_ht || 0) * 1.2 * 100) / 100).toLocaleString('fr-FR') + ' € TTC</span></div>';
          }).join('');
          var frais = (state.horsIdf && state.fraisDeplacementHt != null)
            ? '<div class="pjcfg-note-card"><b style="color:var(--text)">Frais de déplacement</b><p style="margin:6px 0 0">Lieu hors Île-de-France (environ ' + state.distanceKm + ' km aller-retour depuis notre siège) : <b style="color:var(--text)">+' + (Math.round(state.fraisDeplacementHt * 1.2 * 100) / 100).toLocaleString('fr-FR') + ' € TTC</b></p></div>'
            : (state.distanceKm === null && state.ville ? '<p class="pjcfg-faint" style="margin-top:14px">Lieu en Île-de-France ou non géolocalisable : aucun frais de déplacement appliqué.</p>' : '');
          return '<h2>Options</h2>'
            + (optsHtml || '<p class="pjcfg-faint" style="margin-bottom:0">Aucune option disponible pour cette prestation.</p>')
            + frais;
        }

        if (key === 'coordonnees') {
          return '<h2>Vos coordonnées</h2>'
            + '<p class="pjcfg-faint">Vous êtes connecté : votre demande sera directement rattachée à votre espace.</p>'
            + (needsRetractationWaiver()
              ? '<label class="pjcfg-waiver"><input type="checkbox" id="pjcfg-retractation" ' + (state.retractationRenoncee ? 'checked' : '') + '>'
                + '<span>Votre prestation est prévue dans moins de 14 jours. Je demande l’exécution immédiate de la prestation et je renonce expressément à mon droit de rétractation de 14 jours (article L221-18 du Code de la consommation). Voir nos CGV.</span></label>'
              : '')
            + (state.err ? '<div class="pjcfg-err">' + esc(state.err) + '</div>' : '');
        }

        if (key === 'confirmation') {
          return '<div class="pjcfg-confirm">'
            + '<div class="pjcfg-check">✓</div>'
            + '<h2>Demande envoyée</h2>'
            + '<p>Votre demande a bien été transmise à SportVision. Référence : <b style="color:var(--text)">' + esc(state.reference || '—') + '</b></p>'
            + '<div class="pjcfg-confirm-actions">'
            + '<button type="button" class="btn btn-primary" data-action="goto-dashboard">Retour à mon espace</button>'
            + '<button type="button" class="btn btn-ghost" data-action="restart">Faire une nouvelle demande</button>'
            + '</div></div>';
        }

        return '';
      }

      async function paint() {
        await loadCatalogue();
        var key = CFG_STEPS[state.step];
        var pct = Math.round(((state.step + 1) / CFG_STEPS.length) * 100);
        var navHtml = key === 'confirmation' ? '' : (
          '<div class="pjcfg-nav">'
          + '<button type="button" class="btn btn-ghost" data-action="prev" style="visibility:' + (state.step === 0 ? 'hidden' : 'visible') + '">‹ Précédent</button>'
          + '<button type="button" class="btn btn-primary" id="pjcfg-next-btn" data-action="next">' + (key === 'coordonnees' ? 'Envoyer ma demande' : 'Suivant') + '</button>'
          + '</div>'
        );
        container.innerHTML = '<div class="pjcfg-wrap">'
          + '<div class="pjcfg-header">'
          + '<span class="pjcfg-eyebrow">ÉTAPE ' + (state.step + 1) + ' / ' + CFG_STEPS.length + '</span>'
          + '<div class="pjcfg-progress"><div class="pjcfg-progress-bar" style="width:' + pct + '%"></div></div>'
          + '</div>'
          + '<div class="pjcfg-card">' + stepBodyHtml(key) + '</div>'
          + navHtml
          + '</div>';
      }

      async function submit() {
        var btn = container.querySelector('#pjcfg-next-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
        try {
          var commentaireFinal = buildCommentaire();
          var retractation = needsRetractationWaiver() && state.retractationRenoncee;
          // Même mécanisme que le Portail pour un client connecté (cf.
          // submitDemande() côté Portail, branche isLoggedIn()) : INSERT
          // direct dans `prestations`, jamais via une edge function — la
          // policy RLS "prestations_client_insert" (migration-portail-v2
          // .sql) force le statut initial et neutralise tous les champs
          // financiers/internes.
          var insert = await sbFetch('prestations', {
            method: 'POST',
            body: {
              statut: 'demande_reçue',
              client_id: orgId,
              offre_id: state.offreId,
              options_selectionnees: state.options,
              date_prestation: state.date || null,
              heure_debut: state.heure || null,
              lieu: state.ville || null,
              adresse_complete: [state.adresse, state.cp, state.ville].filter(Boolean).join(', ') || null,
              sport: state.sport || null,
              equipes: state.equipes || null,
              description_besoin: commentaireFinal || null,
              retractation_renoncee: retractation,
              retractation_renoncee_at: retractation ? new Date().toISOString() : null,
              distance_km: state.distanceKm,
              frais_deplacement_ht: state.fraisDeplacementHt,
            },
          });
          if (!insert.ok) throw new Error("Impossible d'envoyer la demande. Réessayez.");
          state.reference = (insert.data && insert.data[0]) ? insert.data[0].reference : null;
          state.err = '';
          state.step = CFG_STEPS.length - 1;
          await paint();
        } catch (e) {
          state.err = e.message || "Impossible d'envoyer la demande. Réessayez.";
          await paint();
        }
      }

      async function goNext() {
        var key = CFG_STEPS[state.step];
        if (key === 'offre' && !state.offreId) { toast('Merci de sélectionner une prestation.'); return; }
        collectStepFields(key);
        if (key === 'details' && (!state.date || !state.ville)) { toast('Merci de renseigner au moins la date et la ville.'); return; }
        if (key === 'details') {
          var btn = container.querySelector('#pjcfg-next-btn');
          if (btn) { btn.disabled = true; btn.textContent = 'Calcul…'; }
          await computeFraisDeplacement();
        }
        if (key === 'coordonnees') {
          if (needsRetractationWaiver() && !state.retractationRenoncee) {
            state.err = 'Merci de cocher la case de renonciation au droit de rétractation pour continuer.';
            await paint();
            return;
          }
          state.err = '';
          await submit();
          return;
        }
        state.step = Math.min(CFG_STEPS.length - 1, state.step + 1);
        state.err = '';
        await paint();
      }

      container.onclick = function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-action');
        if (action === 'select-offer') {
          state.offreId = btn.getAttribute('data-id');
          paint();
        } else if (action === 'toggle-option') {
          var nom = btn.getAttribute('data-nom');
          state.options = state.options.indexOf(nom) !== -1
            ? state.options.filter(function (o) { return o !== nom; })
            : state.options.concat([nom]);
          paint();
        } else if (action === 'prev') {
          if (state.step > 0) { state.step--; state.err = ''; paint(); }
        } else if (action === 'next') {
          goNext();
        } else if (action === 'goto-dashboard') {
          goTab('dashboard');
        } else if (action === 'restart') {
          state = freshState();
          paint();
        }
      };

      container.innerHTML = '<div class="pjcfg-wrap"><div class="empty-state">Chargement…</div></div>';
      await paint();
    },
  };
})();
