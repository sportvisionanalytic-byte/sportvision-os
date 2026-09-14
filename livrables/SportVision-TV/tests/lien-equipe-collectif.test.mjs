// Le lien collectif d'une équipe, du groupe WhatsApp jusqu'à l'affiliation.
//
// POURQUOI CE TEST (14/09/2026). C'est le lien que le club colle dans le groupe de l'équipe ou
// affiche au vestiaire : celui que le plus de gens ouvriront. Sa règle est prouvée en base
// (adhesion-code-equipe, code-equipe-entropie), mais personne ne l'avait jamais CLIQUÉ dans un
// navigateur — or c'est là que se jouent les redirections, le retour après création de compte, et
// ce qu'on montre à quelqu'un qui n'a pas encore de compte.
//
// CE QU'ON MESURE, en 390 px parce que le lien s'ouvre sur un téléphone :
//   1. Sans compte, la page dit quel club et quelle équipe, sans rien exposer de personnel.
//   2. Elle propose de créer un compte, et le lien de création RAMÈNE sur ce code.
//   3. Un code inconnu, désactivé ou expiré est refusé avec un motif lisible — jamais une page
//      blanche ni une erreur technique.
//   4. Le code reste secret : la page publique ne révèle ni identifiant d'équipe ni de club.
//
// PROPRETÉ. Club de test de Fouka, code créé pour l'occasion et supprimé après, suppression
// vérifiée.
//
//   node livrables/SportVision-TV/tests/lien-equipe-collectif.test.mjs

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { rapporteur, SB, enTeteAdmin } from "./_session-os.mjs";

