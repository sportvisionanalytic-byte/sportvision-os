// Menus et données de Club+ pour les quatre rôles « de second rang » : responsable d'équipe,
// lecture seule, membre du bureau, responsable sponsors.
//
// POURQUOI CE TEST. Le 10/09/2026, ces quatre rôles recevaient tout le menu dirigeant (Factures,
// Paramètres, Invitations, Coachs & dirigeants…) : `filterClubRoleNav` ne leur connaissait aucune
// navigation propre et leur rendait donc celle de l'Owner Club+. Décision de Fouka : chaque rôle ne
// voit que les entrées qu'il a le droit d'utiliser, et ce qu'on masque à l'écran doit d'abord être
// fermé en base — un menu masqué ne protège rien.
//
// Le test mesure donc DEUX choses, dans cet ordre :
//   1. DONNÉES — ce que chaque rôle LIT et ÉCRIT réellement, par PostgREST avec son propre jeton
//      (jamais par l'API Management, qui s'exécute en postgres et répond oui à tout). Les tables
//      sont celles qui se cachent derrière les écrans du menu dirigeant : documents financiers,
//      abonnement, fiche du club, invitations, membres, sponsors, équipes, droits du club.
//   2. MENU — ce que chaque rôle voit dans la barre latérale de Club+, dans un vrai navigateur.
//
// Contrôles de vitalité : chaque mesure d'absence est accompagnée de la même mesure faite par
// l'Owner Club+ de test, qui DOIT voir la donnée. Sinon on mesure le vide et le test ne prouve rien.
//
//   node livrables/SportVision-TV/tests/clubplus-menus-roles.test.mjs
//   LOCAL=http://127.0.0.1:3400 node livrables/SportVision-TV/tests/clubplus-menus-roles.test.mjs
//   SEULEMENT=DONNEES node …   (ou SEULEMENT=MENU)
//
// PROPRETÉ. Club de test « Villeneuve 340 SC » uniquement. Adresses zz-cp-dec-…@example.invalid,
// comptes créés par l'API d'administration (aucun e-mail). Tout ce qui est créé (comptes,
// rattachements, invitation, sponsor, journal du club) est supprimé à la fin, et vérifié.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { CP, vraiesErreursCP } from "./_session-clubplus.mjs";
import { rapporteur, SB, ANON, enTeteAdmin } from "./_session-os.mjs";

const LOCAL = (process.env.LOCAL || "").replace(/\/+$/, "");
const SEULEMENT = (process.env.SEULEMENT || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const doit = (partie) => SEULEMENT.length === 0 || SEULEMENT.includes(partie);
const CLUB_NOM = "Villeneuve 340 SC";
const T0 = Date.now();
const MDP = "ZzClubplusDec!2026";
const { t, bilan } = rapporteur();

const traces = { emails: new Set(), sponsors: new Set(), invitations: new Set(), codes: new Set() };
const adresse = (objet) => {
  const e = `zz-cp-dec-${objet}-${T0}@example.invalid`;
  traces.emails.add(e);
  return e;
};

// ── Accès service (décor et nettoyage uniquement, jamais pour une mesure de droits) ──
const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, {
    ...opts,
    headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) },
  });
const lire = async (chemin) => {
  const r = await api(chemin);
  return r.ok ? r.json() : [];
};
const auth = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });

async function compteParEmail(email) {
  const d = await (await auth(`admin/users?filter=${encodeURIComponent(email.toLowerCase())}&per_page=50`)).json();
  return (d?.users || []).find((u) => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
}
async function creerCompte(email) {
  const r = await auth("admin/users", { method: "POST", body: JSON.stringify({ email, password: MDP, email_confirm: true }) });
  const d = await r.json();
  if (!d.id) throw new Error(`création du compte ${email} impossible : ${JSON.stringify(d).slice(0, 160)}`);
  return d.id;
}
async function jetonMdp(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: MDP }),
  });
  return (await r.json()).access_token || null;
}

