// Inviter un coach sur PLUSIEURS équipes, et changer son périmètre ensuite.
//
// POURQUOI CE TEST (13/09/2026, remarque de Fouka). « Il y a des coachs qui font plusieurs équipes
// ou des dirigeants qui ont plusieurs équipes. » La base le savait déjà — `club_members.teams` est
// un tableau, et `is_team_educateur` y cherche le nom de l'équipe — mais les écrans ne proposaient
// qu'une seule case, au moment de l'invitation, et plus jamais ensuite. Élargir le périmètre d'un
// coach en cours de saison demandait du SQL.
//
// Ce n'est pas un détail d'ergonomie : cocher une équipe DONNE des droits sur elle. Le test mesure
// donc les deux bouts — ce que l'écran envoie, et ce que la personne peut réellement voir après.
//
// CE QU'ON MESURE, sur le club de test de Fouka :
//   1. L'écran « Coachs & dirigeants » propose toutes les équipes du club, et en accepte plusieurs.
//   2. L'invitation préparée porte bien les deux équipes (pas seulement la dernière cochée).
//   3. Le bouton « Équipes » d'un membre déjà en place ouvre son périmètre et l'enregistre.
//   4. Le périmètre enregistré ouvre vraiment les droits (is_team_educateur en base, sous
//      l'identité du membre, pas en service_role).
//
// PROPRETÉ. Adresses en .invalid, tout supprimé à la fin, suppression vérifiée.
//
//   node livrables/SportVision-TV/tests/clubplus-encadrant-multi-equipes.test.mjs

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { rapporteur, SB, ANON, enTeteAdmin } from "./_session-os.mjs";
import { ouvrirClubPlus, vraiesErreursCP, ouvrirLeClub, allerA } from "./_session-clubplus.mjs";

const CLUB = "Villeneuve 340 SC";
const T0 = Date.now();
const { t, bilan } = rapporteur();
const mailInvite = `zz-multi-coach-${T0}@example.invalid`;

