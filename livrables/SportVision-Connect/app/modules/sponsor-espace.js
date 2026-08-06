/* ============================================================
 * SportVision Connect — Module Sponsor
 * Accueil · Ma fiche sponsoring · Créations · Demandes
 *
 * Espace neuf (cf. migration-connect-v4-sponsor.sql). Avant cette
 * migration, `club_sponsors` n'était qu'une fiche tenue PAR le club sur
 * son sponsor — aucun sponsor ne s'était jamais connecté à quoi que ce
 * soit. La migration v4 ajoute uniquement `sponsor_organization_id` sur
 * club_sponsors et club_creations (+ policy SELECT associée), sans
 * toucher au reste du schéma.
 *
 * Rappel d'architecture Connect : pour un espace de type sponsor,
 * orgId === organizations.id de l'organisation sponsor elle-même. Il
 * remplace `sponsor_organization_id` (PAS club_id) dans toutes les
 * requêtes ci-dessous — un sponsor peut sponsoriser plusieurs clubs,
 * donc club_sponsors et club_creations sont traités comme des LISTES.
 * ctx.role n'a pas de catalogue de permissions défini pour cet espace :
 * traité ici comme un simple libellé d'affichage, aucune déduction de
 * droits côté client.
 *
 * Ce module est strictement lecture seule sur club_sponsors et
 * club_creations (aucune action d'écriture, par design : c'est le
 * club/SportVision qui gèrent la fiche sponsoring, pas le sponsor
 * lui-même). Seule écriture possible : les demandes (table générique
 * `requests`, exclusivement via submit_request()/update_request_status()
 * — jamais d'INSERT direct, refusé par la policy) et l'ajout de
 * commentaires sur une demande existante (PATCH direct sur
 * requests.comments, même pattern que le module Coach).
 *
 * S'appuie sur les globales déjà fournies par le shell Connect
 * (index.html, chargé avant ce fichier) : sbFetch, sbRpc, sbFunction,
 * esc, toast, ainsi que les variables CSS --card/--border/--radius/
 * --shadow/--accent/--accent-2/--muted/--text/--ok/--danger et les
 * classes .btn/.btn-primary/.btn-ghost/.badge.
 *
 * Architecture (même pattern que les modules Coach/Club déjà livrés) :
 * chaque entrée de window.SponsorModules est autonome — son
 * render(container, orgId, ctx) recrée un état dans une closure dédiée
 * à chaque appel, et rejoue container.innerHTML + les gestionnaires
 * d'événements (assignés via container.onclick =, jamais
 * addEventListener, pour ne jamais accumuler de doublons quand
 * render() est rappelé sur le même noeud).
 * ============================================================ */