// ── Le chemin réel : PostgREST avec le jeton de la personne ──
async function commeRole(jeton, chemin, { method = "GET", body, prefer = "return=representation" } = {}) {
  const r = await fetch(`${SB}/rest/v1/${chemin}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texte = await r.text();
  let data = null;
  try { data = JSON.parse(texte); } catch { data = texte; }
  return { status: r.status, data, lignes: Array.isArray(data) ? data.length : 0 };
}
const rpc = (jeton, fn, body) => commeRole(jeton, `rpc/${fn}`, { method: "POST", body });
async function fonction(jeton, nom, body) {
  const r = await fetch(`${SB}/functions/v1/${nom}`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
// Une écriture refusée prend deux formes : une erreur, ou zéro ligne touchée (la RLS filtre
// silencieusement un UPDATE/DELETE). Les deux comptent comme « refusé ».
const refuse = (r) => r.status >= 400 || r.lignes === 0;
const accepte = (r) => r.status < 300 && r.lignes > 0;

// ── Décor ────────────────────────────────────────────────────────────────────
// Rôles mesurés, et l'Owner Club+ de test comme contrôle positif. Le responsable d'équipe reçoit
// une équipe : c'est ainsi qu'il existe en production (club_members.teams pilote is_team_educateur).
const ROLES = ["resp_equipe", "lecture_seule", "membre_bureau", "sponsor_mgr"];

async function preparer() {
  const club = (await lire(`clubs?select=id,nom,portail_client_id,instagram_handle&nom=eq.${encodeURIComponent(CLUB_NOM)}`))[0];
  if (!club) throw new Error(`club ${CLUB_NOM} introuvable`);
  const equipes = await lire(`club_teams?select=id,name,couleur&club_id=eq.${club.id}&archivee=eq.false&order=name`);
  const personnes = {};
  for (const role of ["admin", ...ROLES]) {
    const email = adresse(role.replace(/_/g, ""));
    const id = await creerCompte(email);
    const teams = role === "resp_equipe" && equipes[0] ? [equipes[0].name] : [];
    const r = await api("club_members", {
      method: "POST",
      body: JSON.stringify({ user_id: id, club_id: club.id, role, status: "actif", prenom: "ZZ", nom: `Dec ${role}`, teams }),
    });
    if (!r.ok) throw new Error(`rattachement ${role} impossible : ${await r.text()}`);
    const ligne = (await r.json())[0];
    personnes[role] = { email, id, ligne: ligne.id, jeton: await jetonMdp(email) };
    if (!personnes[role].jeton) throw new Error(`aucun jeton pour ${role}`);
  }
  // Une invitation préparée par l'Owner (le chemin réel), et un sponsor : sans eux, « ne lit pas
  // les invitations » et « ne touche pas aux sponsors » mesureraient une table vide.
  const inv = await rpc(personnes.admin.jeton, "preparer_invitation_club", {
    p_club_id: club.id, p_email: adresse("invitee"), p_role: "coach", p_prenom: "ZZ", p_nom: "Invitee", p_telephone: null, p_teams: [],
  });
  if (inv.status >= 300) throw new Error(`invitation de décor refusée : ${JSON.stringify(inv.data).slice(0, 200)}`);
  traces.invitations.add(inv.data.id);
  const sp = (await (await api("club_sponsors", { method: "POST", body: JSON.stringify({ club_id: club.id, name: `ZZ Sponsor décor ${T0}` }) })).json())[0];
  traces.sponsors.add(sp.id);
  return { club, equipes, personnes, invitation: inv.data, sponsor: sp };
}

// ── 1. DONNÉES ───────────────────────────────────────────────────────────────
async function mesurerDonnees({ club, equipes, personnes, invitation, sponsor }) {
  console.log("\n1. DONNÉES — ce que la base rend à chaque rôle, avec son propre jeton");
  const P = club.portail_client_id;
  const owner = personnes.admin.jeton;

  // Vitalité du décor : l'Owner voit ce que les autres ne doivent pas voir.
  const vContrats = await commeRole(owner, `client_contrats?select=id&client_id=eq.${P}`);
  const vInvit = await commeRole(owner, `club_invitations?select=id&club_id=eq.${club.id}`);
  const vSuivi = await rpc(owner, "suivi_invitations_club", { p_club_id: club.id });
  t("vitalité : l'Owner Club+ voit les contrats du club", vContrats.lignes > 0, JSON.stringify(vContrats).slice(0, 160));
  t("vitalité : l'Owner Club+ voit l'invitation préparée", vInvit.lignes > 0, JSON.stringify(vInvit).slice(0, 160));
  t("vitalité : l'Owner Club+ lit le suivi des invitations", vSuivi.status < 300 && vSuivi.lignes > 0, JSON.stringify(vSuivi).slice(0, 160));
  // `select=id` : sans lui, la réponse redemande toutes les colonnes, SIRET compris, que
  // `authenticated` ne lit plus depuis le 11/09/2026 — c'est ainsi que Club+ l'envoie.
  const vClub = await commeRole(owner, `clubs?id=eq.${club.id}&select=id`, { method: "PATCH", body: { instagram_handle: club.instagram_handle } });
  t("vitalité : l'Owner Club+ peut modifier la fiche du club", accepte(vClub), JSON.stringify(vClub).slice(0, 160));
  const vSponsor = await commeRole(owner, `club_sponsors?select=id&id=eq.${sponsor.id}`);
  t("vitalité : l'Owner Club+ lit le sponsor de décor", vSponsor.lignes === 1, JSON.stringify(vSponsor).slice(0, 160));

  const releve = {};
  for (const role of ROLES) {
    const j = personnes[role].jeton;
    const r = (releve[role] = {});
    const bureau = role === "membre_bureau";

    // Documents financiers : ouverts au bureau (club_member_has_financial_view_access, règle v41),
    // jamais aux trois autres.
    r.contrats = await commeRole(j, `client_contrats?select=id&client_id=eq.${P}`);
    r.factures = await commeRole(j, `client_factures?select=id&client_id=eq.${P}`);
    r.devis = await commeRole(j, `client_devis?select=id&client_id=eq.${P}`);
    t(`[${role}] contrats du club : ${bureau ? "lus (bureau)" : "invisibles"}`, bureau ? r.contrats.lignes > 0 : r.contrats.lignes === 0, JSON.stringify(r.contrats).slice(0, 140));
    if (!bureau) t(`[${role}] factures et devis du club invisibles`, r.factures.lignes === 0 && r.devis.lignes === 0);

    // Invitations : réservées à qui opère le club (peut_operer_club = Owner, Président, CM).
    r.invitations = await commeRole(j, `club_invitations?select=id,token&club_id=eq.${club.id}`);
    t(`[${role}] ne lit aucune invitation (ni leurs jetons)`, r.invitations.lignes === 0, JSON.stringify(r.invitations).slice(0, 140));
    r.suivi = await rpc(j, "suivi_invitations_club", { p_club_id: club.id });
    t(`[${role}] le suivi des invitations lui est refusé`, r.suivi.status >= 400 || r.suivi.lignes === 0, JSON.stringify(r.suivi).slice(0, 140));
    r.preparer = await rpc(j, "preparer_invitation_club", {
      p_club_id: club.id, p_email: adresse(`invit-par-${role.replace(/_/g, "")}`), p_role: "coach", p_prenom: "ZZ", p_nom: "Refus", p_telephone: null, p_teams: [],
    });
    if (r.preparer.status < 300 && r.preparer.data?.id) traces.invitations.add(r.preparer.data.id);
    t(`[${role}] ne peut préparer aucune invitation`, r.preparer.status >= 400, JSON.stringify(r.preparer).slice(0, 140));
    r.insererInvit = await commeRole(j, "club_invitations", { method: "POST", body: { club_id: club.id, email: adresse(`invit-direct-${role.replace(/_/g, "")}`), role: "coach" } });
    t(`[${role}] ne peut écrire aucune invitation`, r.insererInvit.status >= 400, JSON.stringify(r.insererInvit).slice(0, 140));
    r.revoquer = await rpc(j, "revoquer_invitation_club", { p_id: invitation.id });
    const invApres = (await lire(`club_invitations?select=statut&id=eq.${invitation.id}`))[0];
    t(`[${role}] ne peut révoquer l'invitation d'un autre`, r.revoquer.status >= 400 && invApres?.statut !== "revoquee", `${r.revoquer.status} — statut ${invApres?.statut}`);

    // Fiche du club (Paramètres > Organisation) : écriture réservée à is_club_admin.
    r.majClub = await commeRole(j, `clubs?id=eq.${club.id}`, { method: "PATCH", body: { instagram_handle: club.instagram_handle } });
    t(`[${role}] ne peut pas modifier la fiche du club`, refuse(r.majClub), JSON.stringify(r.majClub).slice(0, 140));

    // Abonnement : lu dans `clubs` (formule, statut) ; souscription et portail Stripe côté serveur.
    // 11/09/2026 (décisions de Fouka) : les identifiants Stripe ne se lisent plus dans `clubs`
    // (colonnes fermées à authenticated) mais par club_donnees_restreintes, qui ne les rend qu'à
    // l'Owner Club+ et au Président. Le relevé lit donc la formule sans eux, et l'on affirme
    // qu'aucun de ces quatre rôles ne reçoit d'identifiant Stripe.
    r.abonnement = await commeRole(j, `clubs?select=plan,subscription_status&id=eq.${club.id}`);
    r.stripe = await rpc(j, "club_donnees_restreintes", { p_club_id: club.id });
    t(`[${role}] ne reçoit aucun identifiant Stripe`, r.stripe.status < 300 && r.stripe.lignes === 0, JSON.stringify(r.stripe).slice(0, 140));
    r.checkout = await fonction(j, "create-clubplus-subscription-checkout", { club_id: club.id, plan: "performance", engagement: "12mois" });
    r.portail = await fonction(j, "clubplus-billing-portal", { club_id: club.id });
    t(`[${role}] ne peut ni souscrire ni ouvrir le portail Stripe`, r.checkout.status === 403 && r.portail.status === 403, `${r.checkout.status} / ${r.portail.status}`);

    // Membres : la liste reste lisible par tout membre actif (règle existante, cm_same_club_select) ;
    // la modifier ou s'en attribuer un autre rôle ne l'est pas.
    r.membres = await commeRole(j, `club_members?select=id,role&club_id=eq.${club.id}`);
    r.majAutre = await commeRole(j, `club_members?id=eq.${personnes.admin.ligne}`, { method: "PATCH", body: { prenom: "ZZ" } });
    t(`[${role}] ne peut modifier la fiche d'un autre membre`, refuse(r.majAutre), JSON.stringify(r.majAutre).slice(0, 140));
    r.escalade = await commeRole(j, `club_members?id=eq.${personnes[role].ligne}`, { method: "PATCH", body: { role: "admin" } });
    const moi = (await lire(`club_members?select=role&id=eq.${personnes[role].ligne}`))[0];
    t(`[${role}] ne peut pas s'attribuer le rôle d'Owner Club+`, moi?.role === role, `${r.escalade.status} — rôle ${moi?.role}`);
    r.ajoutMembre = await commeRole(j, "club_members", { method: "POST", body: { user_id: personnes.admin.id, club_id: club.id, role: "coach", status: "actif" } });
    t(`[${role}] ne peut rattacher personne au club`, r.ajoutMembre.status >= 400, JSON.stringify(r.ajoutMembre).slice(0, 140));
    r.creerCompte = await fonction(j, "clubplus-invite", { email: adresse(`direct-${role.replace(/_/g, "")}`), prenom: "ZZ", nom: "Refus", club_id: club.id, role: "coach", mode: "direct" });
    t(`[${role}] ne peut créer aucun accès (clubplus-invite)`, r.creerCompte.status === 403, `${r.creerCompte.status} ${JSON.stringify(r.creerCompte.data).slice(0, 120)}`);

    // Équipes et droits du club (entitlements) : jamais écrits par ces rôles.
    r.creerEquipe = await commeRole(j, "club_teams", { method: "POST", body: { club_id: club.id, name: `ZZ Equipe ${role} ${T0}` } });
    t(`[${role}] ne peut pas créer d'équipe`, r.creerEquipe.status >= 400, JSON.stringify(r.creerEquipe).slice(0, 140));
    if (equipes[0]) {
      r.majEquipe = await commeRole(j, `club_teams?id=eq.${equipes[0].id}`, { method: "PATCH", body: { couleur: equipes[0].couleur } });
      t(`[${role}] ne peut pas modifier une équipe`, refuse(r.majEquipe), JSON.stringify(r.majEquipe).slice(0, 140));
    }
    r.majDroits = await commeRole(j, `organization_entitlements?organization_id=eq.${club.id}&module_key=eq.sponsors`, { method: "PATCH", body: { actif: true } });
    t(`[${role}] ne peut pas modifier les modules du club`, refuse(r.majDroits), JSON.stringify(r.majDroits).slice(0, 140));

    // Sponsors : écriture ouverte au responsable sponsors par la règle existante
    // (csp_member_insert/update), suppression réservée à l'administration du club.
    // 11/09/2026 (décision de Fouka n° 3) : la LECTURE n'est plus ouverte à tout membre. Parmi ces
    // quatre rôles, seul le responsable sponsors lit les sponsors (et leurs montants). Attente
    // modifiée : jusqu'ici le relevé montrait les sponsors lus par les quatre, sans l'affirmer.
    r.sponsors = await commeRole(j, `club_sponsors?select=id&club_id=eq.${club.id}`);
    const voitSponsor = Array.isArray(r.sponsors.data) && r.sponsors.data.some((x) => x.id === sponsor.id);
    t(`[${role}] ${role === "sponsor_mgr" ? "lit" : "ne lit pas"} les sponsors du club`, voitSponsor === (role === "sponsor_mgr"), JSON.stringify(r.sponsors).slice(0, 140));
    r.ajoutSponsor = await commeRole(j, "club_sponsors", { method: "POST", body: { club_id: club.id, name: `ZZ Sponsor ${role} ${T0}` } });
    if (r.ajoutSponsor.lignes) traces.sponsors.add(r.ajoutSponsor.data[0].id);
    r.majSponsor = await commeRole(j, `club_sponsors?id=eq.${sponsor.id}`, { method: "PATCH", body: { secteur: `zz ${role}` } });
    r.supprSponsor = await commeRole(j, `club_sponsors?id=eq.${sponsor.id}`, { method: "DELETE" });
    const sponsorEncore = (await lire(`club_sponsors?select=id&id=eq.${sponsor.id}`)).length === 1;
    if (role === "sponsor_mgr") {
      t(`[${role}] gère les sponsors : ajoute et modifie`, accepte(r.ajoutSponsor) && accepte(r.majSponsor), `${r.ajoutSponsor.status} / ${r.majSponsor.status}`);
    } else {
      t(`[${role}] ne peut ni ajouter ni modifier un sponsor`, r.ajoutSponsor.status >= 400 && refuse(r.majSponsor), `${r.ajoutSponsor.status} / ${JSON.stringify(r.majSponsor).slice(0, 100)}`);
    }
    t(`[${role}] ne peut pas supprimer un sponsor`, sponsorEncore, JSON.stringify(r.supprSponsor).slice(0, 120));

    // Codes d'invitation d'équipe : un code fait entrer un joueur dans une équipe.
    r.codes = await commeRole(j, `team_invite_codes?select=id,code&club_id=eq.${club.id}`);
    r.creerCode = await rpc(j, "create_invite_code", { p_club_id: club.id, p_team_id: equipes[0]?.id ?? null, p_max_uses: 1 });
    if (r.creerCode.status < 300) traces.codes.add(personnes[role].id);

    // Données d'exploitation (migration-decisions-clubplus-01, partie A) : lecture seule, membre du
    // bureau et responsable sponsors n'en écrivent aucune ; le responsable d'équipe, comme un coach.
    // ROUGE tant que la migration n'est pas exécutée en production : c'est la preuve par le chemin
    // réel qu'elle a bien pris, à rejouer juste après son exécution.
    r.creation = await commeRole(j, "club_creations", { method: "POST", body: { club_id: club.id, title: `ZZ Création ${role} ${T0}`, type: "visuel", status: "brouillon" } });
    if (role !== "resp_equipe") t(`[${role}] n'écrit aucune demande de création`, r.creation.status >= 400, JSON.stringify(r.creation).slice(0, 140));
    if (r.creation.lignes) await api(`club_creations?id=eq.${r.creation.data[0].id}`, { method: "DELETE" });

    // Paramètres du club (partie B) : lieux et créneaux d'une équipe qu'il n'encadre pas.
    r.lieu = await commeRole(j, "club_venues", { method: "POST", body: { club_id: club.id, nom: `ZZ Stade ${role} ${T0}` } });
    if (r.lieu.lignes) await api(`club_venues?id=eq.${r.lieu.data[0].id}`, { method: "DELETE" });
    t(`[${role}] n'ajoute aucun lieu au club`, r.lieu.status >= 400, JSON.stringify(r.lieu).slice(0, 140));
    const autreEquipe = equipes.find((e) => !(role === "resp_equipe" && e.name === equipes[0]?.name));
    if (autreEquipe) {
      r.creneau = await commeRole(j, "club_team_training_slots", { method: "POST", body: { team_id: autreEquipe.id, jour: "dimanche", heure_debut: "07:07", notes: `ZZ ${T0}` } });
      if (r.creneau.lignes) {
        traces.creneauxCrees = true;
        await api(`club_team_training_slots?id=eq.${r.creneau.data[0].id}`, { method: "DELETE" });
      }
      t(`[${role}] n'ajoute aucun créneau à une équipe qu'il n'encadre pas`, r.creneau.status >= 400, JSON.stringify(r.creneau).slice(0, 140));
    }
  }

  // Le relevé brut, pour le rapport : ce que la base rend, rôle par rôle.
  console.log("\n   Relevé (lignes lues / statut des écritures) :");
  const col = (r) => (r.status >= 400 ? `refus ${r.status}` : `${r.lignes} l.`);
  for (const role of ROLES) {
    const r = releve[role];
    console.log(`   ${role.padEnd(14)} contrats ${col(r.contrats)} · factures ${col(r.factures)} · invitations ${col(r.invitations)} · membres ${col(r.membres)} · sponsors ${col(r.sponsors)} · codes équipe ${col(r.codes)} · abonnement ${col(r.abonnement)}`);
    console.log(`   ${"".padEnd(14)} écrit : fiche club ${col(r.majClub)} · invitation ${col(r.preparer)} · membre ${col(r.majAutre)} · équipe ${col(r.creerEquipe)} · sponsor +${col(r.ajoutSponsor)} ~${col(r.majSponsor)} · code équipe ${col(r.creerCode)} · création ${col(r.creation)}`);
  }
  return releve;
}

