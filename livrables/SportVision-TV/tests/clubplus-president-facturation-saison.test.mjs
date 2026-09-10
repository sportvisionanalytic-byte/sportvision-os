// Facturation et transition de saison, avec un vrai président et un vrai coach.
//
// POURQUOI CE TEST. Décisions de Fouka du 10/09/2026, qui ferment le chantier Permissions CM /
// Club V1 :
//   • Facturation — le président a la facturation CLIENT de son club (documents, statut, offre),
//     jamais la comptabilité SportVision : ni modifier ou créer une facture, ni rembourser, ni
//     voir marges, salaires ou coûts, ni toucher aux données d'un autre club.
//   • Transition de saison — l'Admin/Owner et le président la valident ; le coach, jamais.
//     (Le CM est refusé aussi, faute de workflow de préparation : prouvé en base par
//     transition-saison.test.sql, qui porte les quatre niveaux.)
//
// CE QU'IL FAIT. Le vrai Admin/Owner du club de test prépare deux invitations avec SON jeton ;
// deux comptes .invalid les acceptent par la vraie fonction ; chaque droit se vérifie ensuite par
// l'API avec le jeton de la personne, puis à l'écran. Rien n'est validé : on ouvre la transition
// de saison, on ne la lance pas.
//
// PROPRETÉ. Club de test de Fouka (Villeneuve 340 SC). Comptes, rattachements et invitations
// supprimés à la fin, suppression vérifiée ; la saison du club et la facture témoin sont relues.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { CP, ouvrirClubPlus, vraiesErreursCP } from "./_session-clubplus.mjs";
import { rapporteur, SB, ANON, enTeteAdmin, jeton } from "./_session-os.mjs";

const CLUB = "Villeneuve 340 SC";
const horodatage = Date.now();
const EMAIL_P = `zz-president-fs-${horodatage}@example.invalid`;
const EMAIL_C = `zz-coach-fs-${horodatage}@example.invalid`;
const MDP = "ZzFacturation!2026-Test";
const { t, bilan } = rapporteur();

const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });
const authApi = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });
// Une requête avec le jeton d'une personne : le chemin qu'emprunte son écran.
const en = (acces) => (chemin, opts = {}) =>
  fetch(`${SB}/${chemin}`, { ...opts, headers: { apikey: ANON, Authorization: `Bearer ${acces}`, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) } });
const lignes = async (r) => { const b = await r.json().catch(() => null); return Array.isArray(b) ? b : []; };

const club = (await (await api(`clubs?select=id,saison,portail_client_id&nom=eq.${encodeURIComponent(CLUB)}`)).json())[0];
if (!club) { console.log(`Club ${CLUB} introuvable — test ignoré.`); process.exit(0); }
const autreClub = (await (await api(`clubs?select=id,portail_client_id&id=neq.${club.id}&portail_client_id=not.is.null&limit=1`)).json())[0];
const equipe = (await (await api(`club_teams?select=name&club_id=eq.${club.id}&limit=1`)).json())[0];
const factureTemoin = (await (await api(`factures?select=id,montant_ttc,statut&limit=1`)).json())[0];

const invitant = (await (await api(`club_members?select=user_id&club_id=eq.${club.id}&role=eq.admin&status=eq.actif&limit=1`)).json())[0];
const invitantEmail = invitant && (await (await authApi(`admin/users/${invitant.user_id}`)).json()).email;
const jetonOwner = invitantEmail && await jeton(invitantEmail);
if (!jetonOwner) { console.log("Jeton de l'Admin/Owner indisponible — test ignoré."); process.exit(0); }