const api = (c, o = {}) => fetch(`${SB}/rest/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(o.headers || {}) } });
const lire = async (c) => (await api(c)).json();

async function fermerAssistant(page) {
  const assistant = page.locator("div.fixed").filter({ hasText: "ONBOARDING FULL COMMUNICATION" }).first();
  if (await assistant.count()) {
    const plusTard = assistant.locator("button", { hasText: "Terminer plus tard" }).first();
    if (await plusTard.count()) { await plusTard.click({ force: true }); await page.waitForTimeout(2500); }
  }
}

async function main() {
  const navigateur = await chromium.launch();
  let membreId = null, compteId = null, invitId = null, compteCoach = null;
  let clubId = null, equipes = [];

  try {
    const clubs = await lire(`clubs?select=id,nom&nom=ilike.*Villeneuve 340*&limit=1`);
    clubId = clubs?.[0]?.id;
    if (!clubId) { t("décor : club de test trouvé", false); return; }
    equipes = await lire(`club_teams?select=id,name&club_id=eq.${clubId}&order=name&limit=4`);
    t("décor : le club a au moins deux équipes", equipes.length >= 2, `${equipes.length} équipe(s)`);
    if (equipes.length < 2) return;

    // Qui administre ce club ? On emprunte son identité pour manipuler l'écran.
    const admins = await lire(`club_members?select=user_id,role&club_id=eq.${clubId}&role=in.(admin,president)&status=eq.actif&limit=1`);
    const adminId = admins?.[0]?.user_id;
    if (!adminId) { t("décor : un administrateur du club existe", false); return; }
    const compteAdmin = await (await fetch(`${SB}/auth/v1/admin/users/${adminId}`, { headers: enTeteAdmin })).json();
    t("décor : administrateur du club identifié", !!compteAdmin.email, compteAdmin.email || "");

    const { page, erreurs } = await ouvrirClubPlus(navigateur, compteAdmin.email, { chemin: "/clubplus" });
    // L'administrateur d'un seul club arrive directement sur son tableau de bord : il n'y a pas de
    // liste à cliquer, mais l'assistant « ONBOARDING FULL COMMUNICATION » s'ouvre par-dessus et
    // intercepte TOUS les clics. Il faut l'écarter avant de toucher au menu — sinon un test conclut
    // que la navigation est cassée alors que c'est une surcouche volontaire.
    await fermerAssistant(page);

    // ── 1. L'écran propose plusieurs équipes ────────────────────────────────
    console.log("\n1. Inviter un encadrant sur deux équipes");
    await allerA(page, "Coachs & dirigeants", 4000);
    const boutonInviter = page.locator("button", { hasText: /Inviter/ }).first();
    t("l'écran « Coachs & dirigeants » propose d'inviter", await boutonInviter.count() > 0);
    await boutonInviter.click();
    await page.waitForTimeout(1500);

    await page.locator("input[type=email]").first().fill(mailInvite);
    const champs = page.locator("input").filter({ hasNot: page.locator("[type=email]") });
    // Prénom et nom : les deux premiers champs texte de la fenêtre.
    const textes = page.locator("input[type=text]");
    if (await textes.count() >= 2) {
      await textes.nth(0).fill("ZZ");
      await textes.nth(1).fill("MultiCoach");
    }

    const selecteur = page.locator("button", { hasText: /Aucune équipe|équipe/ }).filter({ hasNotText: "Inviter" }).last();
    t("le sélecteur d'équipes est présent", await selecteur.count() > 0);
    await selecteur.click();
    await page.waitForTimeout(800);

    for (const eq of equipes.slice(0, 2)) {
      const ligne = page.locator("button", { hasText: new RegExp(`^${eq.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first();
      if (await ligne.count()) { await ligne.click(); await page.waitForTimeout(300); }
    }
    // Le panneau ouvert recouvre le bouton principal : on le referme par sa propre sortie, celle
    // qu'un utilisateur a sous les yeux.
    const termine = page.locator("button", { hasText: /^Terminé$/ }).first();
    if (await termine.count()) await termine.click();
    await page.waitForTimeout(500);
    const texteEcran = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    const deuxCochees = equipes.slice(0, 2).every((e) => texteEcran.includes(e.name));
    t("les deux équipes sont retenues à l'écran", deuxCochees, texteEcran.slice(0, 200));

    await page.locator("button", { hasText: /Créer l'invitation/ }).first().click();
    await page.waitForTimeout(4000);

    // ── 2. L'invitation porte les deux équipes ──────────────────────────────
    const invits = await lire(`club_invitations?select=id,email,teams,role&email=eq.${mailInvite}`);
    invitId = invits?.[0]?.id ?? null;
    const portees = invits?.[0]?.teams ?? [];
    t("l'invitation est créée", !!invitId, JSON.stringify(invits).slice(0, 160));
    t(
      "elle porte les DEUX équipes, pas seulement la dernière cochée",
      Array.isArray(portees) && equipes.slice(0, 2).every((e) => portees.includes(e.name)),
      JSON.stringify(portees),
    );
    // 21/09/2026, decision de Fouka : l'e-mail part DES LA CREATION, sans second clic. Un invite
    // a attendu six heures un message qu'on croyait parti ; a l'echelle d'une categorie entiere,
    // on prepare trente invitations en croyant avoir invite trente personnes.
    const envoi = await lire(`notification_outbox?select=status,template_key&recipient_email=eq.${mailInvite}`);
    t("l'e-mail part sans second clic", (envoi || []).length === 1 && envoi[0].template_key === "clubplus.invitation",
      JSON.stringify(envoi).slice(0, 140));
    // Adresse en .invalid : le relais ne l'envoie pas pour de vrai, il la marque SUPPRESSED. Les
    // deux etats prouvent la meme chose — la demande d'envoi a bien ete faite a la creation.
    t("l'invitation ne reste pas « preparee »", ["SENT", "SUPPRESSED", "PENDING"].includes(envoi?.[0]?.status),
      envoi?.[0]?.status || "(aucun envoi)");
    t("aucune erreur JavaScript", vraiesErreursCP(erreurs).length === 0, vraiesErreursCP(erreurs)[0] || "");

    // ── 3. Changer le périmètre d'un membre déjà en place ───────────────────
    console.log("\n2. Changer le périmètre d'un membre déjà en place");
    // On fabrique un membre actif, pour ne pas dépendre de l'acceptation d'une invitation.
    const cr = await (await fetch(`${SB}/auth/v1/admin/users`, {
      method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: `zz-multi-membre-${T0}@example.invalid`, password: `ZzMulti!${T0}`, email_confirm: true }),
    })).json();
    compteId = cr.id;
    const m = await (await api("club_members", {
      method: "POST",
      body: JSON.stringify({ club_id: clubId, user_id: compteId, role: "coach", status: "actif", prenom: "ZZ", nom: "MultiMembre", teams: [equipes[0].name] }),
    })).json();
    membreId = m?.[0]?.id ?? null;
    t("décor : un coach avec UNE équipe", !!membreId, JSON.stringify(m).slice(0, 160));

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    await fermerAssistant(page);
    const ligneMembre = page.locator("div").filter({ hasText: "ZZ MultiMembre" }).last();
    const boutonEquipes = ligneMembre.locator("button", { hasText: /^Équipes$/ }).first();
    t("le bouton « Équipes » est proposé sur la ligne du membre", await boutonEquipes.count() > 0);
    if (await boutonEquipes.count()) {
      await boutonEquipes.click();
      await page.waitForTimeout(1200);
      const sel = page.locator("button", { hasText: new RegExp(equipes[0].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first();
      await sel.click();
      await page.waitForTimeout(600);
      const ajout = page.locator("button", { hasText: new RegExp(`^${equipes[1].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first();
      if (await ajout.count()) { await ajout.click(); await page.waitForTimeout(400); }
      const fin = page.locator("button", { hasText: /^Terminé$/ }).first();
      if (await fin.count()) { await fin.click(); await page.waitForTimeout(400); }
      await page.locator("button", { hasText: /^Enregistrer$/ }).first().click();
      await page.waitForTimeout(3500);

      const apres = await lire(`club_members?select=teams&id=eq.${membreId}`);
      const t2 = apres?.[0]?.teams ?? [];
      t("le périmètre enregistré contient les deux équipes", Array.isArray(t2) && t2.length >= 2, JSON.stringify(t2));

      // ── 4. Le périmètre ouvre vraiment les droits ────────────────────────
      const lien = (await (await fetch(`${SB}/auth/v1/admin/generate_link`, {
        method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "magiclink", email: `zz-multi-membre-${T0}@example.invalid`, redirect_to: "https://clubplus.sportvision-an.fr/clubplus" }),
      })).json()).action_link;
      const loc = (await fetch(lien, { redirect: "manual" })).headers.get("location") || "";
      const jeton = new URLSearchParams(loc.split("#")[1] || "").get("access_token");
      const droit = async (teamId) => {
        const r = await fetch(`${SB}/rest/v1/rpc/is_team_educateur`, {
          method: "POST",
          headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_team_id: teamId }),
        });
        return await r.json();
      };
      t("il a les droits sur la première équipe", (await droit(equipes[0].id)) === true);
      t("il a les droits sur la SECONDE, celle qu'on vient d'ajouter", (await droit(equipes[1].id)) === true);
      if (equipes[2]) t("et aucun droit sur une équipe non cochée", (await droit(equipes[2].id)) === false);
    }
    // ── 5. Le coach ouvre SON lien et retrouve SES deux équipes ─────────────
    // « Les relations se font bien » (Fouka) : jusqu'ici on vérifiait ce que l'écran envoie et ce
    // que la base accorde. Reste le plus important pour la personne : ce qu'elle voit en arrivant.
    console.log("\n3. Le coach ouvre son lien d'invitation");
    const inv = await lire(`club_invitations?select=token&id=eq.${invitId}`);
    const jeton = inv?.[0]?.token;
    t("l'invitation porte un lien personnel", !!jeton);
    if (jeton) {
      const cpt = await (await fetch(`${SB}/auth/v1/admin/users`, {
        method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
        body: JSON.stringify({ email: mailInvite, password: `ZzCoach!${T0}`, email_confirm: true }),
      })).json();
      compteCoach = cpt.id;
      t("le coach crée son compte avec l'adresse invitée", !!compteCoach, JSON.stringify(cpt).slice(0, 140));

      const ctx2 = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const p2 = await ctx2.newPage();
      const err2 = [];
      p2.on("pageerror", (e) => err2.push(String(e)));
      // Il arrive par le lien, non connecté : c'est le cas réel.
      await p2.goto(`https://clubplus.sportvision-an.fr/clubplus/rejoindre?token=${encodeURIComponent(jeton)}`, { waitUntil: "domcontentloaded" });
      await p2.waitForTimeout(7000);
      const vu = (await p2.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
      t("le lien s'ouvre et nomme le club", vu.includes(CLUB), vu.slice(0, 200));
      t(
        "les deux équipes lui sont annoncées",
        equipes.slice(0, 2).every((e) => vu.includes(e.name)),
        vu.slice(0, 260),
      );
      t("aucune erreur JavaScript sur le lien", err2.length === 0, err2[0] || "");
      await ctx2.close();
    }
  } finally {
    if (compteCoach) {
      await api(`club_members?user_id=eq.${compteCoach}`, { method: "DELETE" });
      await fetch(`${SB}/auth/v1/admin/users/${compteCoach}`, { method: "DELETE", headers: enTeteAdmin });
    }
    if (invitId) await api(`club_invitations?id=eq.${invitId}`, { method: "DELETE" });
    if (membreId) await api(`club_members?id=eq.${membreId}`, { method: "DELETE" });
    if (compteId) await fetch(`${SB}/auth/v1/admin/users/${compteId}`, { method: "DELETE", headers: enTeteAdmin });
    await navigateur.close();
    const resteInv = await lire(`club_invitations?select=id&email=like.zz-multi-%25`);
    const resteMb = await lire(`club_members?select=id&nom=eq.MultiMembre`);
    t(
      "nettoyage : aucune trace laissée",
      (Array.isArray(resteInv) ? resteInv.length : 1) === 0 && (Array.isArray(resteMb) ? resteMb.length : 1) === 0,
      `${JSON.stringify(resteInv).slice(0, 100)} / ${JSON.stringify(resteMb).slice(0, 100)}`,
    );
  }
  process.exit(bilan() === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