// ── 2. MENU ──────────────────────────────────────────────────────────────────
// La navigation attendue après la décision du 10/09/2026. Ce qui n'est pas listé ici ne doit PAS
// apparaître : le test compare l'ensemble exact, pas seulement quelques absences.
const MENUS = {
  resp_equipe: ["Accueil", "Prestations", "Mes demandes", "Mes contenus", "Calendrier", "Messages", "Affiliations", "Matchs & résultats", "Mon profil"],
  lecture_seule: ["Accueil", "Calendrier", "Équipes", "Mon profil"],
  membre_bureau: ["Accueil", "Calendrier", "Équipes", "Factures", "Contrats", "Documents", "Mon profil"],
  sponsor_mgr: ["Accueil", "Calendrier", "Sponsors", "Mon profil"],
};
// Le libellé de l'équipe du responsable d'équipe dépend de la base : « Mon équipe U18 D2 ».
const INTERDITS = ["Factures", "Paramètres", "Invitations", "Coachs & dirigeants", "Contrats", "Documents", "Sponsors", "Onboarding", "Studio", "Newsroom"];

// LOCAL : chaque requête vers l'origine de production est servie par l'app locale (même principe
// que clubplus-creation-compte.test.mjs, dont ce bloc est repris).
async function brancherLocal(ctx) {
  if (!LOCAL) return;
  await ctx.route(`${CP}/**`, async (route) => {
    const url = route.request().url().replace(CP, LOCAL);
    const envoyes = { ...route.request().headers() };
    if (envoyes.origin) envoyes.origin = LOCAL;
    try {
      const rep = await route.fetch({ url, headers: envoyes, maxRedirects: 0 });
      const recus = { ...rep.headers() };
      if (recus.location) recus.location = recus.location.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, CP);
      if (rep.status() >= 300 && rep.status() < 400 && recus.location) {
        const cible = new URL(recus.location, route.request().url()).href;
        delete recus.location;
        delete recus["content-length"];
        return route.fulfill({ status: 200, headers: { ...recus, "content-type": "text/html; charset=utf-8" }, body: `<!doctype html><script>location.replace(${JSON.stringify(cible)})</script>` });
      }
      await route.fulfill({ response: rep, headers: recus });
    } catch {
      await route.abort().catch(() => {});
    }
  });
}

