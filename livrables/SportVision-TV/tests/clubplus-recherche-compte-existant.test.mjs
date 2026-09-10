// Retrouver un compte existant au-delà des 200 premiers (décisions Club+ du 10/09/2026, n° 3).
//
// POURQUOI CE TEST. `clubplus-invite` et `org-invite` retrouvaient un compte déjà inscrit avec
// `listUsers({ page: 1, perPage: 200 })` : les 200 comptes les PLUS RÉCENTS du projet. Une personne
// inscrite depuis longtemps sortait de cette fenêtre dès que 200 comptes plus récents existaient
// — et les tests en créent des dizaines par jour. Résultat : « Cet e-mail est déjà utilisé mais
// introuvable », et aucun accès créé. Le correctif interroge l'API d'administration par adresse,
// page après page, adresse comparée en minuscules.
//
// Le décor reproduit la situation réelle : un compte « ancien », puis assez de comptes plus récents
// pour le repousser au-delà du 200e rang (vérifié avant de mesurer). Le compte cherché est saisi en
// MAJUSCULES, entouré d'espaces : la comparaison doit se faire en minuscules.
//
//   node livrables/SportVision-TV/tests/clubplus-recherche-compte-existant.test.mjs          (fonctions déployées)
//   LOCAL_CLUBPLUS_INVITE=http://127.0.0.1:8001 LOCAL_ORG_INVITE=http://127.0.0.1:8002 node …
//
// Avec LOCAL_*, la MÊME fenêtre de décor mesure la fonction déployée PUIS le code du dépôt (lancé
// avec deno contre la vraie base) : rouge et vert côte à côte, sur le même compte, au même moment.
//
// FENÊTRE COURTE, VOLONTAIREMENT. Tant que les comptes de remplissage existent, TOUS les vrais
// comptes sont hors des 200 premiers : l'ancien code déployé (clubplus-invite, org-invite, et
// create-guest-media-checkout) ne retrouverait aucun compte existant. Le décor est donc créé et
// supprimé par lots parallèles, les mesures faites entre les deux : environ une minute.
//
// AUCUN E-MAIL. Le compte cherché existe et il est confirmé : `createUser` et `inviteUserByEmail`
// le refusent (« déjà inscrit ») sans rien envoyer, et c'est précisément cette branche que l'on
// mesure. Les comptes de remplissage sont créés par l'API d'administration, déjà confirmés.
//
// PROPRETÉ. Club de test « Villeneuve 340 SC », organisation « ZZ Test Org … » créée puis
// supprimée, adresses zz-cp-dec-…@example.invalid. Tout est supprimé à la fin, et vérifié.

import { rapporteur, SB, ANON, enTeteAdmin } from "./_session-os.mjs";

const T0 = Date.now();
const MDP = "ZzClubplusDec!2026";
const CLUB_NOM = "Villeneuve 340 SC";
const SEULEMENT = (process.env.SEULEMENT || "").split(",").map((s) => s.trim()).filter(Boolean);
const doit = (f) => SEULEMENT.length === 0 || SEULEMENT.includes(f);
// Chaque fonction est mesurée déployée, puis (si fourni) depuis le code du dépôt.
const CIBLES = {
  "clubplus-invite": [["déployée", `${SB}/functions/v1/clubplus-invite`], ...(process.env.LOCAL_CLUBPLUS_INVITE ? [["code du dépôt", process.env.LOCAL_CLUBPLUS_INVITE]] : [])],
  "org-invite": [["déployée", `${SB}/functions/v1/org-invite`], ...(process.env.LOCAL_ORG_INVITE ? [["code du dépôt", process.env.LOCAL_ORG_INVITE]] : [])],
};
const { t, bilan } = rapporteur();
const adresse = (objet) => `zz-cp-dec-${objet}-${T0}@example.invalid`;