const ids = {};
const navigateur = await chromium.launch();
try {
  // ── Deux personnes, entrées par le vrai chemin ────────────────────────────
  for (const [email, role, equipes] of [[EMAIL_P, "president", []], [EMAIL_C, "coach", equipe ? [equipe.name] : []]]) {
    const r = await en(jetonOwner.acces)("rest/v1/rpc/preparer_invitation_club", {
      method: "POST",
      body: JSON.stringify({ p_club_id: club.id, p_email: email, p_role: role, p_prenom: "ZZ", p_nom: role, p_telephone: null, p_teams: equipes }),
    });
    t(`l'Admin/Owner prépare l'invitation ${role}`, r.status < 300, `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    const cree = await (await authApi("admin/users", { method: "POST", body: JSON.stringify({ email, password: MDP, email_confirm: true }) })).json();
    ids[role] = cree?.id;
    const j = await jeton(email);
    const token = (await (await api(`club_invitations?select=token&email=eq.${encodeURIComponent(email)}`)).json())[0]?.token;
    const acc = await en(j.acces)("rest/v1/rpc/accepter_invitation_club", { method: "POST", body: JSON.stringify({ p_token: token }) });
    t(`le ${role} accepte sa propre invitation`, acc.status < 300, `HTTP ${acc.status} ${(await acc.text()).slice(0, 120)}`);
    ids[`jeton_${role}`] = j.acces;
  }
  const P = en(ids.jeton_president), C = en(ids.jeton_coach);

  // ── Facturation, côté API ─────────────────────────────────────────────────
  const contrats = await P(`rest/v1/client_contrats?select=id,client_id&client_id=eq.${club.portail_client_id}`);
  t("président : lit les contrats de son club", contrats.status === 200, `HTTP ${contrats.status}`);
  const factures = await P(`rest/v1/client_factures?select=id,statut,pdf_url,montant_ttc&client_id=eq.${club.portail_client_id}`);
  t("président : lit les factures de son club (statut, PDF)", factures.status === 200, `HTTP ${factures.status}`);
  if (autreClub) {
    const ailleurs = [
      ...(await lignes(await P(`rest/v1/client_contrats?select=id&client_id=eq.${autreClub.portail_client_id}`))),
      ...(await lignes(await P(`rest/v1/client_factures?select=id&client_id=eq.${autreClub.portail_client_id}`))),
      ...(await lignes(await P(`rest/v1/client_devis?select=id&client_id=eq.${autreClub.portail_client_id}`))),
    ];
    t("président : ne voit rien de la facturation d'un autre club", ailleurs.length === 0, `${ailleurs.length} ligne(s)`);
  }
  for (const table of ["factures", "devis", "contrats", "paiements", "avoirs", "commissions", "frais", "pole_remuneration_calculs", "media_orders_remboursements"]) {
    const vu = await lignes(await P(`rest/v1/${table}?select=*&limit=5`));
    t(`président : comptabilité interne fermée — ${table}`, vu.length === 0, `${vu.length} ligne(s) lisible(s)`);
  }
  if (factureTemoin) {
    await P(`rest/v1/factures?id=eq.${factureTemoin.id}`, { method: "PATCH", body: JSON.stringify({ montant_ttc: 1 }) });
    const relue = (await (await api(`factures?select=montant_ttc,statut&id=eq.${factureTemoin.id}`)).json())[0];
    t("président : ne modifie pas le montant d'une facture émise",
      String(relue?.montant_ttc) === String(factureTemoin.montant_ttc), `avant ${factureTemoin.montant_ttc}, après ${relue?.montant_ttc}`);
    await P(`rest/v1/factures?id=eq.${factureTemoin.id}`, { method: "PATCH", body: JSON.stringify({ statut: "annulee" }) });
    const relue2 = (await (await api(`factures?select=statut&id=eq.${factureTemoin.id}`)).json())[0];
    t("président : n'annule pas une facture", relue2?.statut === factureTemoin.statut, `statut ${relue2?.statut}`);
  }
  const creation = await P("rest/v1/factures", { method: "POST", body: JSON.stringify({ client_id: club.portail_client_id, numero: "ZZ-TEST", montant_ttc: 1 }) });
  t("président : ne crée pas de facture SportVision", creation.status >= 400, `HTTP ${creation.status}`);
  const avoir = await P("rest/v1/avoirs", { method: "POST", body: JSON.stringify({ montant_ttc: 1 }) });
  t("président : n'émet pas de remboursement (avoir)", avoir.status >= 400, `HTTP ${avoir.status}`);
  for (const fn of ["clubplus-billing-portal", "create-clubplus-subscription-checkout"]) {
    const r = await P(`functions/v1/${fn}`, { method: "POST", body: JSON.stringify({ club_id: club.id, plan: "club", engagement: "12mois" }) });
    t(`président : ${fn} refusé (souscrire/résilier restent à l'Owner)`, r.status === 403, `HTTP ${r.status}`);
  }

  // ── Transition de saison, côté API ────────────────────────────────────────
  const rpc = async (X) => (await X("rest/v1/rpc/peut_basculer_saison", { method: "POST", body: JSON.stringify({ p_club_id: club.id }) })).json();
  t("président : peut valider la transition de saison", (await rpc(P)) === true);
  t("coach : ne peut pas valider la transition de saison", (await rpc(C)) === false);
  await C(`rest/v1/clubs?id=eq.${club.id}`, { method: "PATCH", body: JSON.stringify({ saison: "2099-2100" }) });
  const saison = (await (await api(`clubs?select=saison&id=eq.${club.id}`)).json())[0]?.saison;
  t("coach : ne bascule pas la saison du club", saison === club.saison, `saison ${saison}`);

  // ── À l'écran : le président ──────────────────────────────────────────────
  {
    const { page, erreurs, ctx } = await ouvrirClubPlus(navigateur, EMAIL_P, { chemin: "/clubplus/billing" });
    await page.waitForTimeout(3000);
    const texte = await page.evaluate(() => document.body.innerText);
    t("président, Facturation : devis, contrats et factures du club", /Devis, contrats et factures de/.test(texte), texte.slice(0, 160));
    t("président, Facturation : « Mon offre » visible", /Mon offre/.test(texte));
    t("président, Facturation : ni souscrire ni gérer l'abonnement", !/S'abonner|Gérer mon abonnement/.test(texte));
    await page.goto(`${CP}/clubplus/teams`, { waitUntil: "networkidle" }); await page.waitForTimeout(3500);
    t("président, Équipes : bouton « Transition de saison »", await page.locator("a", { hasText: "Transition de saison" }).count() > 0);
    await page.goto(`${CP}/clubplus/season-transition`, { waitUntil: "networkidle" }); await page.waitForTimeout(4000);
    const tr = await page.evaluate(() => document.body.innerText);
    t("président, Transition : le parcours s'ouvre sur la saison actuelle", /Saison actuelle/.test(tr) && !/se valide par/.test(tr), tr.slice(0, 200));
    t("président : aucune erreur JavaScript", vraiesErreursCP(erreurs).length === 0, vraiesErreursCP(erreurs).slice(0, 3).join(" | "));
    await ctx.close();
  }

  // ── À l'écran : le coach ──────────────────────────────────────────────────
  {
    const { page, erreurs, ctx } = await ouvrirClubPlus(navigateur, EMAIL_C, { chemin: "/clubplus/season-transition" });
    await page.waitForTimeout(3000);
    const tr = await page.evaluate(() => document.body.innerText);
    t("coach, Transition : refusée, et dit par qui elle se valide", /se valide par l.administrateur ou le président/.test(tr), tr.slice(0, 200));
    await page.goto(`${CP}/clubplus/teams`, { waitUntil: "networkidle" }); await page.waitForTimeout(3500);
    t("coach, Équipes : pas de bouton « Transition de saison »", await page.locator("a", { hasText: "Transition de saison" }).count() === 0);
    await page.goto(`${CP}/clubplus/billing`, { waitUntil: "networkidle" }); await page.waitForTimeout(3500);
    const fa = await page.evaluate(() => document.body.innerText);
    t("coach, Facturation : aucun document financier", !/Devis, contrats et factures de/.test(fa), fa.slice(0, 160));
    t("coach : aucune erreur JavaScript", vraiesErreursCP(erreurs).length === 0, vraiesErreursCP(erreurs).slice(0, 3).join(" | "));
    await ctx.close();
  }
} finally {
  await navigateur.close();

  // ── Nettoyage, vérifié ────────────────────────────────────────────────────
  for (const role of ["president", "coach"]) {
    if (ids[role]) {
      await api(`club_members?user_id=eq.${ids[role]}`, { method: "DELETE" });
      await authApi(`admin/users/${ids[role]}`, { method: "DELETE" });
    }
  }
  for (const email of [EMAIL_P, EMAIL_C]) await api(`club_invitations?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });

  const restes = (await lignes(await api(`club_members?select=user_id&user_id=in.(${[ids.president, ids.coach].filter(Boolean).join(",") || "00000000-0000-0000-0000-000000000000"})`))).length
    + (await lignes(await api(`club_invitations?select=id&email=in.(${encodeURIComponent(EMAIL_P)},${encodeURIComponent(EMAIL_C)})`))).length;
  t("les comptes de test ne laissent aucune trace", restes === 0, `${restes} ligne(s) — À NETTOYER À LA MAIN`);
  const saisonFin = (await (await api(`clubs?select=saison&id=eq.${club.id}`)).json())[0]?.saison;
  t("la saison du club est inchangée", saisonFin === club.saison, `${club.saison} → ${saisonFin}`);
}

process.exit(bilan() ? 1 : 0);
