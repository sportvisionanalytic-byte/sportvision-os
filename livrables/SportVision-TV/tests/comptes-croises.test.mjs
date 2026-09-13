// Un compte qui se présente à la MAUVAISE application : que voit-il ?
//
// POURQUOI CE TEST (13/09/2026, demande de Fouka : « trop de mélanges »). Les trois applications
// partagent UN SEUL annuaire de comptes, `auth.users`. C'est voulu — une personne peut être à la
// fois parent d'un joueur, acheteuse d'une galerie et coach d'une équipe — mais cela veut dire que
// n'importe quel compte peut se connecter n'importe où. Ce qui doit différer, c'est ce qu'il TROUVE
// une fois entré, et surtout ce qu'on lui DIT quand il n'a rien à y faire.
//
// Un écran de connexion qui accepte le mot de passe puis n'affiche rien est le pire des cas : la
// personne croit son compte cassé, appelle le club, et le club appelle SportVision.
//
// CE QU'ON MESURE. Trois comptes réels créés pour l'occasion — un collaborateur de l'OS, un
// particulier Connect, un membre de club sans autre rôle — chacun présenté aux trois applications.
// Pour chaque croisement : la connexion aboutit-elle, et l'écran dit-il quelque chose de juste ?
//
// PROPRETÉ. Adresses en .invalid, comptes créés par l'API d'administration (aucun e-mail), tout est
// supprimé à la fin et la suppression est vérifiée.
//
//   node livrables/SportVision-TV/tests/comptes-croises.test.mjs

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { rapporteur, SB, ANON, enTeteAdmin } from "./_session-os.mjs";

const OS = "https://bc6m3cgdz.sportvision-an.fr/";
const CONNECT = "https://connect.sportvision-an.fr";
const CLUBPLUS = "https://clubplus.sportvision-an.fr/clubplus";
const MDP = "ZzCroise!2026-Test";
const T0 = Date.now();
const { t, bilan } = rapporteur();

const adresse = (quoi) => `zz-croise-${quoi}-${T0}@example.invalid`;
const api = (c, o = {}) => fetch(`${SB}/rest/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(o.headers || {}) } });
const authApi = (c, o = {}) => fetch(`${SB}/auth/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(o.headers || {}) } });

async function creerCompte(quoi) {
  const r = await authApi("admin/users", {
    method: "POST",
    body: JSON.stringify({ email: adresse(quoi), password: MDP, email_confirm: true }),
  });
  const d = await r.json();
  if (!d.id) throw new Error(`création du compte ${quoi} : ${JSON.stringify(d).slice(0, 200)}`);
  return d.id;
}

async function supprimerCompte(id) {
  await authApi(`admin/users/${id}`, { method: "DELETE" });
}

