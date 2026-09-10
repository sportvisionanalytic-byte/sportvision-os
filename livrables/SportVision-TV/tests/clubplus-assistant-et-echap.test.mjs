// L'assistant d'onboarding ne s'impose qu'a qui s'en sert, et Echap ferme les fenetres.
//
// DECISION DE FOUKA, 10/09/2026 : l'assistant « Onboarding Full Communication » est un outil du CM
// SportVision et de l'administration. Il ne doit plus s'ouvrir tout seul pour un president ni pour
// un coach — le premier doit trouver un Club+ deja prepare, le second ses equipes. Et Echap doit
// fermer l'assistant et les modales principales.
//
// Le test prend les deux cotes, parce qu'un correctif qui masque trop est aussi faux qu'un qui ne
// masque pas assez :
//   • le CM, lui, doit TOUJOURS voir son assistant — sinon on a supprime l'outil au lieu de le
//     reserver ;
//   • le president et le coach ne doivent JAMAIS le voir.
//
// Les comptes president et coach sont de vraies personnes invitees par le vrai lien, crees sur le
// club de test de Fouka (Villeneuve 340 SC) et supprimes a la fin — suppression verifiee.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { CP, ouvrirClubPlus, ouvrirLeClub, allerA, vraiesErreursCP } from "./_session-clubplus.mjs";
import { rapporteur, SB, ANON, enTeteAdmin, jeton } from "./_session-os.mjs";

const CLUB = "Villeneuve 340 SC";
const CM = "chris2brazza@gmail.com";
const { t, bilan } = rapporteur();

