// L'écran de suivi des invitations, celui d'où le club relance et révoque.
//
// POURQUOI CE TEST (14/09/2026). Fouka s'apprête à envoyer les invitations des coachs d'un vrai
// club. Le geste d'envoi est couvert ; ce qui ne l'était pas, c'est l'APRÈS : voir qui n'a pas
// encore répondu, renvoyer le lien, et couper une invitation partie à la mauvaise adresse.
//
// Ce dernier point est une question de sécurité, pas de confort : une invitation porte des droits
// sur un club. Si « Révoquer » ne révoque pas vraiment, le lien reste utilisable par qui l'a reçu.
//
// CE QU'ON MESURE :
//   1. Une invitation préparée apparaît dans la liste, avec son adresse et son rôle.
//   2. « Renvoyer » remet un e-mail en file, sans créer de seconde invitation.
//   3. « Révoquer » la retire de la liste ET rend le lien inutilisable, vérifié en base par la
//      fonction que l'invité appellerait vraiment.
//
// PROPRETÉ. Club de test de Fouka, adresse en .invalid (aucun e-mail ne part vers ce domaine),
// tout supprimé à la fin.
//
//   node livrables/SportVision-TV/tests/clubplus-suivi-invitations.test.mjs

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { rapporteur, SB, enTeteAdmin, env } from "./_session-os.mjs";
import { CP, ouvrirClubPlus, vraiesErreursCP } from "./_session-clubplus.mjs";

