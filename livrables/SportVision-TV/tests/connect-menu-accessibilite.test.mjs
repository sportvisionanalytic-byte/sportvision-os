// Le bouton de menu mobile, dans les deux espaces Connect, en production.
//
// Ce bouton ne contient qu'un avatar : sans libellé, un lecteur d'écran n'annonce rien, et c'est
// pourtant le seul accès au menu complet sur téléphone. On vérifie donc le NOM ACCESSIBLE (ce que
// la synthèse vocale prononcera), l'état annoncé, l'accès au clavier, et l'absence de régression.
//
// COMPTES. Les comptes fixes zz-particulier@ / zz-joueur@ ont disparu (ménage des comptes de test) :
// le 11/09/2026, le test échouait à la connexion sans rien vérifier. Désormais il crée ses deux
// comptes (adresses .invalid, créés par l'API d'administration : aucun e-mail) et les supprime à la
// fin. SV_MAIL_PART / SV_MAIL_JOUEUR (+ SV_MDP) permettent toujours de viser des comptes existants.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, enTeteAdmin } from "./_session-os.mjs";

const BASE = "https://connect.sportvision-an.fr";
const stamp = Date.now();
const MDP = process.env.SV_MDP || `QaMenu!${stamp}`;
const crees = [];
async function compteTemporaire(type) {
  const email = `qa-sv-connect-menu-${type}-${stamp}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: MDP, email_confirm: true, user_metadata: { prenom: "QA", nom: "Menu" } }) })).json();
  if (!u.id) throw new Error("compte de test : " + JSON.stringify(u).slice(0, 120));
  crees.push(u.id);
  await fetch(`${SB}/rest/v1/connect_profile_settings?on_conflict=user_id`, { method: "POST",
    headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: u.id, account_type: type, ...(type === "particulier" ? { profil_particulier: "parent" } : {}) }) });
  return email;
}
const COMPTES = [
  ["particulier", process.env.SV_MAIL_PART || await compteTemporaire("particulier"), /\/particulier/],
  // L'espace joueur partage desormais le meme bouton : on verifie qu'il n'a pas regresse.
  ["joueur", process.env.SV_MAIL_JOUEUR || await compteTemporaire("joueur"), /\/dashboard/],
];

const b = await chromium.launch();
let ko = 0;
const dit = (nom, ok, det = "") => { if (!ko && !ok) {} if (!ok) ko++; console.log((ok ? "OK   " : "KO   ") + nom + (det ? "  (" + det + ")" : "")); };

for (const [espace, mail, url] of COMPTES) {
  // iPhone : c'est le seul contexte où ce bouton est visible.
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
  await p.locator('input[type="email"]').fill(mail);
  await p.locator('input[type="password"]').fill(MDP);
  await p.locator('button[type="submit"]').click();
  await p.waitForURL(url, { timeout: 25000 });
  await p.waitForLoadState("networkidle");

  const bouton = p.locator('button[aria-haspopup="menu"]').first();
  dit(`${espace} : le bouton existe`, (await bouton.count()) > 0);

  // Le NOM ACCESSIBLE, c'est-à-dire ce qu'un lecteur d'écran prononce. C'était vide avant.
  const nomAccessible = await bouton.evaluate((el) => el.getAttribute("aria-label"));
  dit(`${espace} : il a un nom accessible`, Boolean(nomAccessible), nomAccessible ?? "(vide)");
  dit(`${espace} : ce nom dit ce que fait le bouton`, /menu/i.test(nomAccessible ?? ""));

  dit(`${espace} : l'etat ferme est annonce`, (await bouton.getAttribute("aria-expanded")) === "false");

  // Accessible AU CLAVIER : on y arrive par Tab, et Entree l'active.
  let atteint = false;
  for (let i = 0; i < 25 && !atteint; i++) {
    await p.keyboard.press("Tab");
    atteint = await p.evaluate(() => document.activeElement?.getAttribute("aria-haspopup") === "menu");
  }
  dit(`${espace} : atteignable au clavier (Tab)`, atteint);

  await p.keyboard.press("Enter");
  await p.waitForTimeout(600);
  dit(`${espace} : Entree ouvre le menu`, (await bouton.getAttribute("aria-expanded")) === "true");
  dit(`${espace} : et le nom annonce change`, /fermer/i.test((await bouton.getAttribute("aria-label")) ?? ""));
  dit(`${espace} : le menu contient Mes galeries`, (await p.locator('a[href="/galeries"]:visible').count()) > 0);

  // Aucune regression : le bouton n'a pas change d'aspect, et la page reste fonctionnelle.
  const boite = await bouton.boundingBox();
  dit(`${espace} : taille inchangee (40x40)`, boite?.width === 40 && boite?.height === 40,
      boite ? `${boite.width}x${boite.height}` : "introuvable");

  await p.keyboard.press("Escape").catch(() => {});
  await p.locator('a[href="/galeries"]:visible').first().click();
  await p.waitForURL(/\/galeries/, { timeout: 20000 });
  dit(`${espace} : la navigation fonctionne toujours`, p.url().includes("/galeries"));

  await p.goto(`${BASE}${espace === "particulier" ? "/particulier" : "/dashboard"}`, { waitUntil: "networkidle" });
  const corps = await p.locator("body").innerText();
  dit(`${espace} : l'accueil s'affiche sans erreur`, corps.length > 200 && !/Application error|Unhandled/i.test(corps));
  await p.close();
}

await b.close();
for (const id of crees) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: enTeteAdmin });
const restants = (await (await fetch(`${SB}/auth/v1/admin/users?per_page=1000`, { headers: enTeteAdmin })).json())?.users?.filter((u) => u.email?.startsWith(`qa-sv-connect-menu-`) && u.email.includes(String(stamp))).length ?? 0;
dit("nettoyage : comptes de test supprimés", restants === 0, `${restants} restant(s)`);
console.log(ko === 0 ? "\ntout conforme" : `\n${ko} ecart(s)`);
process.exit(ko ? 1 : 0);