const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });
const authApi = (chemin, opts = {}) =>
  fetch(`${SB}/auth/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });

// Drapeau `i` INDISPENSABLE. Le titre s'affiche en capitales, mais par CSS (text-transform) : le
// texte reel du DOM est « Onboarding Full Communication ». Or Playwright compare `hasText` au texte
// du DOM, et une RegExp est sensible a la casse. Sans `i`, cette expression ne correspondait a RIEN
// — et les controles « l'assistant ne s'ouvre PAS pour le president / le coach » passaient au vert
// sans avoir rien mesure, puisque « introuvable » etait garanti d'avance. Mesure du 10/09/2026.
// (Une chaine simple, elle, est comparee sans tenir compte de la casse : c'est pourquoi le meme
// titre ecrit en capitales fonctionnait dans _session-clubplus.mjs.)
const TITRE_ASSISTANT = /onboarding full communication|onboarding club\+|bienvenue sur club\+/i;
const assistantOuvert = async (page) =>
  (await page.locator("div.fixed").filter({ hasText: TITRE_ASSISTANT }).count()) > 0;

const navigateur = await chromium.launch();
const aNettoyer = [];

try {
  // ══ 1. LE CM GARDE SON OUTIL ════════════════════════════════════════════
  {
    const { page } = await ouvrirClubPlus(navigateur, CM);
    const carte = page.locator(`text=${CLUB}`).first();
    if (await carte.count()) await carte.click();

    // On ATTEND l'assistant plutot que de dormir un temps fixe. La premiere version attendait
    // 8 secondes, l'assistant se montait vers 9 : il n'etait pas encore la, et le test concluait
    // « deja termine sur ce compte, controle non applicable » — un contrôle qui s'efface tout seul
    // et passe au vert sans rien avoir mesure. Un navigateur neuf n'a aucune progression
    // enregistree : l'assistant DOIT s'ouvrir pour le CM, et c'est une vraie assertion.
    const present = await page.locator("div.fixed").filter({ hasText: TITRE_ASSISTANT }).first()
      .waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
    t("le CM SportVision voit toujours son assistant", present,
      "absent apres 20 s — l'outil a peut-etre ete retire au CM en meme temps qu'aux autres");

    if (present) {
      // Echap le repousse, sans le marquer termine.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1500);
      t("Echap ferme l'assistant", !(await assistantOuvert(page)), "la fenetre est toujours la apres Echap");
    }
    await page.context().close();
  }

  // ══ 2. PRESIDENT ET COACH, PAR LE VRAI LIEN ═════════════════════════════
  const club = (await (await api(`clubs?select=id&nom=eq.${encodeURIComponent(CLUB)}`)).json())[0];
  const invitant = (await (await api(`club_members?select=user_id&club_id=eq.${club.id}&role=eq.admin&status=eq.actif&limit=1`)).json())[0];
  const emailInvitant = (await (await authApi(`admin/users/${invitant.user_id}`)).json()).email;
  const jetonInvitant = await jeton(emailInvitant);

  for (const role of ["president", "coach"]) {
    const email = `zz-${role}-assistant-${Date.now()}@example.invalid`;
    const mdp = "ZzAssistant!2026-Test";
    aNettoyer.push(email);

    await fetch(`${SB}/rest/v1/rpc/preparer_invitation_club`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${jetonInvitant.acces}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_club_id: club.id, p_email: email, p_role: role, p_prenom: "ZZ", p_nom: role, p_telephone: null, p_teams: [] }),
    });
    const invit = (await (await api(`club_invitations?select=token&email=eq.${encodeURIComponent(email)}`)).json())[0];
    if (!invit?.token) { t(`l'invitation ${role} se prepare`, false); continue; }

    const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 200)));

    // creation du compte par le vrai formulaire
    await page.goto(`${CP}/clubplus/rejoindre?token=${invit.token}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    await page.locator("button", { hasText: "Créer mon accès" }).first().click();
    await page.waitForTimeout(2000);
    await page.locator("input[type=email]").first().fill(email);
    await page.locator("input[type=password]").first().fill(mdp);
    await page.locator("button", { hasText: /Créer mon espace/i }).first().click();
    await page.waitForTimeout(10000);

    const compte = (await (await authApi(`admin/users?filter=${encodeURIComponent(email)}`)).json())?.users?.[0];
    if (compte?.id) await authApi(`admin/users/${compte.id}`, { method: "PUT", body: JSON.stringify({ email_confirm: true }) });

    // entree dans l'espace
    await page.goto(`${CP}/clubplus/rejoindre?token=${invit.token}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    await page.locator("button", { hasText: "J'ai déjà un compte" }).first().click();
    await page.waitForTimeout(2000);
    await page.locator("input[type=email]").first().fill(email);
    await page.locator("input[type=password]").first().fill(mdp);
    await page.locator("button", { hasText: /Se connecter et rejoindre/i }).first().click();
    await page.waitForTimeout(13000);

    t(`le ${role} entre dans son espace`, !/rejoindre/.test(page.url()), page.url().replace(CP, ""));
    // L'absence ne prouve quelque chose que si l'on a attendu au-dela du moment ou l'assistant
    // serait apparu (environ 9 s pour le CM). On lui laisse 20 s pour se montrer.
    const apparu = await page.locator("div.fixed").filter({ hasText: TITRE_ASSISTANT }).first()
      .waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
    t(`l'assistant ne s'ouvre PAS pour un ${role}`, !apparu,
      "l'assistant interne s'est ouvert en plein ecran");

    // Rechargement : l'assistant ne doit pas revenir par la banniere de reprise non plus.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    const texte = (await page.evaluate(() => document.body.innerText)) || "";
    t(`ni en modale ni en banniere apres rechargement (${role})`,
      !(await assistantOuvert(page)) && !/Onboarding en cours|Reprendre l'onboarding/i.test(texte),
      texte.slice(0, 160));

    // Echap sur une modale ordinaire : le president peut ouvrir « Ajouter un evenement ».
    if (role === "president") {
      await allerA(page, "Planning éditorial").catch(() => {});
      await page.goto(`${CP}/clubplus/calendar`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
      const ajouter = page.locator("button", { hasText: /Ajouter un [ée]v[ée]nement/i }).first();
      if (await ajouter.count()) {
        await ajouter.click();
        await page.waitForTimeout(2500);
        const avant = await page.locator("div.fixed").filter({ hasText: /[ée]v[ée]nement/i }).count();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(1500);
        const apres = await page.locator("div.fixed").filter({ hasText: /Ajouter un [ée]v[ée]nement|Nouvel [ée]v[ée]nement/i }).count();
        t("Echap ferme la fenetre « Ajouter un evenement »", avant > 0 && apres === 0,
          `fenetres avant : ${avant}, apres Echap : ${apres}`);
      } else {
        console.log("       (bouton « Ajouter un evenement » absent pour ce role : controle Echap non applicable)");
      }
    }

    t(`aucune erreur JavaScript (${role})`, vraiesErreursCP(erreurs).length === 0,
      vraiesErreursCP(erreurs).slice(0, 3).join("\n       "));
    await ctx.close();
  }
} finally {
  await navigateur.close();

  // ── Nettoyage, verifie ─────────────────────────────────────────────────
  let restes = 0;
  for (const email of aNettoyer) {
    const compte = (await (await authApi(`admin/users?filter=${encodeURIComponent(email)}`)).json())?.users?.[0];
    if (compte?.id) {
      await api(`club_members?user_id=eq.${compte.id}`, { method: "DELETE" });
      await authApi(`admin/users/${compte.id}`, { method: "DELETE" });
    }
    await api(`club_invitations?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
    const r = await (await api(`club_invitations?select=id&email=eq.${encodeURIComponent(email)}`)).json();
    restes += r?.length ?? 0;
  }
  const comptes = (await (await authApi(`admin/users?filter=zz-`)).json())?.users?.filter((u) => /assistant/.test(u.email)) ?? [];
  t("aucun compte ni invitation de test ne subsiste", restes === 0 && comptes.length === 0,
    `${restes} invitation(s), ${comptes.length} compte(s) — A NETTOYER A LA MAIN`);
}

process.exit(bilan() ? 1 : 0);