const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) } });
const lire = async (chemin) => {
  const r = await api(chemin);
  return r.ok ? r.json() : [];
};
const auth = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });
async function creerCompte(email) {
  const d = await (await auth("admin/users", { method: "POST", body: JSON.stringify({ email, password: MDP, email_confirm: true }) })).json();
  if (!d.id) throw new Error(`création du compte ${email} impossible : ${JSON.stringify(d).slice(0, 160)}`);
  return d.id;
}
async function jetonMdp(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: MDP }) });
  return (await r.json()).access_token || null;
}
// Exactement ce que faisait l'ancien code : la première page de 200.
async function dansLes200Premiers(id) {
  const d = await (await auth("admin/users?page=1&per_page=200")).json();
  return (d?.users || []).some((u) => u.id === id);
}
async function appeler(url, jeton, corps) {
  const r = await fetch(url, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: JSON.stringify(corps),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const ids = [];
let club = null;
let org = null;
const debut = Date.now();
try {
  club = (await lire(`clubs?select=id&nom=eq.${encodeURIComponent(CLUB_NOM)}`))[0];
  if (!club) throw new Error("club de test introuvable");

  // L'Owner Club+ de test (il a le droit d'appeler clubplus-invite pour son club), et le compte
  // « ancien », créés en premier.
  const ownerEmail = adresse("owner");
  const ownerId = await creerCompte(ownerEmail);
  ids.push(ownerId);
  const rOwner = await api("club_members", { method: "POST", body: JSON.stringify({ user_id: ownerId, club_id: club.id, role: "admin", status: "actif", prenom: "ZZ", nom: "Owner recherche" }) });
  if (!rOwner.ok) throw new Error(`rattachement de l'Owner impossible : ${await rOwner.text()}`);
  const jetonOwner = await jetonMdp(ownerEmail);
  let orgId = null;
  if (doit("org-invite")) {
    orgId = crypto.randomUUID();
    const rOrg = await api("organizations", { method: "POST", body: JSON.stringify({ id: orgId, organization_type: "academie", nom: `ZZ Test Org ${T0}` }) });
    if (!rOrg.ok) throw new Error(`organisation de test impossible : ${await rOrg.text()}`);
    org = orgId;
    const rAdh = await api("memberships", { method: "POST", body: JSON.stringify({ user_id: ownerId, organization_id: orgId, role: "admin", status: "actif", source: "zz-test" }) });
    if (!rAdh.ok) throw new Error(`adhésion de test impossible : ${await rAdh.text()}`);
  }
  const cible = adresse("ancien-compte");
  const cibleId = await creerCompte(cible);
  ids.push(cibleId);

  // Puis les comptes plus récents, jusqu'à le sortir de la première page de 200.
  let n = 0;
  while ((await dansLes200Premiers(cibleId)) && n < 260) {
    const lot = [];
    for (let i = 0; i < 20; i++) lot.push(creerCompte(adresse(`remplissage-${n + i}`)));
    for (const id of await Promise.all(lot)) ids.push(id);
    n += 20;
  }
  const horsFenetre = !(await dansLes200Premiers(cibleId));
  console.log(`   décor : ${n} comptes plus récents créés ; le compte cherché est ${horsFenetre ? "au-delà" : "ENCORE dans"} les 200 premiers`);
  t("vitalité : le compte cherché est bien au-delà des 200 premiers (sinon le test ne mesure rien)", horsFenetre);

  if (doit("clubplus-invite")) {
    for (const [libelle, url] of CIBLES["clubplus-invite"]) {
      const r = await appeler(url, jetonOwner, { email: `  ${cible.toUpperCase()} `, prenom: "ZZ", nom: "Ancien", club_id: club.id, role: "coach", mode: "direct" });
      const m = (await lire(`club_members?select=role,status&user_id=eq.${cibleId}&club_id=eq.${club.id}`))[0];
      // Second appel (code du dépôt après la version déployée) : si le premier l'a déjà rattaché,
      // la réponse est « déjà invité » — c'est aussi un compte retrouvé.
      t(`clubplus-invite (${libelle}) retrouve le compte existant au-delà des 200 premiers, adresse en majuscules`,
        r.status === 200 && (r.data?.account_already_existed === true || r.data?.already_invited === true) && m?.role === "coach",
        `${r.status} ${JSON.stringify(r.data).slice(0, 160)} — rattachement ${JSON.stringify(m)}`);
      if (r.status === 200) t(`clubplus-invite (${libelle}) : aucun mot de passe renvoyé pour un compte existant`, !r.data?.password);
    }
  }

  if (doit("org-invite")) {
    for (const [libelle, url] of CIBLES["org-invite"]) {
      const r = await appeler(url, jetonOwner, { email: `  ${cible.toUpperCase()} `, prenom: "ZZ", nom: "Ancien", organization_id: orgId, role: "coach" });
      const a = (await lire(`memberships?select=role,status&user_id=eq.${cibleId}&organization_id=eq.${orgId}`))[0];
      t(`org-invite (${libelle}) retrouve le compte existant au-delà des 200 premiers, adresse en majuscules`,
        r.status === 200 && a?.status === "invitation", `${r.status} ${JSON.stringify(r.data).slice(0, 160)} — adhésion ${JSON.stringify(a)}`);
    }
  }
} catch (e) {
  t("le test va jusqu'au bout", false, String(e?.message || e).slice(0, 220));
} finally {
  // ── Nettoyage, vérifié ── (les comptes de remplissage d'abord : ce sont eux qui ouvrent la fenêtre)
  const del = (chemin) => api(chemin, { method: "DELETE" });
  const fermer = async (id) => {
    await del(`club_members?user_id=eq.${id}`);
    await del(`memberships?user_id=eq.${id}`);
    await del(`profiles?id=eq.${id}`);
    await auth(`admin/users/${id}`, { method: "DELETE" });
  };
  const remplissage = ids.slice(2).reverse();
  for (let i = 0; i < remplissage.length; i += 25) await Promise.all(remplissage.slice(i, i + 25).map(fermer));
  console.log(`   fenêtre ouverte pendant ${Math.round((Date.now() - debut) / 1000)} s`);
  if (org) {
    await del(`memberships?organization_id=eq.${org}`);
    await del(`organizations?id=eq.${org}`);
  }
  for (const id of ids.slice(0, 2)) await fermer(id);
  if (club) await del(`club_onboarding_events?club_id=eq.${club.id}&detail=ilike.ZZ*`);
  const restes = [];
  const d = await (await auth(`admin/users?filter=${encodeURIComponent(`-${T0}@example.invalid`)}&per_page=500`)).json();
  if ((d?.users || []).length) restes.push(`${d.users.length} compte(s)`);
  if ((await lire(`organizations?select=id&nom=like.*${T0}*`)).length) restes.push("organisation ZZ");
  for (const id of ids.slice(0, 2)) {
    if ((await lire(`club_members?select=id&user_id=eq.${id}`)).length) restes.push(`rattachement ${id}`);
    if ((await lire(`memberships?select=id&user_id=eq.${id}`)).length) restes.push(`adhésion ${id}`);
  }
  t("nettoyage : aucune trace laissée (comptes de remplissage compris)", restes.length === 0, `A NETTOYER A LA MAIN : ${restes.join(", ")}`);
}
process.exit(bilan() ? 1 : 0);
