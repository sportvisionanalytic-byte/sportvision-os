// Persona de démonstration pour les vidéos produit SportVision Club+.
//
// N'écrit RIEN en base : app.html, en mode démonstration (doDemoLogin),
// tourne entièrement sur l'objet JS `DATA` en mémoire — aucun appel réseau,
// aucune écriture Supabase. Cette fonction, injectée via page.evaluate()
// après le chargement de la page, MUTE les objets DATA/ROLES déjà déclarés
// par l'app (ils sont `const`, donc jamais réassignés, seulement modifiés)
// pour remplacer les identités de démonstration par défaut (Isabelle
// Faure, FC Clairval avec l'équipe "U18", sponsors Atlantide BTP...) par
// la persona demandée pour cette campagne de vidéos.
//
// Toutes les données ci-dessous sont fictives (cf. mission vidéos, §1).
function applyDemoPersona() {
  if (typeof ROLES === 'undefined' || typeof DATA === 'undefined') {
    throw new Error('ROLES/DATA introuvables — la page app.html a-t-elle bien chargé ?');
  }

  // Dirigeants — le club et les rôles techniques (admin, comm, coach...)
  // restent identiques, seul le prénom/nom affiché change.
  Object.assign(ROLES.president, { person: 'Marc Lefèvre' });
  Object.assign(ROLES.secretaire, { person: 'Sarah Martin' });
  Object.assign(ROLES.comm, { person: 'Lina Robert' });
  Object.assign(ROLES.coach, { person: 'Thomas Bernard' }); // label déjà "Coach U18"
  Object.assign(ROLES.sponsor_mgr, { person: 'Julien Morel' });

  // Équipe U18 -> U18 R2 (catégorie demandée pour ces vidéos)
  DATA.teams = DATA.teams.map(t => (t === 'U18' ? 'U18 R2' : t));
  DATA.equipes.forEach(e => {
    if (e.name === 'U18') e.name = 'U18 R2';
    if (e.cat === 'U18') e.cat = 'U18 R2';
    e.coach = e.name === 'U18 R2' ? 'Thomas Bernard' : e.coach;
  });
  DATA.matchItems.forEach(m => { if (m.team === 'U18') m.team = 'U18 R2'; });
  DATA.newsroomItems.forEach(n => { if (n.team === 'U18') n.team = 'U18 R2'; });
  DATA.creations.forEach(c => { if (c.team === 'U18') c.team = 'U18 R2'; });
  DATA.calEvents.forEach(e => { if (e.team === 'U18') e.team = 'U18 R2'; });

  // Prochain match U18 R2 (pour l'écran "À venir" avant l'ajout du résultat).
  DATA.matchItems.unshift({
    id: 'demo-next-u18r2', team: 'U18 R2', opp: 'US Fontainebleau',
    date: '2026-08-02', status: 'a_venir', lieu: 'Stade Municipal',
  });

  // Sponsors demandés pour cette campagne (remplace la liste de démo).
  DATA.sponsors = [
    { id: 'sp-nova', name: 'Nova Énergie', secteur: 'Énergie', niveau: 'Or', color: '#F5A623', teams: ['Seniors R1'], contact: 'Mme Roussel', debut: '2025-07-01', fin: '2027-06-30', montant: 4000, commitments: [
      { id: 'k1', type: 'Logo sur les affiches', due: 'Permanent', status: 'realise' },
      { id: 'k2', type: 'Publication mensuelle', due: '2026-08-15', status: 'a_faire' },
    ] },
    { id: 'sp-batipro', name: 'BatiPro', secteur: 'BTP', niveau: 'Argent', color: '#A7B6C9', teams: ['U18 R2'], contact: 'M. Faucher', debut: '2025-09-01', fin: '2026-08-31', montant: 2000, commitments: [
      { id: 'k3', type: 'Logo sur les affiches', due: 'Permanent', status: 'realise' },
    ] },
    { id: 'sp-horizon', name: 'Horizon Automobile', secteur: 'Automobile', niveau: 'Bronze', color: '#7455FF', teams: ['Club'], contact: 'M. Girard', debut: '2025-09-01', fin: '2026-08-31', montant: 800, commitments: [
      { id: 'k4', type: 'Publication de remerciement', due: '2026-08-10', status: 'a_faire' },
    ] },
  ];

  // Nettoyage léger pour un rendu net (retire les libellés de démo par défaut
  // qui pourraient apparaître à l'écran pendant les séquences enregistrées).
  document.title = 'SportVision Club+ — FC Clairval';
}

module.exports = { applyDemoPersona };