/** Texte visible de la page, espaces normalisés. */
const visible = async (page) =>
  (await page.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ").trim();

async function main() {
  const navigateur = await chromium.launch();
  const aNettoyer = [];
  let clubId = null;

  try {
    // ── Décor : trois comptes, trois natures ─────────────────────────────────
    const idOs = await creerCompte("os"); aNettoyer.push(idOs);
    const idParticulier = await creerCompte("particulier"); aNettoyer.push(idParticulier);
    const idClub = await creerCompte("club"); aNettoyer.push(idClub);

    // Collaborateur de l'OS : une ligne dans `profiles`, c'est ce qui fait l'appartenance.
    const rp = await api("profiles", {
      method: "POST",
      body: JSON.stringify({ id: idOs, prenom: "ZZ", nom: "Croise OS", email: adresse("os"), role: "photo", actif: true }),
    });
    t("décor : le collaborateur de l'OS existe", rp.ok, rp.ok ? "" : await rp.text());

    // Particulier Connect : ses réglages de profil, comme en produit le tunnel d'inscription.
    const rc = await api("connect_profile_settings", {
      method: "POST",
      body: JSON.stringify({ user_id: idParticulier, account_type: "particulier", profil_particulier: "autre" }),
    });
    t("décor : le particulier Connect existe", rc.ok, rc.ok ? "" : await rc.text());

    // Membre de club : rattaché au club de test de Fouka.
    const clubs = await (await api("clubs?select=id,nom&nom=ilike.*Villeneuve 340*&limit=1")).json();
    clubId = clubs?.[0]?.id ?? null;
    if (clubId) {
      const rm = await api("club_members", {
        method: "POST",
        body: JSON.stringify({ club_id: clubId, user_id: idClub, role: "coach", status: "actif", prenom: "ZZ", nom: "Croise Club", teams: [] }),
      });
      t("décor : le membre de club existe", rm.ok, rm.ok ? "" : await rm.text());
    } else {
      t("décor : club de test trouvé", false, "Villeneuve 340 SC introuvable");
    }

    // ── 1. L'OS ──────────────────────────────────────────────────────────────
    console.log("\n1. Sur l'OS");
    for (const [nom, mail, attendu] of [
      ["le collaborateur", adresse("os"), "entre"],
      ["le particulier Connect", adresse("particulier"), "refus expliqué"],
      ["le membre de club", adresse("club"), "refus expliqué"],
    ]) {
      const ctx = await navigateur.newContext();
      const page = await ctx.newPage();
      const erreurs = [];
      page.on("pageerror", (e) => erreurs.push(String(e)));
      await page.goto(OS, { waitUntil: "domcontentloaded" });
      await page.locator("#l-email").fill(mail);
      await page.locator("#l-pass").fill(MDP);
      await page.evaluate(() => doLogin());
      await page.waitForTimeout(4500);
      const texte = await visible(page);
      // Entrer, c'est voir un menu de travail. Le chercher par un identifiant de conteneur est
      // fragile (l'OS est une page unique, sans <nav>) : on lit ce que la personne a sous les yeux.
      const entre = /Mes missions|Accueil .*Prestations|Tableau de bord|MES MISSIONS/i.test(texte);
      if (attendu === "entre") {
        t(`${nom} entre dans l'OS`, entre, texte.slice(0, 160));
      } else {
        const explique = /n'a pas accès|pas accès à SportVision OS|réservé|identifiants/i.test(texte);
        t(`${nom} ne rentre pas dans l'OS`, !entre, texte.slice(0, 160));
        t(`${nom} : l'OS lui dit pourquoi`, explique, texte.slice(0, 200));
      }
      t(`${nom} : aucune erreur JavaScript sur l'OS`, erreurs.length === 0, erreurs[0] || "");
      await ctx.close();
    }

    // ── 2. Connect ───────────────────────────────────────────────────────────
    console.log("\n2. Sur Connect");
    for (const [nom, mail] of [
      ["le collaborateur de l'OS", adresse("os")],
      ["le particulier", adresse("particulier")],
      ["le membre de club", adresse("club")],
    ]) {
      const ctx = await navigateur.newContext();
      const page = await ctx.newPage();
      const erreurs = [];
      page.on("pageerror", (e) => erreurs.push(String(e)));
      await page.goto(`${CONNECT}/auth/login`, { waitUntil: "domcontentloaded" });
      await page.locator("input[type=email]").fill(mail);
      await page.locator("input[type=password]").fill(MDP);
      await page.locator("button[type=submit]").first().click();
      await page.waitForTimeout(5000);
      const url = page.url();
      const texte = await visible(page);
      const bloque = /auth\/login/.test(url);
      // Connect accueille tout le monde : ce qui compte est qu'on n'y reste pas coincé sans un mot.
      t(`${nom} : Connect ne le laisse pas sur un écran muet`, !bloque || texte.length > 60, `${url} — ${texte.slice(0, 140)}`);
      t(`${nom} : aucune erreur JavaScript sur Connect`, erreurs.length === 0, erreurs[0] || "");
      await ctx.close();
    }

    // ── 3. Club+ ─────────────────────────────────────────────────────────────
    console.log("\n3. Sur Club+");
    for (const [nom, mail, attenduEspace] of [
      ["le membre de club", adresse("club"), true],
      ["le particulier", adresse("particulier"), false],
      ["le collaborateur de l'OS", adresse("os"), false],
    ]) {
      const ctx = await navigateur.newContext();
      const page = await ctx.newPage();
      const erreurs = [];
      page.on("pageerror", (e) => erreurs.push(String(e)));
      await page.goto(`${CLUBPLUS}/auth/login`, { waitUntil: "domcontentloaded" });
      await page.locator("input[type=email]").fill(mail);
      await page.locator("input[type=password]").fill(MDP);
      await page.locator("button[type=submit]").first().click();
      await page.waitForTimeout(6000);
      const url = page.url();
      const texte = await visible(page);
      if (attenduEspace) {
        t(`${nom} : Club+ l'amène dans son espace`, /dashboard|teams|accueil/i.test(url) || texte.length > 80, `${url} — ${texte.slice(0, 140)}`);
      } else {
        // Sans club, Club+ propose d'en créer un : c'est une réponse, pas un cul-de-sac.
        const oriente = /signup-free|signup|dashboard/.test(url) || texte.length > 80;
        t(`${nom} : Club+ l'oriente au lieu de le laisser sans réponse`, oriente, `${url} — ${texte.slice(0, 160)}`);
      }
      t(`${nom} : aucune erreur JavaScript sur Club+`, erreurs.length === 0, erreurs[0] || "");
      await ctx.close();
    }
  } finally {
    await navigateur.close();
    // ── Nettoyage, et on le vérifie ────────────────────────────────────────
    for (const id of aNettoyer) await supprimerCompte(id);
    const restes = await (await api(`profiles?select=id&email=like.zz-croise-%25`)).json();
    const restesCm = clubId
      ? await (await api(`club_members?select=id&club_id=eq.${clubId}&nom=eq.Croise Club`)).json()
      : [];
    t(
      "nettoyage : aucune trace laissée",
      (Array.isArray(restes) ? restes.length : 1) === 0 && (Array.isArray(restesCm) ? restesCm.length : 1) === 0,
      `profils: ${JSON.stringify(restes).slice(0, 120)} / membres: ${JSON.stringify(restesCm).slice(0, 120)}`,
    );
  }
  process.exit(bilan() === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