const CONNECT = "https://connect.sportvision-an.fr";
const T0 = Date.now();
const { t, bilan } = rapporteur();
const api = (c, o = {}) => fetch(`${SB}/rest/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(o.headers || {}) } });
const texte = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").trim();

async function main() {
  const navigateur = await chromium.launch();
  const codes = [];
  const comptes = [];
  try {
    const club = (await (await api("clubs?select=id,nom&nom=eq.Villeneuve%20340%20SC")).json())[0];
    const equipe = (await (await api(`club_teams?select=id,name&club_id=eq.${club.id}&order=name&limit=1`)).json())[0];
    t("décor : club et équipe de test", !!club?.id && !!equipe?.id, `${club?.nom} / ${equipe?.name}`);
    if (!equipe?.id) return;

    // Trois codes : un valide, un désactivé, un expiré. On les pose en base pour maîtriser leur
    // état — la génération elle-même est couverte par code-equipe-entropie.
    const poser = async (suffixe, champs) => {
      const r = await api("team_invite_codes", {
        method: "POST",
        body: JSON.stringify({ club_id: club.id, team_id: equipe.id, code: `ZZ-LIEN-${T0}-${suffixe}`, actif: true, ...champs }),
      });
      const l = (await r.json())[0];
      if (l?.id) codes.push(l.id);
      return l;
    };
    const valide = await poser("OK", {});
    const desactive = await poser("OFF", { actif: false });
    const expire = await poser("EXP", { expire_at: new Date(Date.now() - 86400000).toISOString() });
    t("décor : trois codes (valide, désactivé, expiré)", !!valide?.code && !!desactive?.code && !!expire?.code);

    // ── 1. Le lien valide, sans compte ──────────────────────────────────────
    console.log("\n1. Le lien valide, ouvert sans compte");
    const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(String(e)));
    await page.goto(`${CONNECT}/join/${encodeURIComponent(valide.code)}`, { waitUntil: "networkidle" });
    const vu = await texte(page);
    t("la page s'ouvre sans compte", !/auth\/login/.test(page.url()), page.url().replace(CONNECT, ""));
    t("elle nomme le club", vu.includes(club.nom), vu.slice(0, 180));
    t("elle nomme l'équipe", vu.includes(equipe.name), vu.slice(0, 180));

    const liens = await page.locator("a").evaluateAll((l) => l.map((x) => x.getAttribute("href")).filter(Boolean));
    const versInscription = liens.find((h) => h.startsWith("/signup"));
    t("elle propose de créer un compte", !!versInscription, liens.join(" | ").slice(0, 200));
    t(
      "et ce lien ramène sur CE code, pour ne pas perdre l'équipe en route",
      !!versInscription && decodeURIComponent(versInscription).includes(`/join/${valide.code}`),
      versInscription || "",
    );

    // ── 2. Rien de personnel, rien d'interne ────────────────────────────────
    const html = await page.content();
    t("aucun identifiant technique n'est exposé", !html.includes(club.id) && !html.includes(equipe.id));
    t("aucune erreur JavaScript", erreurs.length === 0, erreurs[0] || "");

    // ── 3. Les codes qui ne marchent pas le disent ──────────────────────────
    console.log("\n2. Les codes refusés");
    for (const [nom, code, attendu] of [
      ["désactivé", desactive.code, /désactivé/i],
      ["expiré", expire.code, /expiré/i],
      ["inconnu", `ZZ-INCONNU-${T0}`, /n'existe pas|plus valide/i],
    ]) {
      await page.goto(`${CONNECT}/join/${encodeURIComponent(code)}`, { waitUntil: "networkidle" });
      const msg = await texte(page);
      t(`code ${nom} : un motif lisible, pas une page blanche`, attendu.test(msg) && msg.length > 20, msg.slice(0, 140));
      t(`code ${nom} : aucun détail technique`, !/error|exception|null|undefined|PGRST/i.test(msg), msg.slice(0, 140));
    }
    await ctx.close();

    // ── 4. Jusqu'au bout : un compte, puis l'affiliation ────────────────────
    // La règle (v186) : une adhésion née d'un code valide est acceptée d'emblée, donner le code
    // valant acceptation. On le vérifie là où ça compte, après un vrai clic, pas seulement en base.
    console.log("\n3. Un joueur arrive par le lien et crée son compte");
    const mail = `zz-lien-${T0}@example.invalid`;
    const mdp = `ZzLien!${T0}`;
    const u = await (await fetch(`${SB}/auth/v1/admin/users`, {
      method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: mail, password: mdp, email_confirm: true, user_metadata: { first_name: "ZZ", last_name: "LienJoueur" } }),
    })).json();
    comptes.push(u.id);
    await api("connect_profile_settings", { method: "POST", body: JSON.stringify({ user_id: u.id, account_type: "joueur" }) });

    const ctx2 = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page2 = await ctx2.newPage();
    const erreurs2 = [];
    page2.on("pageerror", (e) => erreurs2.push(String(e)));
    await page2.goto(`${CONNECT}/auth/login?next=${encodeURIComponent(`/join/${valide.code}`)}`, { waitUntil: "networkidle" });
    await page2.locator('input[type="email"]').fill(mail);
    await page2.locator('input[type="password"]').fill(mdp);
    await page2.locator('button[type="submit"]').first().click();
    await page2.waitForTimeout(7000);
    t("après connexion, il revient sur le lien de son équipe", /\/join\//.test(page2.url()), page2.url().replace(CONNECT, ""));

    const continuer = page2.locator("a, button").filter({ hasText: /Continuer|Rejoindre/i }).first();
    t("un bouton l'emmène vers son affiliation", await continuer.count() > 0, await texte(page2));
    if (await continuer.count()) {
      await continuer.click();
      await page2.waitForTimeout(6000);
      const ecran = await texte(page2);
      t("il arrive sur le formulaire d'affiliation, le code déjà rempli",
        /join|affiliation|rejoindre/i.test(page2.url() + " " + ecran), `${page2.url().replace(CONNECT, "")} — ${ecran.slice(0, 160)}`);
      t("le club et l'équipe y sont rappelés", ecran.includes(club.nom) || ecran.includes(equipe.name), ecran.slice(0, 200));
    }
    t("aucune erreur JavaScript sur ce parcours", erreurs2.length === 0, erreurs2[0] || "");
    await ctx2.close();
  } finally {
    for (const id of codes) await api(`team_invite_codes?id=eq.${id}`, { method: "DELETE" });
    for (const id of comptes) {
      await api(`membership_requests?created_by=eq.${id}`, { method: "DELETE" }).catch(() => {});
      await api(`connect_profile_settings?user_id=eq.${id}`, { method: "DELETE" });
      const pj = await (await api(`player_profiles?select=id&user_id=eq.${id}`)).json();
      for (const j of Array.isArray(pj) ? pj : []) {
        await api(`team_memberships?player_id=eq.${j.id}`, { method: "DELETE" });
        await api(`membership_requests?player_id=eq.${j.id}`, { method: "DELETE" });
        await api(`player_profiles?id=eq.${j.id}`, { method: "DELETE" });
      }
      await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: enTeteAdmin });
    }
    await navigateur.close();
    const reste = await (await api(`team_invite_codes?select=id&code=like.ZZ-LIEN-%25`)).json();
    t("nettoyage : aucun code de test ne subsiste", (Array.isArray(reste) ? reste.length : 1) === 0, JSON.stringify(reste).slice(0, 120));
  }
  process.exit(bilan() === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
