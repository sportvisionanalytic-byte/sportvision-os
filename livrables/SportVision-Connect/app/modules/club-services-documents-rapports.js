/* ============================================================
 * SportVision Connect — Module Club
 * Prestations SportVision · Documents · Rapports
 *
 * Port fidèle (mais autonome) des équivalents dans Club+ (app.html, en
 * lecture seule, jamais modifié) : tplServices()/openBookingWizard()/
 * submitBooking() (club_bookings), tplDocsFinance() (devis/factures/
 * contrats du club) et tplRapports(). Vanilla JS, aucune dépendance.
 *
 * S'appuie sur les globales déjà fournies par le shell Connect
 * (index.html, chargé avant ce fichier) : sbFetch, esc, toast, ainsi que
 * les variables CSS --card/--border/--radius/--shadow/--accent/--accent-2/
 * --muted/--text/--ok/--danger/--warn et les classes .btn/.btn-primary/
 * .btn-ghost/.badge (définies dans index.html).
 *
 * Architecture : chaque entrée de window.ClubModules est autonome — son
 * render(container, orgId, ctx) recrée un état dans une closure dédiée à
 * chaque appel, et rejoue container.innerHTML + les gestionnaires
 * d'événements (assignés via container.onclick =, jamais addEventListener,
 * pour ne jamais accumuler de doublons quand render() est rappelé sur le
 * même noeud). orgId === clubs.id (même UUID que organizations.id).
 *
 * Réutilise le même id de style partagé ('cm-shared-style') et les mêmes
 * classes .cm-* que club-demandes-medias-sponsors-admin.js — les deux
 * fichiers sont chargés dans la même page, ensureStyles() est idempotente
 * (no-op si l'autre fichier a déjà injecté le style), donc peu importe
 * lequel des deux se charge en premier.
 *
 * ── Divergences volontaires par rapport à Club+ (détaillées à chaque
 * endroit concerné ci-dessous, résumé ici) ──
 *
 * 1. Lien club → fiche client OS : Club+ (REAL.portailClientId,
 *    loadRealDocuments()) utilise `clubs.portail_client_id`, PAS
 *    `clubs.client_id`. Vérifié en base (schéma OpenAPI PostgREST prod,
 *    2026-08-07) : les deux colonnes existent actuellement, mais
 *    migration-cm-club-link-fix.sql (déjà commitée) supprime
 *    `clubs.client_id` en expliquant qu'elle duplique par erreur
 *    `portail_client_id` (le vrai lien, posé automatiquement depuis
 *    migration-clubplus-v12.sql par les Edge Functions clubplus-activate/
 *    clubplus-onboarding). Ce module utilise donc portail_client_id,
 *    comme Club+ lui-même — pas la colonne clubs.client_id ajoutée puis
 *    retirée le même jour par une migration parallèle.
 *
 * 2. Accès RLS aux vues client_devis/client_factures/client_contrats :
 *    même avec portail_client_id renseigné, ces vues (migration-portail-
 *    v1.sql/v8.sql) ne filtraient jusqu'ici que via `client_users`, une
 *    table peuplée pour UNE seule personne par club (celle qui a activé/
 *    créé le club). Tout autre membre (coach, secrétaire, etc.) obtenait
 *    donc zéro ligne, même club correctement lié — un vrai trou déjà
 *    présent dans Club+ (jamais corrigé), pas une régression introduite
 *    ici. Corrigé par une migration neuve, non exécutée par cet agent :
 *    livrables/SportVision-TV/migration-clubplus-v32-club-documents-
 *    access.sql — étend le `where exists` des 3 vues avec une branche
 *    club_members/clubs.portail_client_id.
 *
 * 3. Documents reste strictement en LECTURE SEULE (comme tplDocsFinance()
 *    : « Les devis et factures SportVision se signent et se paient depuis
 *    SportVision Connect »). Ce module ne reproduit PAS les actions
 *    accepter/refuser un devis, payer une facture ou signer un contrat
 *    que l'espace « Projet » individuel propose (voir modules/projet-
 *    dashboard-devis-contrats-factures.js) : Club+ ne les avait jamais
 *    implémentées côté club et rien dans la mission ne demandait de les
 *    ajouter. Si un club doit un jour pouvoir accepter/payer/signer
 *    directement depuis l'Espace Club, c'est une extension délibérée à
 *    trancher séparément, pas quelque chose à ajouter silencieusement ici.
 *
 * 4. Rapports : tplRapports() affiche, même en session réelle (REAL), un
 *    grand nombre de chiffres purement codés en dur dans le template
 *    (« 18/20 Résultats transmis », « 2 Retards ce mois-ci », « 24 »/« 19 »/
 *    « 1,4 j » pour la communication, la répartition « Affiches 45% /
 *    Stories 25%… », « 9/13 contreparties », « 32 publications
 *    sponsorisées », « 2 engagements en retard ») — jamais calculés depuis
 *    une vraie table, y compris quand REAL est actif (vérifié en lisant
 *    app.html : ce sont des littéraux dans le template, pas des valeurs
 *    dérivées de teamsSource()/requestsSource()/etc., à l'exception des
 *    quelques stats notées "réel" ci-dessous). Les présenter tel quel à un
 *    dirigeant de club comme des indicateurs réels serait trompeur. Ce
 *    module ne garde donc que les statistiques réellement calculables
 *    depuis des tables existantes, et le dit explicitement quand une
 *    métrique n'est pas encore suivie plutôt que d'afficher un chiffre
 *    inventé. Détail par onglet dans window.ClubModules.rapports plus bas.
 *
 * 5. Assistant de réservation en 3 étapes (type → détails → récapitulatif)
 *    plutôt que les 2 étapes de Club+ (détails+récap fusionnés) : aligné
 *    sur le pattern déjà établi par l'assistant "Nouvelle demande" de
 *    club-demandes-medias-sponsors-admin.js (étape 1 = choix du type en
 *    grille de cartes), pour rester cohérent avec le reste de Connect.
 *    Le champ "Équipe" est un champ texte libre (comme team/mf-team/cf-team
 *    ailleurs dans Connect), pas un <select> alimenté par club_teams comme
 *    dans Club+ — aucun module Connet existant ne fait ce choix non plus.
 * ============================================================ */