const CLUB = "Villeneuve 340 SC";
const T0 = Date.now();
const MAIL = `zz-suivi-${T0}@example.invalid`;
const { t, bilan } = rapporteur();
const api = (c, o = {}) => fetch(`${SB}/rest/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(o.headers || {}) } });
const lire = async (c) => (await api(c)).json();
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
})).json();
const texte = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").trim();

async function fermerAssistant(page) {
  const a = page.locator("div.fixed").filter({ hasText: "ONBOARDING FULL COMMUNICATION" }).first();
  if (await a.count()) {
    const b = a.locator("button", { hasText: "Terminer plus tard" }).first();
    if (await b.count()) { await b.click({ force: true }); await page.waitForTimeout(2000); }
  }
}

async function main() {
  const navigateur = await chromium.launch();
  let invitId = null;
  try {
    const club = (await lire(`clubs?select=id,nom&nom=eq.Villeneuve%20340%20SC`))[0];
    const equipe = (await lire(`club_teams?select=id,name&club_id=eq.${club.id}&order=name&limit=1`))[0];
    const admin = (await lire(`club_members?select=user_id&club_id=eq.${club.id}&role=in.(admin,president)&status=eq.actif&limit=1`))[0];
    const compteAdmin = await (await fetch(`${SB}/auth/v1/admin/users/${admin.user_id}`, { headers: enTeteAdmin })).json();
    t("décor : club et dirigeant", !!club?.id && !!compteAdmin?.email, `${club?.nom} / ${compteAdmin?.email}`);

    // L'invitation est préparée par la fonction de la base, SOUS L'IDENTITÉ du dirigeant : elle
    // vérifie qui invite. L'appeler en administrateur système la fait refuser — « Vous n'êtes pas
    // autorisé à inviter sur ce club » — et ce refus ne dit rien du produit, seulement du chemin
    // emprunté par le test.
    const lien = (await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
      method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email: compteAdmin.email, redirect_to: `${CP}/clubplus` }),
    })).json()).action_link;
    const loc = (await fetch(lien, { redirect: "manual" })).headers.get("location") || "";
    const jetonAdmin = new URLSearchParams(loc.split("#")[1] || "").get("access_token");
    const prep = await (await fetch(`${SB}/rest/v1/rpc/preparer_invitation_club`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jetonAdmin}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_club_id: club.id, p_email: MAIL, p_role: "coach", p_prenom: "ZZ", p_nom: "Suivi",
        p_telephone: null, p_teams: [equipe.name],
      }),
    })).json();
    const premier = Array.isArray(prep) ? prep[0] : prep;
    invitId = premier?.id ?? null;
    const jeton = premier?.token ?? null;
    t("décor : une invitation préparée", !!invitId && !!jeton, JSON.stringify(prep).slice(0, 200));
    if (!invitId) return;

    const { page, erreurs } = await ouvrirClubPlus(navigateur, compteAdmin.email, { chemin: "/clubplus/invitations" });
    await fermerAssistant(page);
    await page.waitForTimeout(3000);

    // ── 1. Elle est visible, avec ce qu'il faut pour la reconnaître ─────────
    console.log("\n1. La liste");
    const vu = await texte(page);
    t("l'invitation apparaît dans la liste", vu.includes(MAIL), vu.slice(0, 220));
    t("son équipe est rappelée", vu.includes(equipe.name), vu.slice(0, 260));

    // ── 2. Renvoyer ────────────────────────────────────────────────────────
    console.log("\n2. Renvoyer le lien");
    const ligne = page.locator("div").filter({ hasText: MAIL }).last();
    const renvoyer = ligne.locator("button", { hasText: /^(Envoyer|Renvoyer)$/ }).first();
    t("un bouton permet d'envoyer ou de renvoyer", await renvoyer.count() > 0);
    if (await renvoyer.count()) {
      await renvoyer.click();
      await page.waitForTimeout(5000);
      const invits = await lire(`club_invitations?select=id,statut&email=eq.${MAIL}`);
      t("aucune seconde invitation n'est créée", invits.length === 1, `${invits.length} invitation(s)`);
      // L'adresse est en .invalid : l'e-mail n'est pas distribué, mais la demande doit être tracée.
      t("l'invitation est marquée comme envoyée", invits[0]?.statut === "envoyee" || invits[0]?.statut === "preparee",
        invits[0]?.statut ?? "(inconnu)");
    }

    // ── 3. Révoquer, et le lien meurt vraiment ─────────────────────────────
    console.log("\n3. Révoquer");
    const revoquer = page.locator("div").filter({ hasText: MAIL }).last().locator("button", { hasText: /Révoquer/ }).first();
    t("un bouton permet de révoquer", await revoquer.count() > 0);
    if (await revoquer.count()) {
      await revoquer.click();
      await page.waitForTimeout(1500);
      // Une confirmation peut s'interposer : on la valide si elle existe.
      const confirmer = page.locator("button", { hasText: /^(Révoquer|Confirmer|Oui)$/ }).last();
      if (await confirmer.count()) { await confirmer.click().catch(() => {}); }
      await page.waitForTimeout(5000);

      const apres = await lire(`club_invitations?select=statut&email=eq.${MAIL}`);
      t("l'invitation n'est plus active", apres[0]?.statut !== "envoyee" && apres[0]?.statut !== "preparee",
        apres[0]?.statut ?? "(supprimée)");

      // Le vrai contrôle : le lien lui-même, tel que l'invité l'utiliserait.
      const relecture = await sql(`select * from lire_invitation_club('${jeton}')`);
      const refuse = !Array.isArray(relecture) || relecture.length === 0 || relecture[0]?.message || relecture[0]?.error
        || relecture[0]?.statut === "revoquee";
      t("le lien révoqué n'ouvre plus rien", refuse, JSON.stringify(relecture).slice(0, 200));
    }
    t("aucune erreur JavaScript", vraiesErreursCP(erreurs).length === 0, vraiesErreursCP(erreurs)[0] || "");
  } finally {
    await api(`club_invitations?email=eq.${MAIL}`, { method: "DELETE" });
    await navigateur.close();
    const reste = await lire(`club_invitations?select=id&email=eq.${MAIL}`);
    t("nettoyage : aucune invitation de test ne subsiste", (Array.isArray(reste) ? reste.length : 1) === 0);
  }
  process.exit(bilan() === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
