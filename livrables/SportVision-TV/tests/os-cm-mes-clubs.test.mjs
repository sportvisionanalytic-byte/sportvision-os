// L'espace du CM affilié dans l'OS, dans un vrai navigateur.
//
// Phase 2 : le CM ne doit plus arriver sur le tableau de bord du fondateur, et la direction doit
// pouvoir affecter un référent depuis la fiche club. Aucun droit d'écriture nouveau n'est ouvert
// au CM : le test vérifie aussi cela.
//
// Le réseau est simulé. Le cloisonnement lui-même est prouvé côté base par cm-cloisonnement.test.sql.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../SportVision-OS-Full.html", import.meta.url).pathname, "utf8");
const srv = createServer((req, res) => {
  if (req.url !== "/") return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html" }).end(html);
});
await new Promise((r) => srv.listen(0, r));

const nav = await chromium.launch();
const page = await nav.newPage();
const erreursJs = [];
page.on("pageerror", (e) => { const m = String(e).split("\n")[0]; if (!/ServiceWorker/i.test(m)) erreursJs.push(m); });
await page.goto(`http://localhost:${srv.address().port}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof loadCmMesClubs === "function");

let ok = 0, ko = 0;
const t = (nom, cond, detail = "") => {
  if (cond) { ok++; console.log(`  ok   ${nom}`); }
  else { ko++; console.log(`  KO   ${nom}${detail ? " — " + detail : ""}`); }
};

const preparer = (clubs, affectations = []) => page.evaluate(([c, a]) => {
  window.__appels = [];
  window.__clubs = c; window.__affs = a;
  window.sbFetch = async (path, opts) => {
    window.__appels.push({ path, body: opts?.body });
    if (path.includes("cm_mes_clubs")) return window.__clubs;
    if (path.includes("club_affectations_cm")) return window.__affs;
    if (path.startsWith("profiles?")) return [{ id: "cm1", prenom: "Lucas", nom: "Martin" }, { id: "cm2", prenom: "Sofia", nom: "Bel" }];
    if (path.startsWith("club_cm_affectations")) return [{ id: "new" }];
    return [];
  };
  document.getElementById("cm-mes-clubs")?.remove();
  document.body.insertAdjacentHTML("beforeend", '<div id="cm-mes-clubs"></div>');
  document.getElementById("cfp-equipe-sv")?.remove();
  document.body.insertAdjacentHTML("beforeend", '<div id="cfp-equipe-sv"></div>');
}, [clubs, affectations]);

// ── 1. Un CM sans club ───────────────────────────────────────────────────────
console.log("\n1. Un CM à qui aucun club n'est encore confié");
await preparer([]);
await page.evaluate(() => loadCmMesClubs());
await page.waitForTimeout(120);
const vide = await page.textContent("#cm-mes-clubs");
t("l'écran explique au lieu de rester blanc", vide.includes("Aucun club ne vous est encore confié"));
t("il dit ce qui se passera ensuite", vide.includes("il apparaîtra ici"));

// ── 2. Un CM avec ses clubs ──────────────────────────────────────────────────
console.log("\n2. « Mes clubs »");
await preparer([
  { club_id: "c1", nom: "Villemomble Sports", full_com: true, role_affectation: "principal",
    onboarding_statut: "submitted", derniere_activite: new Date().toISOString(),
    equipes: 3, coachs: 4, membres: 68, date_debut: "2026-09-01" },
  { club_id: "c2", nom: "Fontainebleau", full_com: false, role_affectation: "secondaire",
    onboarding_statut: "validated", derniere_activite: null, equipes: 2, coachs: 2, membres: 31 },
]);
await page.evaluate(() => loadCmMesClubs());
await page.waitForTimeout(120);
const txt = await page.textContent("#cm-mes-clubs");
t("les deux clubs sont là", txt.includes("Villemomble Sports") && txt.includes("Fontainebleau"));
t("le statut Full Communication est mis en évidence", txt.includes("FULL COM"));
t("le rôle secondaire est dit", txt.includes("CM secondaire"));
t("l'état d'onboarding est en français, pas un code", txt.includes("Informations soumises") && !txt.includes("submitted"));
t("les compteurs sont réels", txt.includes("3 équipes") && txt.includes("68 membres"));
t("aucun pourcentage inventé", !/\d+\s?%/.test(txt));
t("la dernière activité est lisible", txt.includes("Aujourd’hui"));

// ── 3. Le CM ne voit pas le tableau de bord du fondateur ─────────────────────
console.log("\n3. Ce que le CM ne doit pas voir");
for (const interdit of ["Chiffre d'affaires", "Trésorerie", "Salaires", "Masse salariale"]) {
  t(`« ${interdit} » absent de son accueil`, !txt.includes(interdit));
}

// ── 4. La fiche club vue par le CM est en lecture ────────────────────────────
console.log("\n4. La fiche club du CM : lecture seule en phase 2");
await page.evaluate(() => cmOuvrirClub("c1"));
await page.waitForTimeout(200);
const fiche = await page.textContent("#sv-modal-ct");
t("elle s'ouvre sur le bon club", fiche.includes("Villemomble Sports"));
t("elle montre l'état de la mise en place", fiche.includes("Informations soumises"));
t("elle nomme le référent SportVision", fiche.includes("Référent SportVision"));
// Phase 2 affichait « arrive prochainement » : la configuration n'existait nulle part. Depuis la
// phase 3 elle existe, dans Club+, et la fiche y renvoie. Assertion mise a jour le 08/09 — le
// produit a change, pas regresse.
t("elle renvoie le CM vers l'endroit où il travaille", fiche.includes("Gérer dans Club+"));
t("aucun bouton d'écriture n'est proposé", await page.evaluate(() =>
  ![...document.querySelectorAll("#sv-modal-ct button")]
    .some((b) => /créer|ajouter|inviter|importer|modifier|envoyer/i.test(b.innerText))));
await page.evaluate(() => closeModal());

// ── 5. Affectation côté direction ────────────────────────────────────────────
console.log("\n5. La direction affecte un référent");
await preparer([], [
  { id: "a1", cm_id: "cm1", prenom: "Lucas", nom: "Martin", role: "principal",
    date_debut: "2026-09-01", date_fin: null, actif: true, en_cours: true },
  { id: "a0", cm_id: "cm2", prenom: "Sofia", nom: "Bel", role: "secondaire",
    date_debut: "2026-06-01", date_fin: "2026-08-31", actif: false, en_cours: false },
]);
await page.evaluate(() => { S.role = "admin"; S.uid = "u1"; cfpChargerEquipeSportVision("c1"); });
await page.waitForTimeout(150);
const eq = await page.textContent("#cfp-equipe-sv");
t("le référent actuel est affiché", eq.includes("Lucas Martin") && eq.includes("CM principal"));
t("la date de début est en français", eq.includes("1 sept. 2026"));
t("l'historique est conservé et rangé", eq.includes("Historique") && eq.includes("Sofia"));
t("la direction peut affecter", eq.includes("Affecter un CM"));

await page.evaluate(() => cfpModalAffecterCm("c1"));
await page.waitForTimeout(200);
const form = await page.textContent("#sv-modal-ct");
t("le formulaire ne montre aucune valeur technique", !/uuid|user_id|claims|[0-9a-f]{8}-[0-9a-f]{4}/i.test(form));
t("il prévient du remplacement du principal", form.includes("est aujourd’hui le CM principal"));
t("il dit ce qui arrive à l'ancien", form.includes("perdra l’accès immédiatement"));
t("la date de début est pré-remplie à aujourd'hui",
  (await page.inputValue("#aff-debut")) === (await page.evaluate(() => ymdLocal())));
t("choisir « secondaire » retire l'avertissement", await page.evaluate(async () => {
  document.getElementById("aff-role").value = "secondaire";
  cfpAvertirPrincipal();
  return document.getElementById("aff-avert").innerHTML.trim() === "";
}));

// ── 6. Un CM ne s'affecte pas lui-même ───────────────────────────────────────
console.log("\n6. Un CM ne peut pas s'affecter");
await page.evaluate(() => closeModal());
await page.evaluate(() => { S.role = "cm"; cfpChargerEquipeSportVision("c1"); });
await page.waitForTimeout(150);
const vueCm = await page.textContent("#cfp-equipe-sv");
t("il voit qui est référent", vueCm.includes("Lucas Martin"));
t("mais pas le bouton d'affectation", !vueCm.includes("Affecter un CM"));
t("ni le bouton de retrait", !vueCm.includes("Retirer"));

t("aucune erreur JavaScript sur tout le parcours", erreursJs.length === 0, erreursJs.join(" | "));

console.log(`\n${ok}/${ok + ko} verifications passees.`);
await nav.close();
srv.close();
process.exit(ko ? 1 : 0);