(function () {
  'use strict';

  /* ── Styles partagés, injectés une seule fois ── */
  function ensureStyles() {
    if (document.getElementById('sp-shared-style')) return;
    const style = document.createElement('style');
    style.id = 'sp-shared-style';
    style.textContent = `
      .sp-wrap .btn{width:auto;margin-top:0}
      .sp-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .sp-toolbar h2{margin:0;font-size:19px}
      .sp-pillbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
      .sp-pill{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:999px;padding:6px 14px;font-size:12.5px;cursor:pointer;font-weight:600}
      .sp-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}
      .sp-empty{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--muted)}
      .sp-list{display:flex;flex-direction:column;gap:8px}
      .sp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
      .sp-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px;text-align:left;cursor:pointer;font:inherit;color:inherit}
      .sp-card:hover{border-color:var(--accent)}
      .sp-row{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit}
      .sp-row:hover{border-color:var(--accent)}
      .sp-row .t{font-weight:700;font-size:14px}
      .sp-row .m{color:var(--muted);font-size:12px;margin-top:2px}
      .m{color:var(--muted);font-size:12px}
      .sp-field{margin-bottom:12px}
      .sp-field label{display:block;font-size:12.5px;font-weight:600;margin-bottom:5px}
      .sp-field input,.sp-field select,.sp-field textarea{width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box}
      .sp-overlay{position:fixed;inset:0;background:rgba(10,14,30,.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000;overflow:auto}
      .sp-modal{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px;max-width:460px;width:100%;max-height:88vh;overflow:auto}
      .sp-modal.wide{max-width:600px}
      .sp-drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
      .sp-close{background:transparent;border:none;font-size:18px;cursor:pointer;color:var(--muted);line-height:1;padding:2px}
      .sp-comment{background:rgba(0,0,0,.03);border-radius:10px;padding:8px 10px;margin-bottom:6px;font-size:12.5px}
      .sp-info{border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12.5px;margin-bottom:12px}
      .sp-warn{border-color:#e2a03f55;background:rgba(226,160,63,.08)}
      .sp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:18px}
      .sp-stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
      .sp-stat .n{font-size:26px;font-weight:800;color:var(--accent)}
      .sp-stat .l{font-size:12.5px;color:var(--muted);margin-top:2px}
      .sp-section{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:14px}
      .sp-section h3{margin:0 0 10px;font-size:14.5px}
      .sp-commit-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)}
      .sp-commit-row:last-child{border-bottom:none}
    `;
    document.head.appendChild(style);
  }

  /* ── Formattage / libellés partagés ── */
  function fmtDate(v) {
    if (!v) return '—';
    if (v === 'Permanent') return 'Permanent';
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }

  const NIVEAU_COLOR = { Or: '#e2a03f', Argent: '#a7b6c9', Bronze: '#7455ff' };
  function niveauColor(n) { return NIVEAU_COLOR[n] || '#7455ff'; }

  const COMMIT_STATUS = { a_faire: { label: 'À faire', color: '#e2a03f' }, realise: { label: 'Réalisé', color: '#1fa971' } };
  function commitStatusMeta(s) { return COMMIT_STATUS[s] || { label: s || '—', color: '#5b6478' }; }

  const CREATION_STATUS = {
    brouillon: { label: 'Brouillon', color: '#5b6478' },
    a_valider: { label: 'À valider', color: '#e2a03f' },
    valide: { label: 'Validé', color: '#1fa971' },
    publie: { label: 'Publié', color: '#2f6bff' }
  };
  function creationStatusMeta(s) { return CREATION_STATUS[s] || { label: s || '—', color: '#5b6478' }; }

  const REQUEST_STATUSES = ['recues', 'info_manquante', 'en_traitement', 'prete_a_creer', 'terminee', 'refusee'];
  function requestStatusMeta(status) {
    return {
      recues: { label: 'Reçue', color: '#2f6bff' },
      info_manquante: { label: 'Informations manquantes', color: '#e2a03f' },
      en_traitement: { label: 'En traitement', color: '#7455ff' },
      prete_a_creer: { label: 'Prête à créer', color: '#06c2c2' },
      terminee: { label: 'Terminée', color: '#1fa971' },
      refusee: { label: 'Refusée', color: '#e14b4b' }
    }[status] || { label: status || '—', color: '#5b6478' };
  }

  // Hypothèse : aucun catalogue de types de demande n'existe côté base pour
  // l'espace Sponsor (comme pour Coach, `requests.type` n'est pas contraint
  // par un check constraint). Catalogue posé ici à titre indicatif, orienté
  // sur ce qu'un sponsor peut raisonnablement demander à SportVision ; le
  // serveur accepte n'importe quelle chaîne, rien ne casse si ça évolue.
  const REQUEST_TYPES = ['rapport_visibilite', 'demande_activation', 'mise_a_jour_fiche', 'autre'];
  function requestTypeLabel(type) {
    return {
      rapport_visibilite: 'Rapport de visibilité',
      demande_activation: "Demande d'activation",
      mise_a_jour_fiche: 'Mise à jour de la fiche sponsoring',
      autre: 'Autre demande'
    }[type] || (type || '—');
  }

  window.SponsorModules = window.SponsorModules || {};

  /* ============================================================
   * 1. ACCUEIL — résumé (fiches actives, contreparties à faire, demandes en cours)
   * ============================================================ */
  window.SponsorModules.accueil = {
    label: 'Accueil',
    espace: 'sponsor',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let loaded = false;
      let sponsorships = [];
      let recentRequests = [];
      let openRequestsCount = 0;
      let pendingCommitments = 0;

      async function load() {
        const [spRes, reqRes] = await Promise.all([
          sbFetch('club_sponsors?sponsor_organization_id=eq.' + orgId + '&select=*'),
          sbFetch('requests?organization_id=eq.' + orgId + '&select=*&order=created_at.desc&limit=5')
        ]);
        if (!spRes.ok) toast('Erreur de chargement.');
        sponsorships = spRes.ok ? (spRes.data || []) : [];
        pendingCommitments = sponsorships.reduce(function (acc, sp) {
          const commitments = Array.isArray(sp.commitments) ? sp.commitments : [];
          return acc + commitments.filter(function (c) { return c.status !== 'realise'; }).length;
        }, 0);
        if (!reqRes.ok) toast('Erreur de chargement.');
        recentRequests = reqRes.ok ? (reqRes.data || []) : [];
        openRequestsCount = recentRequests.filter(function (r) { return r.status !== 'terminee' && r.status !== 'refusee'; }).length;
        loaded = true;
      }

      function paint() {
        if (!loaded) {
          container.innerHTML = '<div class="sp-wrap"><div class="sp-empty">Chargement…</div></div>';
          return;
        }
        container.innerHTML = `<div class="sp-wrap">
          <div class="sp-toolbar"><h2>Accueil</h2><button class="btn btn-ghost" data-action="refresh">Actualiser</button></div>
          <div class="sp-stats">
            <div class="sp-stat"><div class="n">${sponsorships.length}</div><div class="l">Fiche${sponsorships.length > 1 ? 's' : ''} de sponsoring active${sponsorships.length > 1 ? 's' : ''}</div></div>
            <div class="sp-stat"><div class="n">${pendingCommitments}</div><div class="l">Contrepartie${pendingCommitments > 1 ? 's' : ''} à faire</div></div>
            <div class="sp-stat"><div class="n">${openRequestsCount}</div><div class="l">Demande${openRequestsCount > 1 ? 's' : ''} en cours</div></div>
          </div>
          <div class="sp-section">
            <h3>Mes partenariats</h3>
            ${sponsorships.length ? '<div class="sp-list">' + sponsorships.map(function (sp) {
              const color = niveauColor(sp.niveau);
              return `<div class="sp-row" style="cursor:default">
                <div><div class="t">${esc(sp.name)}</div><div class="m">${esc(sp.secteur || '—')}</div></div>
                <span class="badge" style="background:${color}22;color:${color}">${esc(sp.niveau || 'Bronze')}</span>
              </div>`;
            }).join('') + '</div>' : '<div class="m">Aucune fiche de sponsoring liée à votre organisation pour le moment.</div>'}
          </div>
          <div class="sp-section">
            <h3>Demandes récentes</h3>
            ${recentRequests.length ? '<div class="sp-list">' + recentRequests.map(function (r) {
              const sm = requestStatusMeta(r.status);
              return `<div class="sp-row" style="cursor:default">
                <div><div class="t">${esc(requestTypeLabel(r.type))}</div><div class="m">${fmtDate(r.created_at)}</div></div>
                <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
              </div>`;
            }).join('') + '</div>' : '<div class="m">Aucune demande envoyée pour le moment.</div>'}
          </div>
        </div>`;
        bind();
      }

      function bind() {
        container.onclick = async function (e) {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          if (btn.getAttribute('data-action') === 'refresh') {
            loaded = false; paint();
            await load(); paint();
          }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 2. MA FICHE SPONSORING (club_sponsors) — lecture seule, liste
   * ============================================================ */
  window.SponsorModules.fiches = {
    label: 'Ma fiche sponsoring',
    espace: 'sponsor',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let sponsorships = [];
      let loaded = false;
      let openId = null;

      async function load() {
        const res = await sbFetch('club_sponsors?sponsor_organization_id=eq.' + orgId + '&select=*&order=name.asc');
        if (!res.ok) toast('Erreur de chargement.');
        sponsorships = res.ok ? (res.data || []) : [];
        loaded = true;
      }

      function card(sp) {
        const color = niveauColor(sp.niveau);
        const commitments = Array.isArray(sp.commitments) ? sp.commitments : [];
        const done = commitments.filter(function (c) { return c.status === 'realise'; }).length;
        return `<button class="sp-card" data-action="open" data-id="${sp.id}">
          <div style="font-weight:700;font-size:14px">${esc(sp.name)}</div>
          <div class="m" style="margin-top:2px">${esc(sp.secteur || '—')}</div>
          <span class="badge" style="background:${color}22;color:${color};margin-top:8px;display:inline-block">Partenaire ${esc(sp.niveau || 'Bronze')}</span>
          <div class="m" style="margin-top:6px">${done}/${commitments.length} contrepartie${commitments.length > 1 ? 's' : ''} réalisée${commitments.length > 1 ? 's' : ''}</div>
        </button>`;
      }

      function drawerHtml() {
        if (!openId) return '';
        const sp = sponsorships.find(function (x) { return x.id === openId; });
        if (!sp) return '';
        const color = niveauColor(sp.niveau);
        const commitments = Array.isArray(sp.commitments) ? sp.commitments : [];
        return `<div class="sp-overlay" data-action="overlay">
          <div class="sp-modal">
            <div class="sp-drawer-head"><b>${esc(sp.name)}</b><button class="sp-close" data-action="close">✕</button></div>
            <span class="badge" style="background:${color}22;color:${color};margin-bottom:14px;display:inline-block">Partenaire ${esc(sp.niveau || 'Bronze')}</span>
            <div class="sp-info">
              Secteur : ${esc(sp.secteur || '—')}<br>
              Contrat : ${fmtDate(sp.date_debut)} — ${fmtDate(sp.date_fin)}<br>
              Montant annuel : ${money(sp.montant)}
            </div>
            <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:6px">CONTREPARTIES</div>
            ${commitments.length ? commitments.map(function (c) {
              const sm = commitStatusMeta(c.status);
              return `<div class="sp-commit-row">
                <div><div style="font-weight:600">${esc(c.type || '—')}</div><div class="m">${fmtDate(c.due)}</div></div>
                <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
              </div>`;
            }).join('') : '<div class="m">Aucune contrepartie renseignée pour ce partenariat.</div>'}
            <div class="sp-info" style="margin-top:14px">Cette fiche est gérée par le club et par SportVision. Pour une correction ou une mise à jour, passez par une demande.</div>
          </div>
        </div>`;
      }

      function paint() {
        const content = !loaded ? '<div class="sp-empty">Chargement…</div>'
          : (sponsorships.length ? ('<div class="sp-grid">' + sponsorships.map(card).join('') + '</div>') : '<div class="sp-empty">Aucune fiche de sponsoring liée à votre organisation pour le moment.</div>');
        container.innerHTML = `<div class="sp-wrap">
          <div class="sp-toolbar"><h2>Ma fiche sponsoring</h2></div>
          ${content}
          ${drawerHtml()}
        </div>`;
        bind();
      }

      function bind() {
        container.onclick = function (e) {
          const overlay = e.target.closest('[data-action="overlay"]');
          if (overlay && e.target === overlay) { openId = null; paint(); return; }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'open') { openId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close') { openId = null; paint(); }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 3. CRÉATIONS (club_creations) — lecture seule, vitrine
   * ============================================================ */
  window.SponsorModules.creations = {
    label: 'Créations',
    espace: 'sponsor',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let creations = [];
      let loaded = false;
      let filter = 'toutes';

      async function load() {
        const res = await sbFetch('club_creations?sponsor_organization_id=eq.' + orgId + '&select=*&order=created_at.desc');
        if (!res.ok) toast('Erreur de chargement.');
        creations = res.ok ? (res.data || []) : [];
        loaded = true;
      }

      function row(c) {
        const sm = creationStatusMeta(c.status);
        return `<div class="sp-row" style="cursor:default">
          <div><div class="t">${esc(c.title)}</div><div class="m">${esc(c.type || '—')}${c.team ? ' · ' + esc(c.team) : ''}</div></div>
          <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
        </div>`;
      }

      function paint() {
        let listHtml;
        if (!loaded) {
          listHtml = '<div class="sp-empty">Chargement…</div>';
        } else {
          const filtered = creations.filter(function (c) { return filter === 'toutes' || c.status === filter; });
          listHtml = filtered.length ? ('<div class="sp-list">' + filtered.map(row).join('') + '</div>') : '<div class="sp-empty">Aucune création vous mentionnant pour ce filtre.</div>';
        }
        container.innerHTML = `<div class="sp-wrap">
          <div class="sp-toolbar"><h2>Créations</h2></div>
          <div class="sp-pillbar">${['toutes', 'brouillon', 'a_valider', 'valide', 'publie'].map(function (st) {
            return '<button class="sp-pill' + (filter === st ? ' on' : '') + '" data-action="filter" data-status="' + st + '">' + (st === 'toutes' ? 'Toutes' : esc(creationStatusMeta(st).label)) + '</button>';
          }).join('')}</div>
          ${listHtml}
        </div>`;
        bind();
      }

      function bind() {
        container.onclick = function (e) {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          if (btn.getAttribute('data-action') === 'filter') { filter = btn.getAttribute('data-status'); paint(); }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 4. DEMANDES (requests + submit_request/update_request_status)
   * ============================================================ */
  window.SponsorModules.demandes = {
    label: 'Demandes',
    espace: 'sponsor',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let items = [];
      let loaded = false;
      let filter = 'toutes';
      let openId = null;
      let form = null; // {type, urgency, detail}
      let myName = null;

      // Hypothèse : `profiles` (prenom/nom) existe pour tout utilisateur authentifié
      // sur l'écosystème SportVision, comme pour l'espace Coach. Repli silencieux
      // sur 'Vous' si la lecture échoue — n'affecte que la signature du commentaire.
      async function myDisplayName() {
        if (myName) return myName;
        const uid = localStorage.getItem('svc_uid');
        if (!uid) return 'Vous';
        const res = await sbFetch('profiles?id=eq.' + uid + '&select=prenom,nom&limit=1');
        if (res.ok && res.data && res.data[0]) {
          const n = (((res.data[0].prenom || '') + ' ' + (res.data[0].nom || '')).trim());
          myName = n || 'Vous';
        } else myName = 'Vous';
        return myName;
      }

      async function load() {
        const res = await sbFetch('requests?organization_id=eq.' + orgId + '&select=*&order=created_at.desc');
        if (!res.ok) toast('Erreur de chargement.');
        items = res.ok ? (res.data || []) : [];
        loaded = true;
      }

      function row(r) {
        const sm = requestStatusMeta(r.status);
        return `<button class="sp-row" data-action="open" data-id="${r.id}">
          <div style="display:flex;gap:10px;align-items:center">
            <span style="width:7px;height:7px;border-radius:4px;flex-shrink:0;background:${r.urgency === 'haute' ? 'var(--danger)' : 'var(--border)'}"></span>
            <div>
              <div class="t">${esc(requestTypeLabel(r.type))}</div>
              <div class="m">${fmtDate(r.created_at)}</div>
            </div>
          </div>
          <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
        </button>`;
      }

      function drawerHtml() {
        if (!openId) return '';
        const r = items.find(function (x) { return x.id === openId; });
        if (!r) return '';
        const sm = requestStatusMeta(r.status);
        const missing = Array.isArray(r.missing) ? r.missing : [];
        const comments = Array.isArray(r.comments) ? r.comments : [];
        return `<div class="sp-overlay" data-action="overlay">
          <div class="sp-modal wide">
            <div class="sp-drawer-head">
              <div>
                <b style="font-size:16px">${esc(requestTypeLabel(r.type))}</b>
                <div class="m" style="margin-top:2px">${fmtDate(r.created_at)}</div>
              </div>
              <button class="sp-close" data-action="close">✕</button>
            </div>
            <span class="badge" style="background:${sm.color}22;color:${sm.color};margin-bottom:14px;display:inline-block">${esc(sm.label)}</span>
            ${missing.length ? `<div class="sp-info sp-warn"><b style="display:block;margin-bottom:4px;font-size:11.5px;color:#b56a00">INFORMATIONS MANQUANTES</b>${missing.map(function (m) { return '<div>• ' + esc(m) + '</div>'; }).join('')}</div>` : ''}
            <div class="sp-info"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">DÉTAIL</div>${esc(r.detail || '—')}</div>
            <div style="font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:8px">COMMENTAIRES</div>
            ${comments.length ? comments.map(function (c) {
              return '<div class="sp-comment"><b>' + esc(c.author || '—') + '</b> <span style="color:var(--muted)">· ' + esc(c.date || '') + '</span><div style="margin-top:3px">' + esc(c.text || '') + '</div></div>';
            }).join('') : '<div class="m" style="margin-bottom:10px">Aucun commentaire.</div>'}
            <div style="display:flex;gap:8px;margin-top:10px">
              <input type="text" data-field="req-comment" placeholder="Ajouter un commentaire…" style="flex:1;padding:9px 10px;border:1px solid var(--border);border-radius:8px">
              <button class="btn btn-primary" data-action="comment" data-id="${r.id}">Envoyer</button>
            </div>
            ${r.status === 'recues' ? `<button class="btn btn-ghost" style="margin-top:14px;color:var(--danger)" data-action="cancel" data-id="${r.id}">Annuler la demande</button>` : ''}
          </div>
        </div>`;
      }

      function formHtml() {
        if (!form) return '';
        return `<div class="sp-overlay" data-action="overlay-form">
          <div class="sp-modal">
            <div class="sp-drawer-head"><b>Nouvelle demande</b><button class="sp-close" data-action="close-form">✕</button></div>
            <div class="sp-field"><label>Type de demande</label><select data-field="rf-type">
              ${REQUEST_TYPES.map(function (t) { return '<option value="' + t + '" ' + (t === form.type ? 'selected' : '') + '>' + esc(requestTypeLabel(t)) + '</option>'; }).join('')}
            </select></div>
            <div class="sp-field"><label>Urgence</label><select data-field="rf-urgency">
              <option value="normale" ${form.urgency === 'normale' ? 'selected' : ''}>Normale</option>
              <option value="haute" ${form.urgency === 'haute' ? 'selected' : ''}>Haute</option>
            </select></div>
            <div class="sp-field"><label>Détail</label><textarea rows="4" data-field="rf-detail" placeholder="Décrivez votre demande…">${esc(form.detail)}</textarea></div>
            <div class="m" style="margin-bottom:10px">La demande sera envoyée à SportVision pour traitement.</div>
            <button class="btn btn-primary" data-action="submit-form">Envoyer la demande</button>
          </div>
        </div>`;
      }

      function paint() {
        let listHtml;
        if (!loaded) {
          listHtml = '<div class="sp-empty">Chargement…</div>';
        } else {
          const filtered = items.filter(function (r) { return filter === 'toutes' || r.status === filter; });
          listHtml = filtered.length ? ('<div class="sp-list">' + filtered.map(row).join('') + '</div>') : '<div class="sp-empty">Aucune demande dans ce statut pour le moment.</div>';
        }
        container.innerHTML = `<div class="sp-wrap">
          <div class="sp-toolbar"><h2>Demandes</h2><button class="btn btn-primary" data-action="new">+ Nouvelle demande</button></div>
          <div class="sp-pillbar">${['toutes'].concat(REQUEST_STATUSES).map(function (st) {
            return '<button class="sp-pill' + (filter === st ? ' on' : '') + '" data-action="filter" data-status="' + st + '">' + (st === 'toutes' ? 'Toutes' : esc(requestStatusMeta(st).label)) + '</button>';
          }).join('')}</div>
          ${listHtml}
          ${drawerHtml()}
          ${formHtml()}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value : '';
      }
      function syncForm() {
        if (!form) return;
        if (container.querySelector('[data-field="rf-type"]')) form.type = fieldVal('rf-type');
        if (container.querySelector('[data-field="rf-urgency"]')) form.urgency = fieldVal('rf-urgency');
        if (container.querySelector('[data-field="rf-detail"]')) form.detail = fieldVal('rf-detail');
      }

      async function submitForm() {
        syncForm();
        const res = await sbRpc('submit_request', {
          p_organization_id: orgId,
          p_type: form.type,
          p_urgency: form.urgency,
          p_detail: form.detail || '—',
          p_credits: 0
        });
        if (!res.ok) { toast("Erreur lors de l'envoi de la demande."); return; }
        form = null;
        toast('Demande envoyée à SportVision.');
        await load(); paint();
      }

      async function cancelRequest(id) {
        const res = await sbRpc('update_request_status', { p_request_id: id, p_status: 'refusee' });
        if (!res.ok) { toast("Action impossible : cette demande n'est plus annulable."); return; }
        openId = null;
        toast('Demande annulée.');
        await load(); paint();
      }

      async function addComment(id) {
        const input = container.querySelector('[data-field="req-comment"]');
        const text = input ? input.value.trim() : '';
        if (!text) return;
        const rowItem = items.find(function (x) { return x.id === id; });
        if (!rowItem) return;
        const author = await myDisplayName();
        const comments = (Array.isArray(rowItem.comments) ? rowItem.comments : []).concat([{ author: author, text: text, date: new Date().toLocaleDateString('fr-FR') }]);
        const res = await sbFetch('requests?id=eq.' + id, { method: 'PATCH', body: { comments: comments } });
        if (!res.ok) { toast('Action impossible.'); return; }
        rowItem.comments = comments;
        paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay"],[data-action="overlay-form"]');
          if (overlay && e.target === overlay) {
            if (overlay.getAttribute('data-action') === 'overlay') openId = null; else form = null;
            paint(); return;
          }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'filter') { filter = btn.getAttribute('data-status'); paint(); }
          else if (action === 'open') { openId = btn.getAttribute('data-id'); paint(); }
          else if (action === 'close') { openId = null; paint(); }
          else if (action === 'new') { form = { type: REQUEST_TYPES[0], urgency: 'normale', detail: '' }; paint(); }
          else if (action === 'close-form') { form = null; paint(); }
          else if (action === 'submit-form') { await submitForm(); }
          else if (action === 'cancel') { await cancelRequest(btn.getAttribute('data-id')); }
          else if (action === 'comment') { await addComment(btn.getAttribute('data-id')); }
        };
      }

      await load();
      paint();
    }
  };

  /* ============================================================
   * 5. ADMINISTRATION (memberships + organization_role_catalog + org-invite)
   * — liste des membres, invitation et gestion des autres membres,
   * réservées au rôle 'referent' (cf. migration-connect-v6-org-admin.sql,
   * qui définit ce catalogue pour "sponsor" : referent = is_admin,
   * contact = is_default). Aucun rôle codé en dur ici : le catalogue est
   * lu dynamiquement, comme pour Coach/Académie, pour ne jamais se
   * désynchroniser du serveur (trigger SQL + edge function org-invite).
   * ============================================================ */

  // `memberships.status` : 'actif' (invitation acceptée), 'invitation' (en
  // attente), 'suspendu' (accès coupé par un referent ou le staff SportVision).
  function memberStatusMeta(status) {
    return {
      actif: { label: 'Actif', color: '#1fa971' },
      invitation: { label: 'Invitation en attente', color: '#e2a03f' },
      suspendu: { label: 'Suspendu', color: '#e14b4b' }
    }[status] || { label: status || '—', color: '#5b6478' };
  }

  function roleLabelFromCatalog(roleCatalog, roleKey) {
    const rc = (roleCatalog || []).find(function (r) { return r.role_key === roleKey; });
    return rc ? rc.label : (roleKey || '—');
  }

  window.SponsorModules.administration = {
    label: 'Administration',
    espace: 'sponsor',
    render: async function (container, orgId, ctx) {
      ensureStyles();

      let members = [];
      let roleCatalog = [];
      let loaded = false;
      let form = null; // {email, prenom, nom, role}
      let sending = false;
      const myUid = localStorage.getItem('svc_uid');
      const canManage = !!(ctx && ctx.role === 'referent');

      async function load() {
        const [mRes, rcRes] = await Promise.all([
          sbFetch('memberships?organization_id=eq.' + orgId + '&select=*&order=created_at.asc'),
          sbFetch('organization_role_catalog?organization_type=eq.sponsor&select=role_key,label,is_admin,is_default')
        ]);
        if (!mRes.ok) toast('Erreur de chargement.');
        members = mRes.ok ? (mRes.data || []) : [];
        if (!rcRes.ok) toast('Erreur de chargement.');
        roleCatalog = rcRes.ok ? (rcRes.data || []) : [];
        loaded = true;
      }

      // Pas de jointure possible vers profiles/auth.users depuis ce client pour
      // afficher un nom (accès en lecture non garanti sur un autre utilisateur) —
      // on affiche donc chaque membre par rôle/statut/date, sans nom, comme le
      // fait déjà l'espace Coach.
      function row(m) {
        const isMe = myUid && m.user_id === myUid;
        const sm = memberStatusMeta(m.status);
        const roleLabel = roleLabelFromCatalog(roleCatalog, m.role);
        const canToggle = canManage && !isMe && m.status !== 'invitation';
        return `<div class="sp-row" style="cursor:default;flex-direction:column;align-items:stretch;gap:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div>
              <div class="t">${esc(roleLabel)}${isMe ? ' <span class="m">(vous)</span>' : ''}</div>
              <div class="m">Membre depuis le ${fmtDate(m.created_at)}${m.source ? ' · ' + esc(m.source) : ''}</div>
            </div>
            <span class="badge" style="background:${sm.color}22;color:${sm.color}">${esc(sm.label)}</span>
          </div>
          ${canManage && !isMe ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select data-field="role-${m.id}" style="flex:1;min-width:160px;padding:7px 9px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit">
              ${roleCatalog.map(function (r) { return '<option value="' + r.role_key + '" ' + (r.role_key === m.role ? 'selected' : '') + '>' + esc(r.label) + '</option>'; }).join('')}
            </select>
            <button class="btn btn-ghost" data-action="save-role" data-id="${m.id}">Enregistrer le rôle</button>
            ${canToggle ? `<button class="btn btn-ghost" style="color:${m.status === 'suspendu' ? 'var(--ok)' : 'var(--danger)'}" data-action="toggle-status" data-id="${m.id}" data-status="${m.status}">${m.status === 'suspendu' ? 'Réactiver' : 'Suspendre'}</button>` : ''}
          </div>` : ''}
        </div>`;
      }

      function formHtml() {
        if (!form) return '';
        return `<div class="sp-overlay" data-action="overlay-form">
          <div class="sp-modal">
            <div class="sp-drawer-head"><b>Inviter un membre</b><button class="sp-close" data-action="close-form">✕</button></div>
            <div class="sp-field"><label>Prénom</label><input type="text" data-field="mf-prenom" value="${esc(form.prenom)}"></div>
            <div class="sp-field"><label>Nom</label><input type="text" data-field="mf-nom" value="${esc(form.nom)}"></div>
            <div class="sp-field"><label>E-mail</label><input type="email" data-field="mf-email" value="${esc(form.email)}" placeholder="prenom.nom@exemple.fr"></div>
            <div class="sp-field"><label>Rôle</label><select data-field="mf-role">
              ${roleCatalog.map(function (r) { return '<option value="' + r.role_key + '" ' + (r.role_key === form.role ? 'selected' : '') + '>' + esc(r.label) + '</option>'; }).join('')}
            </select></div>
            <div class="m" style="margin-bottom:10px">Un e-mail d'invitation sera envoyé pour créer le compte (ou rattacher un compte existant) à cette organisation.</div>
            <button class="btn btn-primary" data-action="submit-form"${sending ? ' disabled' : ''}>${sending ? 'Envoi…' : "Envoyer l'invitation"}</button>
          </div>
        </div>`;
      }

      function paint() {
        const content = !loaded ? '<div class="sp-empty">Chargement…</div>'
          : (members.length ? ('<div class="sp-list">' + members.map(row).join('') + '</div>') : '<div class="sp-empty">Aucun membre pour le moment.</div>');
        container.innerHTML = `<div class="sp-wrap">
          <div class="sp-toolbar"><h2>Administration</h2>${canManage ? '<button class="btn btn-primary" data-action="new">+ Inviter un membre</button>' : ''}</div>
          <div class="sp-section">
            <h3>Membres de l'organisation</h3>
            ${content}
          </div>
          ${canManage ? formHtml() : ''}
        </div>`;
        bind();
      }

      function fieldVal(name) {
        const el = container.querySelector('[data-field="' + name + '"]');
        return el ? el.value.trim() : '';
      }
      function syncForm() {
        if (!form) return;
        if (container.querySelector('[data-field="mf-prenom"]')) form.prenom = fieldVal('mf-prenom');
        if (container.querySelector('[data-field="mf-nom"]')) form.nom = fieldVal('mf-nom');
        if (container.querySelector('[data-field="mf-email"]')) form.email = fieldVal('mf-email');
        if (container.querySelector('[data-field="mf-role"]')) form.role = fieldVal('mf-role');
      }

      async function submitForm() {
        syncForm();
        if (!form.email) { toast("L'e-mail est obligatoire."); return; }
        sending = true; paint();
        const res = await sbFunction('org-invite', {
          email: form.email,
          prenom: form.prenom || '',
          nom: form.nom || '',
          organization_id: orgId,
          role: form.role
        });
        sending = false;
        if (!res.ok) {
          const msg = (res.data && res.data.error) ? res.data.error : "Erreur lors de l'envoi de l'invitation.";
          toast(msg);
          paint();
          return;
        }
        if (res.data && res.data.already_invited) {
          toast("Cette personne est déjà membre de l'organisation.");
        } else {
          toast('Invitation envoyée.');
        }
        form = null;
        await load(); paint();
      }

      async function saveRole(id) {
        const sel = container.querySelector('[data-field="role-' + id + '"]');
        const newRole = sel ? sel.value : '';
        if (!newRole) return;
        const res = await sbFetch('memberships?id=eq.' + id, { method: 'PATCH', body: { role: newRole } });
        if (!res.ok) { toast('Action impossible.'); return; }
        toast('Rôle mis à jour.');
        await load(); paint();
      }

      async function toggleStatus(id, currentStatus) {
        const newStatus = currentStatus === 'suspendu' ? 'actif' : 'suspendu';
        const res = await sbFetch('memberships?id=eq.' + id, { method: 'PATCH', body: { status: newStatus } });
        if (!res.ok) { toast('Action impossible.'); return; }
        toast(newStatus === 'suspendu' ? 'Membre suspendu.' : 'Membre réactivé.');
        await load(); paint();
      }

      function bind() {
        container.onclick = async function (e) {
          const overlay = e.target.closest('[data-action="overlay-form"]');
          if (overlay && e.target === overlay) { form = null; paint(); return; }
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          if (action === 'new') {
            const defaultRole = (roleCatalog.find(function (r) { return r.is_default; }) || roleCatalog[0] || {}).role_key || '';
            form = { prenom: '', nom: '', email: '', role: defaultRole };
            paint();
          }
          else if (action === 'close-form') { form = null; paint(); }
          else if (action === 'submit-form') { await submitForm(); }
          else if (action === 'save-role') { await saveRole(btn.getAttribute('data-id')); }
          else if (action === 'toggle-status') { await toggleStatus(btn.getAttribute('data-id'), btn.getAttribute('data-status')); }
        };
      }

      await load();
      paint();
    }
  };
})();