async function mesurerMenus({ equipes, personnes }, nav) {
  console.log(`\n2. MENU — ${LOCAL ? `app locale ${LOCAL} servie sous ${CP}` : CP}`);
  for (const role of ["admin", ...ROLES]) {
    const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
    await brancherLocal(ctx);
    const page = await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));
    page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 200)); });
    try {
      await page.goto(`${CP}/clubplus/auth/login`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3500);
      await page.locator("input[type=email]").first().fill(personnes[role].email);
      await page.locator("input[type=password]").first().fill(MDP);
      await page.locator("button", { hasText: "Se connecter" }).first().click();
      // On attend le menu lui-même, pas une durée : un premier passage à durée fixe a lu un menu
      // vide pour deux rôles, simplement parce que la page n'avait pas fini de se poser.
      await page.waitForSelector("aside nav a", { timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const entrees = await page.evaluate(() => [...document.querySelectorAll("aside nav a")].map((a) => a.textContent.trim()).filter(Boolean));
      if (entrees.length === 0) console.log(`       (aucun menu pour ${role} — page ${page.url().replace(CP, "")} : ${(await page.evaluate(() => document.body?.innerText || "")).replace(/\s+/g, " ").slice(0, 160)})`);
      const gererOffre = await page.locator("aside a", { hasText: "Gérer mon offre" }).count();
      console.log(`       ${role} : ${entrees.join(" | ")}${gererOffre ? " + « Gérer mon offre »" : ""}`);
      if (role === "admin") {
        // Contrôle positif : l'Owner garde son menu complet. Sans lui, un sélecteur cassé
        // ferait passer toutes les absences ci-dessous pour un succès.
        t("contrôle : l'Owner Club+ voit Factures, Paramètres et Invitations", ["Factures", "Paramètres", "Invitations"].every((e) => entrees.includes(e)), entrees.join(" | "));
        continue;
      }
      const attendu = [...MENUS[role]];
      if (role === "resp_equipe") attendu.push(equipes[0] ? `Mon équipe ${equipes[0].name}` : "Mes équipes");
      const manquants = attendu.filter((e) => !entrees.includes(e));
      const enTrop = entrees.filter((e) => !attendu.includes(e));
      t(`[${role}] menu exact : ${attendu.join(", ")}`, manquants.length === 0 && enTrop.length === 0, `manquants : ${manquants.join(", ") || "—"} · en trop : ${enTrop.join(", ") || "—"}`);
      const interditsVus = INTERDITS.filter((e) => entrees.includes(e) && !attendu.includes(e));
      t(`[${role}] aucune entrée dirigeant (Factures, Paramètres, Invitations…) hors de ses droits`, interditsVus.length === 0, interditsVus.join(", "));
      t(`[${role}] pas de « Gérer mon offre » en bas de menu`, gererOffre === 0);
      t(`[${role}] aucune erreur JavaScript`, vraiesErreursCP(erreurs).length === 0, vraiesErreursCP(erreurs).slice(0, 3).join(" · "));
    } finally {
      await ctx.close();
    }
  }
}