(function () {
  'use strict';

  /* ── Styles partagés (identiques à club-demandes-medias-sponsors-admin.js) ── */
  function ensureStyles() {
    if (document.getElementById('cm-shared-style')) return;
    const style = document.createElement('style');
    style.id = 'cm-shared-style';
    style.textContent = `
      .cm-wrap .btn{width:auto;margin-top:0}
      .cm-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .cm-toolbar h2{margin:0;font-size:19px}
      .cm-pillbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .cm-pill{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;padding:6px 14px;font-size:12.5px;cursor:pointer;font-weight:600}
      .cm-pill:not(.on):hover{border-color:var(--accent);color:var(--text)}
      .cm-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}
      .cm-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted)}
      .cm-list{display:flex;flex-direction:column;gap:8px}
      .cm-row{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit}
      .cm-row:hover{border-color:var(--accent)}
      .cm-row .t{font-weight:700;font-size:14px}
      .cm-row .m{color:var(--muted);font-size:12px;margin-top:2px}
      .cm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
      .cm-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;text-align:left;cursor:pointer;font:inherit;color:inherit}
      .cm-card:hover{border-color:var(--accent)}
      .cm-card .thumb{height:84px;border-radius:8px;background:linear-gradient(135deg,rgba(157,174,195,.15),var(--border));display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px;text-align:center;padding:8px;overflow:hidden}
      .cm-field{margin-bottom:12px}
      .cm-field label{display:block;font-size:12.5px;font-weight:600;margin-bottom:5px}
      .cm-field input,.cm-field select,.cm-field textarea{width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box}
      .cm-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .cm-overlay{position:fixed;inset:0;background:rgba(10,14,30,.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000;overflow:auto}
      .cm-modal{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px;max-width:460px;width:100%;max-height:88vh;overflow:auto}
      .cm-modal.wide{max-width:640px}
      .cm-drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
      .cm-close{background:transparent;border:none;font-size:18px;cursor:pointer;color:var(--muted);line-height:1;padding:2px}
      .cm-comment{background:rgba(0,0,0,.03);border-radius:10px;padding:8px 10px;margin-bottom:6px;font-size:12.5px}
      .cm-info{border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12.5px;margin-bottom:12px}
      .cm-warn{border-color:#F0A94E55;background:rgba(226,160,63,.08)}
      .cm-actions{display:flex;flex-direction:column;gap:8px;margin-top:14px}
      .cm-inline-row{display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(0,0,0,.03);border-radius:10px;padding:9px 12px;margin-bottom:6px;font-size:12.5px}
      .cm-player-list{max-height:190px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px 8px;background:var(--card)}
      .cm-player-row{display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:13px;cursor:pointer}
      .cm-player-row input[type=checkbox]{width:auto;flex:none}
      .cm-player-empty{color:var(--muted);font-size:12.5px;padding:4px 2px}
    `;
    document.head.appendChild(style);
  }

  /* ── Styles propres à ce fichier (statistiques, barres) ── */
  function ensureCsdStyles() {
    if (document.getElementById('csd-style')) return;
    const style = document.createElement('style');
    style.id = 'csd-style';
    style.textContent = `
      .csd-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px}
      .csd-stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px}
      .csd-stat b{display:block;font-size:22px;font-weight:800;color:var(--accent)}
      .csd-stat span{font-size:12px;color:var(--muted)}
      .csd-bar-row{margin-bottom:12px}
      .csd-bar-row:last-child{margin-bottom:0}
      .csd-bar-row .top{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px}
      .csd-bar{height:6px;border-radius:4px;background:var(--border);overflow:hidden}
      .csd-bar i{display:block;height:100%;background:var(--accent);border-radius:4px}
      .csd-offer-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
      .csd-offer-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px}
      .csd-offer-card .t{font-weight:700;font-size:14.5px;margin-bottom:6px}
      .csd-offer-card .d{color:var(--muted);font-size:12.5px;line-height:1.5;margin-bottom:10px}
      .csd-offer-card .delai{color:var(--muted);font-size:11.5px;margin-bottom:10px}
      .csd-offer-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
      .csd-offer-price{font-size:15px;font-weight:800}
      .csd-offer-adv{font-size:10.5px;color:var(--accent-2);font-weight:600}
      .csd-pipeline-step{display:flex;align-items:center;gap:8px;padding:4px 0}
      .csd-pipeline-dot{width:8px;height:8px;border-radius:4px;flex-shrink:0}
      .csd-doc-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    `;
    document.head.appendChild(style);
  }

  /* ── Formattage / libellés partagés à ce fichier ── */
  function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d.getTime())) return esc(String(v));
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function isSafeHttpUrl(u) { return typeof u === 'string' && /^https?:\/\//i.test(u.trim()); }
  function badge(map, key) {
    const m = map[key] || { label: key || '—', color: 'var(--muted)' };
    return '<span class="badge" style="background:' + m.color + '22;color:' + m.color + '">' + esc(m.label) + '</span>';
  }

  window.ClubModules = window.ClubModules || {};

  /* ============================================================
   * 1. PRESTATIONS SPORTVISION (catalogue_offres + club_bookings)
   * ============================================================ */
  window.ClubModules.services = {
    label: 'Prestations SportVision',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      ensureCsdStyles();

      // Pipeline terrain d'une réservation, identique à Club+ (openBookingDrawer) :
      // recue → qualifiee → confirmee → operateur_affecte → mission_realisee → livree.
      // Distinct des statuts de club_requests ('recues' pluriel, autre table) — pas
      // de collision possible, ce fichier est une closure indépendante.
      const BOOKING_STEPS = ['recue', 'qualifiee', 'confirmee', 'operateur_affecte', 'mission_realisee', 'livree'];
      const BOOKING_STEP_LABELS = ['Reçue', 'Besoin qualifié', 'Confirmée', 'Opérateur affecté', 'Mission réalisée', 'Livrée'];
      const BOOKING_STATUS_META = {
        recue: { label: 'Reçue', color: 'var(--accent)' },
        qualifiee: { label: 'Besoin qualifié', color: 'var(--purple)' },
        confirmee: { label: 'Confirmée', color: 'var(--purple)' },
        operateur_affecte: { label: 'Opérateur affecté', color: '#e2a03f' },
        mission_realisee: { label: 'Mission réalisée', color: 'var(--accent-2)' },
        livree: { label: 'Livrée', color: 'var(--ok)' },
      };

      let view = 'catalogue'; // 'catalogue' | 'reservations'
      let catalog = [];
      let bookings = [];
      let clubPlan = 'club'; // 'club' | 'performance' — clubs.plan, défaut 'club' si non renseigné
      let loaded = false;
      let openId = null;
      let wizard = null; // {step, type(=catalogue_offres.id), team, date, heure, adresse}

      async function load() {
        const [catRes, bkRes, clubRes] = await Promise.all([
          sbFetch('catalogue_offres?actif=eq.true&select=id,nom,description,tarif_type,prix_ht,duree_estimee&order=ordre.asc'),
          sbFetch('club_bookings?club_id=eq.' + orgId + '&select=*&order=created_at.desc'),
          sbFetch('clubs?id=eq.' + orgId + '&select=plan'),
        ]);
        if (!catRes.ok || !bkRes.ok) toast('Erreur de chargement.');
        catalog = catRes.ok ? (catRes.data || []) : [];
        bookings = bkRes.ok ? (bkRes.data || []) : [];
        clubPlan = (clubRes.ok && clubRes.data && clubRes.data[0] && clubRes.data[0].plan === 'performance') ? 'performance' : 'club';
        loaded = true;
      }

      function reductionPct() { return clubPlan === 'performance' ? 10 : 5; }
      function planLabel() { return clubPlan === 'performance' ? 'Club+ Performance' : 'Club+'; }
      function isLocked(item) {
        // Même exemple concret que Club+ (Couverture tournoi = traitement
        // prioritaire réservé à Performance) : identifié par libellé faute de
        // colonne dédiée côté catalogue_offres (staff SportVision), comme dans
        // app.html. À remplacer par un vrai tag si le pattern est étendu.
        return item.nom === 'Couverture tournoi' && clubPlan !== 'performance';
      }
      function offerPriceLabel(item) {
        if (item.tarif_type === 'sur_devis') return 'Sur devis';
        return money(item.prix_ht) + ' HT';
      }
      function offerAdvLabel(item) {
        if (item.tarif_type === 'sur_devis') return '';
        return '-' + reductionPct() + '% ' + planLabel();
      }
      function fullPriceLabel(item) {
        if (!item) return 'Sur devis';
        const adv = offerAdvLabel(item);
        return offerPriceLabel(item) + (adv ? ' (' + adv + ')' : '');
      }

      function offerCard(item) {
        const locked = isLocked(item);
        const adv = offerAdvLabel(item);
        return `<div class="csd-offer-card">
          <div class="t">${esc(item.nom)}${locked ? ' 🔒' : ''}</div>
          <div class="d">${esc(item.description || '')}</div>
          <div class="delai">Délai : ${esc(item.duree_estimee || '—')}</div>
          <div class="csd-offer-foot">
            <div><div class="csd-offer-price">${esc(offerPriceLabel(item))}</div>${adv ? '<div class="csd-offer-adv">' + esc(adv) + '</div>' : ''}</div>
            <button class="btn btn-primary" data-action="new" data-id="${item.id}">Réserver</button>
          </div>
        </div>`;
      }

      function bookingRow(bk) {
        const sm = BOOKING_STATUS_META[bk.status] || { label: bk.status || '—', color: 'var(--muted)' };
        return `<button class="cm-row" data-action="open" data-id="${bk.id}">
          <div><div class="t">${esc(bk.service_label || 'Prestation')}</div>
          <div class="m">${esc(bk.team || '—')} · ${fmtDate(bk.event_date)} · ${esc(bk.price_label || '—')}</div></div>
          <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
        </button>`;
      }

      function drawerHtml() {
        if (!openId) return '';
        const bk = bookings.find(function (x) { return x.id === openId; });
        if (!bk) return '';
        const idx = BOOKING_STEPS.indexOf(bk.status);
        const activeIdx = idx >= 0 ? idx : -1;
        return `<div class="cm-overlay" data-action="overlay">
          <div class="cm-modal">
            <div class="cm-drawer-head"><b>${esc(bk.service_label || 'Prestation')}</b><button class="cm-close" data-action="close">✕</button></div>
            <div class="m" style="margin-bottom:14px">${esc(bk.team || '—')} · ${fmtDate(bk.event_date)}</div>
            <div style="font-size:16px;font-weight:800;margin-bottom:18px">${esc(bk.price_label || 'Sur devis')}</div>
            <div class="m" style="font-weight:700;margin-bottom:8px">PIPELINE TERRAIN</div>
            ${BOOKING_STEP_LABELS.map(function (l, i) {
              const on = activeIdx >= 0 && i <= activeIdx;
              return '<div class="csd-pipeline-step"><span class="csd-pipeline-dot" style="background:' + (on ? 'var(--accent)' : 'var(--border)') + '"></span>' +
                '<span style="font-size:12px;color:' + (on ? 'var(--text)' : 'var(--muted)') + ';font-weight:' + (i === activeIdx ? 700 : 500) + '">' + esc(l) + '</span></div>';
            }).join('')}
            <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:18px" data-action="contact-support">Contacter le support</button>
          </div>
        </div>`;
      }

      function wizardHtml() {
        if (!wizard) return '';
        let body = '';
        if (wizard.step === 1) {
          body = catalog.length
            ? `<div class="cm-grid">${catalog.map(function (item) {
                const locked = isLocked(item);
                return '<button class="cm-card" data-action="wtype" data-id="' + item.id + '">' +
                  '<div style="font-weight:700;font-size:13px">' + esc(item.nom) + (locked ? ' 🔒' : '') + '</div>' +
                  '<div style="color:var(--accent-2);font-size:11px;font-weight:600;margin-top:6px">' + esc(offerPriceLabel(item)) + '</div>' +
                  '</button>';
              }).join('')}</div>`
            : '<div class="cm-empty">Catalogue en cours de préparation par SportVision.</div>';
        } else if (wizard.step === 2) {
          body = `<div class="cm-field"><label>Équipe</label><input type="text" data-field="w-team" value="${esc(wizard.team)}" placeholder="ex : Seniors R1"></div>
            <div class="cm-row2">
              <div class="cm-field"><label>Date</label><input type="date" data-field="w-date" value="${esc(wizard.date)}"></div>
              <div class="cm-field"><label>Heure</label><input type="text" data-field="w-heure" value="${esc(wizard.heure)}" placeholder="15:00"></div>
            </div>
            <div class="cm-field"><label>Adresse</label><input type="text" data-field="w-adresse" value="${esc(wizard.adresse)}" placeholder="Stade Municipal, Sens"></div>`;
        } else {
          const item = catalog.find(function (x) { return x.id === wizard.type; });
          body = `<div class="cm-info">
            <b style="display:block;margin-bottom:6px">${esc(item ? item.nom : 'Prestation')}</b>
            Équipe : ${esc(wizard.team || '—')}<br>Date : ${esc(wizard.date || '—')} à ${esc(wizard.heure || '—')}<br>Lieu : ${esc(wizard.adresse || '—')}
            <div style="font-weight:700;margin-top:8px">${esc(fullPriceLabel(item))}</div>
          </div>
          <div class="m">Tarif indicatif, sous réserve de disponibilité. Vous recevrez une confirmation ou un devis de SportVision.</div>`;
        }
        return `<div class="cm-overlay" data-action="overlay-wizard">
          <div class="cm-modal">
            <div class="cm-drawer-head"><b>Réserver une présence — étape ${wizard.step}/3</b><button class="cm-close" data-action="close-wizard">✕</button></div>
            ${body}
            <div style="display:flex;justify-content:space-between;margin-top:18px">
              <button class="btn btn-ghost" style="visibility:${wizard.step === 1 ? 'hidden' : 'visible'}" data-action="wback">← Retour</button>
              ${wizard.step === 2 ? '<button class="btn btn-primary" data-action="wnext">Continuer →</button>' : ''}
              ${wizard.step === 3 ? '<button class="btn btn-primary" data-action="wsubmit">Envoyer la demande</button>' : ''}
            </div>
          </div>
        </div>`;
      }

      function paint() {
        let content;
        if (!loaded) {
          content = '<div class="cm-empty">Chargement…</div>';
        } else if (view === 'catalogue') {
          content = catalog.length ? `<div class="csd-offer-grid">${catalog.map(offerCard).join('')}</div>` : '<div class="cm-empty">Catalogue en cours de préparation par SportVision.</div>';
        } else {
          content = bookings.length ? `<div class="cm-list">${bookings.map(bookingRow).join('')}</div>` : '<div class="cm-empty">Aucune réservation pour le moment.</div>';
        }
        container.innerHTML = `<div class="cm-wrap">
          <div class="cm-toolbar"><h2>Prestations SportVision</h2><button class="btn btn-primary" data-action="new">+ Réserver une présence</button></div>
          <div class="cm-pillbar">
            <button class="cm-pill${view === 'catalogue' ? ' on' : ''}" data-action="view" data-view="catalogue">Catalogue</button>
            <button class="cm-pill${view === 'reservations' ? ' on' : ''}" data-action="view" data-view="reservations">Mes réservations</button>
          </div>
          ${content}
          ${drawerHtml()}
          ${wizardHtml()}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value : '';
      }
      function syncWizard() {
        if (!wizard) return;
        if (container.querySelector('[data-field="w-team"]')) wizard.team = fieldVal('w-team');
        if (container.querySelector('[data-field="w-date"]')) wizard.date = fieldVal('w-date');
        if (container.querySelector('[data-field="w-heure"]')) wizard.heure = fieldVal('w-heure');
        if (container.querySelector('[data-field="w-adresse"]')) wizard.adresse = fieldVal('w-adresse');
      }

      async function submitBooking() {
        syncWizard();
        const item = catalog.find(function (x) { return x.id === wizard.type; });
        const res = await sbFetch('club_bookings', {
          method: 'POST', body: {
            club_id: orgId, service_id: item ? item.id : null, service_label: item ? item.nom : 'Prestation',
            team: wizard.team || null, event_date: wizard.date || null, heure: wizard.heure || null, adresse: wizard.adresse || null,
            status: 'recue', price_label: fullPriceLabel(item), created_by: localStorage.getItem('svc_uid') || null,
          },
        });
        if (!res.ok) { toast("Erreur lors de l'envoi de la demande."); return; }
        wizard = null;
        view = 'reservations';
        toast('Demande de présence envoyée — en attente de confirmation SportVision.');
        await load(); paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay"],[data-action="overlay-wizard"]');
          if (overlay && e.target === overlay) {
            if (overlay.getAttribute('data-action') === 'overlay') openId = null; else wizard = null;
            paint(); return;
          }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'view') { view = btn.getAttribute('data-view'); paint(); }
          else if (action === 'open') { openId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close') { openId = null; paint(); }
          else if (action === 'new') {
            const presetId = btn.getAttribute('data-id');
            const preset = presetId ? catalog.find(function (x) { return x.id === presetId; }) : null;
            if (preset && isLocked(preset)) {
              toast('Cette prestation prioritaire est incluse dans la formule Club+ Performance. Contactez votre interlocuteur SportVision pour l’ajouter à votre contrat.');
              return;
            }
            wizard = { step: preset ? 2 : 1, type: preset ? preset.id : null, team: '', date: '', heure: '', adresse: '' };
            paint();
          }
          else if (action === 'close-wizard') { wizard = null; paint(); }
          else if (action === 'wtype') {
            const item = catalog.find(function (x) { return x.id === btn.getAttribute('data-id'); });
            if (!item) return;
            if (isLocked(item)) {
              toast('Cette prestation prioritaire est incluse dans la formule Club+ Performance. Contactez votre interlocuteur SportVision pour l’ajouter à votre contrat.');
              return;
            }
            wizard.type = item.id; wizard.step = 2; paint();
          }
          else if (action === 'wback') { syncWizard(); wizard.step = Math.max(1, wizard.step - 1); paint(); }
          else if (action === 'wnext') { syncWizard(); wizard.step = 3; paint(); }
          else if (action === 'wsubmit') { await submitBooking(); }
          else if (action === 'contact-support') { toast('Le support SportVision sera joignable directement depuis Connect prochainement.'); }
        };
      }

      await load();
      paint();
    },
  };

  /* ============================================================
   * 2. DOCUMENTS (client_devis / client_factures / client_contrats,
   *    via clubs.portail_client_id — voir divergence 1 et 2 en tête de
   *    fichier)
   * ============================================================ */
  window.ClubModules.documents = {
    label: 'Documents',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      ensureCsdStyles();

      const DEVIS_STATUT = {
        brouillon: { label: 'Brouillon', color: 'var(--muted)' },
        'envoyé': { label: 'Envoyé', color: 'var(--accent)' },
        en_attente: { label: 'En attente', color: '#e2a03f' },
        'accepté': { label: 'Accepté', color: 'var(--ok)' },
        'refusé': { label: 'Refusé', color: 'var(--danger)' },
        'expiré': { label: 'Expiré', color: 'var(--muted)' },
        'annulé': { label: 'Annulé', color: 'var(--muted)' },
      };
      const FACTURE_STATUT = {
        brouillon: { label: 'Brouillon', color: 'var(--muted)' },
        emise: { label: 'Émise', color: 'var(--accent)' },
        payee: { label: 'Payée', color: 'var(--ok)' },
        en_retard: { label: 'En retard', color: 'var(--danger)' },
        annulee: { label: 'Annulée', color: 'var(--danger)' },
        remboursee: { label: 'Remboursée', color: 'var(--muted)' },
      };
      const CONTRAT_STATUT = {
        brouillon: { label: 'Brouillon', color: 'var(--muted)' },
        actif: { label: 'Actif', color: 'var(--ok)' },
        suspendu: { label: 'Suspendu', color: '#e2a03f' },
        'résilié': { label: 'Résilié', color: 'var(--danger)' },
        'expiré': { label: 'Expiré', color: 'var(--muted)' },
      };
      const SIGNATURE_STATUT = {
        non_demandee: { label: 'Aucune signature requise', color: 'var(--muted)' },
        demandee: { label: 'À signer', color: '#e2a03f' },
        signee: { label: 'Signé', color: 'var(--ok)' },
        refusee: { label: 'Refusé', color: 'var(--danger)' },
      };
      const TYPE_CONTRAT_LABEL = {
        ponctuel: 'Prestation ponctuelle', full_communication: 'Full Communication', club_plus: 'Abonnement Club+',
        coach_academie: 'Coach / Académie', evenement: 'Événement', joueur: 'Joueur', sponsoring: 'Sponsoring',
        pilote: 'Contrat pilote', autre: 'Autre', abonnement_mensuel: 'Abonnement mensuel',
        abonnement_annuel: 'Abonnement annuel', forfait_saison: 'Forfait saison', partenariat: 'Partenariat',
      };

      let loaded = false;
      let loadFailed = false;
      let portailClientId; // undefined = pas encore résolu, null = pas de lien, string = lien
      let devis = [], factures = [], contrats = [];
      let filter = 'tous';

      async function load() {
        const clubRes = await sbFetch('clubs?id=eq.' + orgId + '&select=portail_client_id');
        if (!clubRes.ok || !clubRes.data || !clubRes.data[0]) { loadFailed = true; loaded = true; return; }
        portailClientId = clubRes.data[0].portail_client_id || null;
        if (!portailClientId) { loaded = true; return; }

        const [dR, fR, cR] = await Promise.all([
          sbFetch('client_devis?client_id=eq.' + portailClientId + '&order=created_at.desc'),
          sbFetch('client_factures?client_id=eq.' + portailClientId + '&order=created_at.desc'),
          sbFetch('client_contrats?client_id=eq.' + portailClientId + '&order=created_at.desc'),
        ]);
        if (!dR.ok && !fR.ok && !cR.ok) { loadFailed = true; loaded = true; return; }
        if (!dR.ok || !fR.ok || !cR.ok) toast("Certaines informations n'ont pas pu être chargées — la liste ci-dessous peut être incomplète.");
        devis = dR.ok ? (dR.data || []) : [];
        factures = fR.ok ? (fR.data || []) : [];
        contrats = cR.ok ? (cR.data || []) : [];
        loaded = true;
      }

      function buildDocs() {
        const out = [];
        devis.forEach(function (d) {
          out.push({ kind: 'devis', title: 'Devis ' + (d.numero || ''), numero: d.numero, date: d.created_at, amount: d.total_ttc, badgeHtml: badge(DEVIS_STATUT, d.statut) });
        });
        factures.forEach(function (f) {
          out.push({ kind: 'facture', title: (f.type_facture || 'Facture') + ' ' + (f.numero || ''), numero: f.numero, date: f.date_emission || f.created_at, amount: f.montant_ttc, badgeHtml: badge(FACTURE_STATUT, f.statut), pdfUrl: f.pdf_url });
        });
        contrats.forEach(function (c) {
          const sig = c.signature_statut && c.signature_statut !== 'non_demandee' ? badge(SIGNATURE_STATUT, c.signature_statut) : '';
          out.push({ kind: 'contrat', title: TYPE_CONTRAT_LABEL[c.type_contrat] || c.type_contrat || 'Contrat', numero: null, date: c.date_debut || c.created_at, amount: c.montant_mensuel, freq: c.frequence, badgeHtml: badge(CONTRAT_STATUT, c.statut) + sig });
        });
        out.sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });
        return out;
      }

      function docRow(d) {
        const metaParts = [];
        if (d.numero) metaParts.push(esc(d.numero));
        metaParts.push(fmtDate(d.date));
        if (d.amount != null) metaParts.push(money(d.amount) + (d.freq ? ' / ' + esc(d.freq) : ''));
        const pdfBtn = (d.pdfUrl && isSafeHttpUrl(d.pdfUrl))
          ? '<a class="btn btn-ghost" style="padding:6px 12px" href="' + esc(d.pdfUrl) + '" target="_blank" rel="noopener noreferrer">Voir le PDF</a>'
          : '';
        return `<div class="cm-row" style="cursor:default;flex-wrap:wrap">
          <div><div class="t">${esc(d.title)}</div><div class="m">${metaParts.join(' · ')}</div></div>
          <div class="csd-doc-actions">${d.badgeHtml}${pdfBtn}</div>
        </div>`;
      }

      function paint() {
        let body;
        if (!loaded) {
          body = '<div class="cm-empty">Chargement…</div>';
        } else if (loadFailed) {
          body = '<div class="cm-empty">Impossible de charger vos documents pour le moment.<div style="margin-top:10px"><button class="btn btn-ghost" data-action="retry">Réessayer</button></div></div>';
        } else if (!portailClientId) {
          body = '<div class="cm-info">SportVision n\'a pas encore relié votre club à votre espace Documents — vos devis, factures et contrats apparaîtront ici une fois ce lien fait par votre interlocuteur SportVision.</div>';
        } else {
          const docs = buildDocs().filter(function (d) { return filter === 'tous' || d.kind === filter; });
          body = `<div class="cm-pillbar">${[['tous', 'Tous'], ['devis', 'Devis'], ['facture', 'Factures'], ['contrat', 'Contrats']].map(function (p) {
            return '<button class="cm-pill' + (filter === p[0] ? ' on' : '') + '" data-action="filter" data-key="' + p[0] + '">' + p[1] + '</button>';
          }).join('')}</div>
          ${docs.length ? '<div class="cm-list">' + docs.map(docRow).join('') + '</div>' : '<div class="cm-empty">Aucun document pour le moment.</div>'}
          <div class="m" style="margin-top:12px">Ces documents sont gérés par votre interlocuteur SportVision — contactez-le pour toute question ou action sur un devis, une facture ou un contrat.</div>`;
        }
        container.innerHTML = `<div class="cm-wrap"><div class="cm-toolbar"><h2>Documents</h2></div>${body}</div>`;
        bind();
      }

      function bind() {
        container.onclick = async function (e) {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'retry') { loadFailed = false; loaded = false; paint(); await load(); paint(); }
          else if (action === 'filter') { filter = btn.getAttribute('data-key'); paint(); }
        };
      }

      await load();
      paint();
    },
  };

  /* ============================================================
   * 3. RAPPORTS
   *
   * Ne garde que les métriques réellement calculables depuis des tables
   * existantes (voir divergence 4 en tête de fichier) :
   *  - Équipes actives / effectif total : club_teams (réel).
   *  - Créations réalisées / publiées, formats utilisés : club_creations
   *    (réel — remplace les chiffres codés en dur "24 créés/19 publiés/
   *    formats 45%/25%/…" de Club+, jamais alimentés depuis une vraie
   *    table même en session réelle).
   *  - Demandes reçues ce mois-ci : club_requests, filtré sur le mois en
   *    cours (Club+ affiche requestsSource().length sans filtrer par mois
   *    malgré le libellé "ce mois-ci" — corrigé ici pour que le chiffre
   *    corresponde à son étiquette).
   *  - Sponsors valorisés, contreparties réalisées/total, engagements en
   *    retard : club_sponsors.commitments (réel — Club+ affiche "9/13" et
   *    "2 en retard" en dur, "32 publications sponsorisées" n'a aucune
   *    table source et est donc abandonné plutôt qu'inventé).
   *  - Utilisateurs actifs, crédits consommés, prestations commandées :
   *    club_members / clubs.credits_* / club_bookings (réel).
   *  - Connexions ce mois-ci : Club+ affiche déjà "—" en session réelle
   *    (aucune table de suivi des connexions) — repris tel quel.
   *  - Régularité de transmission par équipe : club_teams n'a pas de
   *    colonne dédiée (Club+ la fixe à 0 en dur en session réelle) —
   *    annoncé explicitement comme "pas encore suivi" plutôt que
   *    d'afficher des barres à 0% qui laisseraient croire à une vraie
   *    mesure de 0%.
   * ============================================================ */
  window.ClubModules.rapports = {
    label: 'Rapports',
    espace: 'club',
    render: async function (container, orgId, ctx) {
      ensureStyles();
      ensureCsdStyles();

      let loaded = false;
      let clubPlan = 'club';
      let credits = { balance: 0, monthly: 0 };
      let teams = [], requests = [], sponsors = [], members = [], bookings = [], creations = [];
      let tab = 'equipes';

      async function load() {
        const [clubRes, teamsRes, reqRes, spRes, memRes, bkRes, crRes] = await Promise.all([
          sbFetch('clubs?id=eq.' + orgId + '&select=plan,credits_balance,credits_monthly'),
          sbFetch('club_teams?club_id=eq.' + orgId + '&select=id,name,categorie,coach,members&order=created_at.asc'),
          sbFetch('club_requests?club_id=eq.' + orgId + '&select=id,created_at'),
          sbFetch('club_sponsors?club_id=eq.' + orgId + '&select=id,commitments'),
          sbFetch('club_members?club_id=eq.' + orgId + '&select=id,status'),
          sbFetch('club_bookings?club_id=eq.' + orgId + '&select=id'),
          sbFetch('club_creations?club_id=eq.' + orgId + '&select=id,type,status'),
        ]);
        if (clubRes.ok && clubRes.data && clubRes.data[0]) {
          clubPlan = clubRes.data[0].plan === 'performance' ? 'performance' : 'club';
          credits = { balance: clubRes.data[0].credits_balance || 0, monthly: clubRes.data[0].credits_monthly || 0 };
        }
        teams = teamsRes.ok ? (teamsRes.data || []) : [];
        requests = reqRes.ok ? (reqRes.data || []) : [];
        sponsors = spRes.ok ? (spRes.data || []) : [];
        members = memRes.ok ? (memRes.data || []) : [];
        bookings = bkRes.ok ? (bkRes.data || []) : [];
        creations = crRes.ok ? (crRes.data || []) : [];
        loaded = true;
      }

      function isThisMonth(dateStr) {
        if (!dateStr) return false;
        const d = new Date(dateStr), now = new Date();
        return !isNaN(d.getTime()) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }

      function commitmentsSummary() {
        let done = 0, total = 0, late = 0;
        const now = new Date();
        sponsors.forEach(function (sp) {
          const commitments = Array.isArray(sp.commitments) ? sp.commitments : [];
          total += commitments.length;
          commitments.forEach(function (c) {
            if (c.status === 'realise') { done++; return; }
            if (c.due && c.due !== 'Permanent') {
              const d = new Date(c.due);
              if (!isNaN(d.getTime()) && d < now) late++;
            }
          });
        });
        return { done: done, total: total, late: late };
      }

      function formatsBreakdown() {
        const counts = {};
        creations.forEach(function (c) { const t = c.type || 'Autre'; counts[t] = (counts[t] || 0) + 1; });
        const total = creations.length;
        return Object.keys(counts).map(function (k) { return { label: k, count: counts[k], pct: total ? Math.round(counts[k] / total * 100) : 0 }; })
          .sort(function (a, b) { return b.count - a.count; }).slice(0, 6);
      }

      function statTile(value, label) {
        return `<div class="csd-stat"><b>${esc(String(value))}</b><span>${esc(label)}</span></div>`;
      }

      function equipesTabHtml() {
        const effectif = teams.reduce(function (s, t) { return s + (t.members || 0); }, 0);
        const rows = teams.map(function (t) {
          return `<div class="cm-row" style="cursor:default"><div><div class="t">${esc(t.name)}</div>
            <div class="m">${esc(t.categorie || 'Non précisé')} · ${esc(t.coach || 'À définir')} · ${t.members || 0} membre(s)</div></div></div>`;
        }).join('');
        return `<div class="csd-stats">${statTile(teams.length, 'Équipes actives')}${statTile(effectif, 'Effectif total')}</div>
          ${teams.length ? '<div class="cm-list">' + rows + '</div>' : '<div class="cm-empty">Aucune équipe pour le moment.</div>'}
          <div class="m" style="margin-top:12px">Le score de régularité de transmission par équipe n'est pas encore calculé automatiquement.</div>`;
      }

      function commTabHtml() {
        const publiees = creations.filter(function (c) { return c.status === 'publie'; }).length;
        const demandesMois = requests.filter(function (r) { return isThisMonth(r.created_at); }).length;
        const formats = formatsBreakdown();
        const barsHtml = formats.length
          ? '<div class="cm-info">' + formats.map(function (it) {
              return '<div class="csd-bar-row"><div class="top"><span>' + esc(it.label) + '</span><span class="m">' + it.pct + '%</span></div><div class="csd-bar"><i style="width:' + it.pct + '%"></i></div></div>';
            }).join('') + '</div>'
          : '<div class="cm-empty">Aucune création enregistrée pour le moment.</div>';
        return `<div class="csd-stats">${statTile(creations.length, 'Créations réalisées')}${statTile(publiees, 'Créations publiées')}${statTile(demandesMois, 'Demandes reçues ce mois-ci')}</div>
          <div class="m" style="font-weight:700;margin-bottom:8px">FORMATS UTILISÉS</div>
          ${barsHtml}`;
      }

      function sponsorsTabHtml() {
        const c = commitmentsSummary();
        return `<div class="csd-stats">${statTile(sponsors.length, 'Sponsors valorisés')}${statTile(c.done + '/' + c.total, 'Contreparties réalisées')}${statTile(c.late, 'Engagements en retard')}</div>`;
      }

      function utilisationTabHtml() {
        const actifs = members.filter(function (m) { return m.status === 'actif'; }).length;
        const consomme = Math.max(0, credits.monthly - credits.balance);
        return `<div class="csd-stats">${statTile(actifs, 'Utilisateurs actifs')}${statTile('—', 'Connexions ce mois-ci')}${statTile(consomme + '/' + credits.monthly, 'Crédits consommés')}${statTile(bookings.length, 'Prestations commandées')}</div>`;
      }

      function paint() {
        if (!loaded) {
          container.innerHTML = `<div class="cm-wrap"><div class="cm-toolbar"><h2>Rapports</h2></div><div class="cm-empty">Chargement…</div></div>`;
          return;
        }
        if (clubPlan !== 'performance') {
          container.innerHTML = `<div class="cm-wrap"><div class="cm-toolbar"><h2>Rapports</h2></div>
            <div class="cm-info cm-warn"><b style="display:block;margin-bottom:6px">Rapports avancés</b>
            Les rapports détaillés (équipes, communication, sponsors, utilisation) sont inclus dans la formule Club+ Performance. Contactez votre interlocuteur SportVision pour en savoir plus.</div>
          </div>`;
          return;
        }
        const tabs = [['equipes', 'Activité des équipes'], ['communication', 'Communication'], ['sponsors', 'Sponsors'], ['utilisation', 'Utilisation Club+']];
        const content = tab === 'equipes' ? equipesTabHtml() : tab === 'communication' ? commTabHtml() : tab === 'sponsors' ? sponsorsTabHtml() : utilisationTabHtml();
        container.innerHTML = `<div class="cm-wrap">
          <div class="cm-toolbar"><h2>Rapports</h2><div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" data-action="export-pdf">Exporter en PDF</button>
            <button class="btn btn-ghost" data-action="send-email">Envoyer par e-mail</button>
          </div></div>
          <div class="cm-pillbar">${tabs.map(function (t) { return '<button class="cm-pill' + (tab === t[0] ? ' on' : '') + '" data-action="tab" data-key="' + t[0] + '">' + esc(t[1]) + '</button>'; }).join('')}</div>
          ${content}
        </div>`;
        bind();
      }

      function bind() {
        container.onclick = function (e) {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'tab') { tab = btn.getAttribute('data-key'); paint(); }
          else if (action === 'export-pdf') { toast('Le rapport PDF sera disponible prochainement.'); }
          else if (action === 'send-email') { toast('Envoi par e-mail bientôt disponible.'); }
        };
      }

      await load();
      paint();
    },
  };
})();