// ── Nettoyage, vérifié ──────────────────────────────────────────────────────
async function nettoyer(club) {
  const del = (chemin) => api(chemin, { method: "DELETE" });
  const ids = [];
  for (const e of traces.emails) {
    const u = await compteParEmail(e);
    if (u) ids.push(u.id);
  }
  for (const id of traces.sponsors) await del(`club_sponsors?id=eq.${id}`);
  if (club) {
    await del(`club_sponsors?club_id=eq.${club.id}&name=like.ZZ%20Sponsor*${T0}*`);
    await del(`club_teams?club_id=eq.${club.id}&name=like.ZZ%20Equipe*${T0}*`);
    await del(`club_creations?club_id=eq.${club.id}&title=like.ZZ%20Cr*${T0}*`);
    await del(`club_venues?club_id=eq.${club.id}&nom=like.ZZ%20Stade*${T0}*`);
    for (const e of await lire(`club_teams?select=id&club_id=eq.${club.id}`)) await del(`club_team_training_slots?team_id=eq.${e.id}&notes=eq.ZZ%20${T0}`);
  }
  for (const id of traces.invitations) await del(`club_invitations?id=eq.${id}`);
  for (const e of traces.emails) {
    await del(`club_invitations?email=eq.${encodeURIComponent(e)}`);
    await del(`notification_outbox?recipient_email=eq.${encodeURIComponent(e)}`);
  }
  // Le journal du club : sponsors, invitations, lieux et créneaux de ce test y ont laissé une ligne.
  // Un créneau se journalise sous le NOM de l'équipe, pas sous « ZZ » : on le retrouve par son
  // auteur (le compte de test — AVANT de supprimer ce compte), et, pour sa suppression faite en
  // service, par l'heure du test.
  if (club) {
    for (const id of ids) await del(`club_onboarding_events?club_id=eq.${club.id}&auteur_id=eq.${id}`);
  }
  for (const id of ids) {
    await del(`team_invite_codes?created_by=eq.${id}`);
    await del(`club_members?user_id=eq.${id}`);
    await del(`memberships?user_id=eq.${id}`);
    await del(`notifications?destinataire_id=eq.${id}`);
    await del(`profiles?id=eq.${id}`);
    await auth(`admin/users/${id}`, { method: "DELETE" });
  }
  if (club) {
    await del(`club_onboarding_events?club_id=eq.${club.id}&detail=like.*${T0}*`);
    await del(`club_onboarding_events?club_id=eq.${club.id}&detail=ilike.ZZ*`);
    if (traces.creneauxCrees) {
      await del(`club_onboarding_events?club_id=eq.${club.id}&section=eq.entrainements&auteur_id=is.null&created_at=gte.${new Date(T0).toISOString()}`);
    }
  }

  const restes = [];
  for (const e of traces.emails) {
    if (await compteParEmail(e)) restes.push(`compte ${e}`);
    if ((await lire(`club_invitations?select=id&email=eq.${encodeURIComponent(e)}`)).length) restes.push(`invitation ${e}`);
  }
  for (const id of ids) {
    if ((await lire(`club_members?select=id&user_id=eq.${id}`)).length) restes.push(`rattachement ${id}`);
    if ((await lire(`memberships?select=id&user_id=eq.${id}`)).length) restes.push(`adhésion ${id}`);
    if ((await lire(`team_invite_codes?select=id&created_by=eq.${id}`)).length) restes.push(`code d'équipe ${id}`);
  }
  for (const id of traces.sponsors) if ((await lire(`club_sponsors?select=id&id=eq.${id}`)).length) restes.push(`sponsor ${id}`);
  if (club) {
    if ((await lire(`club_sponsors?select=id&club_id=eq.${club.id}&name=like.ZZ*`)).length) restes.push("sponsor ZZ");
    if ((await lire(`club_teams?select=id&club_id=eq.${club.id}&name=like.ZZ*`)).length) restes.push("équipe ZZ");
    if ((await lire(`club_creations?select=id&club_id=eq.${club.id}&title=like.ZZ*`)).length) restes.push("création ZZ");
    if ((await lire(`club_venues?select=id&club_id=eq.${club.id}&nom=like.ZZ*`)).length) restes.push("lieu ZZ");
    for (const e of await lire(`club_teams?select=id&club_id=eq.${club.id}`)) {
      if ((await lire(`club_team_training_slots?select=id&team_id=eq.${e.id}&notes=like.ZZ*`)).length) restes.push("créneau ZZ");
    }
    if ((await lire(`club_onboarding_events?select=id&club_id=eq.${club.id}&created_at=gte.${new Date(T0).toISOString()}`)).length) restes.push("journal du club (lignes datées du test)");
    if ((await lire(`club_onboarding_events?select=id&club_id=eq.${club.id}&detail=ilike.ZZ*`)).length) restes.push("journal du club");
  }
  t("nettoyage : aucune trace laissée (comptes, rattachements, invitations, sponsors, journal)", restes.length === 0, `A NETTOYER A LA MAIN : ${restes.join(", ")}`);
}

let decor = null;
const nav = doit("MENU") ? await chromium.launch() : null;
try {
  decor = await preparer();
  if (doit("DONNEES")) await mesurerDonnees(decor);
  if (doit("MENU")) await mesurerMenus(decor, nav);
} catch (e) {
  t("le test va jusqu'au bout", false, String(e?.stack || e).split("\n").slice(0, 3).join(" · "));
} finally {
  if (nav) await nav.close();
  await nettoyer(decor?.club);
}
process.exit(bilan() ? 1 : 0);
