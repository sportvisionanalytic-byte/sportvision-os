// Match Center : une feuille de match saisie doit se voir PARTOUT, tout de suite.
//
// POURQUOI CE TEST. L'audit du 10/09/2026 listait le Match Center comme jamais verifie. C'est
// pourtant l'ecran qu'un club ouvre chaque lundi matin : 50 matchs de Villemomble attendent leur
// feuille. Le risque n'est pas qu'il refuse d'enregistrer — ca se voit — mais qu'il enregistre
// quelque part et que le calendrier, la fiche equipe ou le tableau de bord continuent d'afficher
// un match « a renseigner ». Le club saisit deux fois, puis cesse de faire confiance a l'ecran.
//
// PRECAUTION. Villemomble est un CLUB REEL. Le test choisit un match sans resultat, note son etat
// exact, saisit, verifie la propagation, puis REMET l'etat de depart. La restauration passe par
// l'API d'administration et se verifie ; en cas d'echec, le test le dit au lieu de laisser un faux
// score sur un vrai match.

import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { ouvrirClubPlus, ouvrirLeClub, allerA, CP, vraiesErreursCP } from "./_session-clubplus.mjs";
import { rapporteur, SB, enTeteAdmin } from "./_session-os.mjs";

const CM = "chris2brazza@gmail.com";
const CLUB = "SF Villemomble";
const { t, bilan } = rapporteur();

const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });

const club = (await (await api(`clubs?select=id&nom=eq.${encodeURIComponent(CLUB)}`)).json())[0];
if (!club) { console.log(`Club ${CLUB} introuvable — test ignore.`); process.exit(0); }

const navigateur = await chromium.launch();
const { page, erreurs } = await ouvrirClubPlus(navigateur, CM);
await ouvrirLeClub(page, CLUB);

// ── L'ecran repond ──────────────────────────────────────────────────────────
const t0 = Date.now();
await page.goto(`${CP}/clubplus/matchcenter`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(4000);
const ms = Date.now() - t0;

t("le Match Center s'ouvre", /matchcenter/.test(page.url()), page.url());
t(`il s'affiche en moins de 20 s (${(ms / 1000).toFixed(1)} s)`, ms < 20000, `${(ms / 1000).toFixed(1)} s`);

const texteInitial = (await page.evaluate(() => document.body.innerText)) || "";
const mAttente = texteInitial.match(/[ÀA]\s*renseigner\s*(\d+)/i);
t("il annonce les matchs en attente de feuille", !!mAttente, "aucun compteur « A renseigner » trouve");
const enAttenteAvant = mAttente ? +mAttente[1] : null;
if (enAttenteAvant !== null) console.log(`       ${enAttenteAvant} matchs attendent leur feuille`);

t("il ne deborde pas horizontalement",
  !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)));

// ── La saisie, de bout en bout ──────────────────────────────────────────────
// On vise un match sans score DANS LE MOIS COURANT. Le calendrier s'ouvre sur le mois en cours :
// prendre le plus ancien match sans resultat (aout) revenait a chercher le score dans une vue qui
// ne l'affiche pas, et a conclure a tort qu'il ne s'etait pas propage.
const debutMois = new Date(); debutMois.setDate(1);
const finMois = new Date(debutMois.getFullYear(), debutMois.getMonth() + 1, 0);
const iso = (d) => d.toISOString().slice(0, 10);
const sansResultat = await (await api(
  `club_matches?select=id,team,opponent,match_date,score,status&club_id=eq.${club.id}&score=is.null` +
  `&match_date=gte.${iso(debutMois)}&match_date=lte.${iso(finMois)}&order=match_date.asc&limit=1`)).json();
const cible = sansResultat?.[0];
t("un match sans resultat est disponible pour la mesure", !!cible);

let restaure = null;
if (cible) {
  console.log(`       match temoin : ${cible.team} contre ${cible.opponent} (${cible.match_date})`);
  const etatDepart = { score: cible.score, status: cible.status };

  await page.locator("button", { hasText: "Saisir le résultat" }).first().click();
  await page.waitForTimeout(3000);
  const modale = page.locator("div.fixed").filter({ hasText: /Saisir un r[ée]sultat/i }).last();
  t("la modale de saisie s'ouvre", await modale.count() > 0);

  if (await modale.count()) {
    // La modale s'ouvre sur le premier match de la file : on choisit explicitement le notre,
    // sinon on mesure la propagation d'un match qu'on n'a pas choisi.
    const listeMatchs = modale.locator("select").first();
    if (await listeMatchs.count()) {
      const options = await listeMatchs.evaluate((s) => [...s.options].map((o) => o.textContent.trim()));
      const voulue = options.find((o) => o.includes(cible.opponent));
      if (voulue) { await listeMatchs.selectOption({ label: voulue }); await page.waitForTimeout(1500); }
      t("le match temoin est selectionnable dans la modale", !!voulue,
        `« ${cible.opponent} » absent des ${options.length} entrees`);
    }
    const champs = modale.locator("input[type=number]");
    t("elle propose bien deux scores", await champs.count() >= 2, `${await champs.count()} champ(s)`);

    // Un score volontairement improbable : s'il apparait ailleurs, c'est bien le notre.
    await champs.nth(0).fill("7");
    await champs.nth(1).fill("3");
    const termine = modale.locator("button", { hasText: /^Termin[ée]$/ }).first();
    if (await termine.count()) await termine.click();
    await page.waitForTimeout(800);

    await modale.locator("button", { hasText: /Enregistrer le r[ée]sultat/i }).first().click();
    await page.waitForTimeout(6000);

    // La verite est en base, pas dans le message a l'ecran.
    const apres = (await (await api(`club_matches?select=id,score,status&id=eq.${cible.id}`)).json())[0];
    t("le score est bien enregistre en base", (apres?.score || "").includes("7") && (apres?.score || "").includes("3"),
      `score lu : ${JSON.stringify(apres?.score)}`);
    restaure = { id: cible.id, ...etatDepart };

    // ── Propagation ────────────────────────────────────────────────────────
    // Le match doit sortir de la file « a renseigner ».
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const texteApres = (await page.evaluate(() => document.body.innerText)) || "";
    const mApres = texteApres.match(/[ÀA]\s*renseigner\s*(\d+)/i);
    t("le match quitte la file des feuilles a renseigner",
      !mApres || enAttenteAvant === null || +mApres[1] === enAttenteAvant - 1,
      mApres ? `${mApres[1]} restants contre ${enAttenteAvant} avant` : "compteur perdu");

    // Le calendrier doit montrer le score, pas seulement le match.
    //
    // ATTENTION AU FAUX VERT. Une premiere version cherchait /7[-:]3/ dans TOUT le texte de la
    // page. Le calendrier est plein de creneaux a « 17:30 », qui contient « 7:3 » : l'assertion
    // passait sans rien prouver. On cherche donc le score DANS l'element qui porte le nom de
    // l'adversaire, et nulle part ailleurs.
    // Vue MOIS, pas Liste : la vue Liste ne montre que ce qui vient, et le match temoin est deja
    // joue. Mesure du 10/09/2026 — un match du 2 septembre en est absent, ce qui faisait conclure
    // a tort que le score ne s'etait pas propage.
    await allerA(page, "Calendrier");
    await page.locator("button", { hasText: /^Mois$/ }).first().click().catch(() => {});
    await page.waitForTimeout(4500);

    const trouve = await page.evaluate((adversaire) => {
      const candidats = [...document.querySelectorAll("li, tr, div")]
        .filter((e) => (e.textContent || "").includes(adversaire) && (e.textContent || "").length < 400);
      if (!candidats.length) return { present: false, texte: "" };
      const plusPetit = candidats.reduce((a, b) => ((a.textContent || "").length <= (b.textContent || "").length ? a : b));
      const texte = (plusPetit.textContent || "").replace(/\s+/g, " ");
      // Pas de \b autour des chiffres : le rendu colle les libelles, « As Chelles7-3U10 » n'offre
      // aucune frontiere de mot avant le 7. La recherche est deja sure puisqu'elle porte sur le
      // plus petit element contenant le nom de l'adversaire, et non sur toute la page.
      return { present: true, texte, score: /7\s*[-–]\s*3/.test(texte) };
    }, cible.opponent);

    t("le calendrier affiche le match du temoin", trouve.present,
      `« ${cible.opponent} » introuvable dans la vue Liste`);
    t("et il porte le score qui vient d'etre saisi", !!trouve.score,
      trouve.present ? `ligne lue : « ${trouve.texte.slice(0, 140)} »` : "");
  }
}

// ── Remise en etat ──────────────────────────────────────────────────────────
// Villemomble est un club reel : on ne laisse pas un faux score derriere soi.
if (restaure) {
  const r = await api(`club_matches?id=eq.${restaure.id}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ score: restaure.score, status: restaure.status }),
  });
  const remis = (await r.json())?.[0];
  t("le match temoin est remis dans son etat de depart",
    r.status < 300 && (remis?.score ?? null) === (restaure.score ?? null),
    `score apres remise : ${JSON.stringify(remis?.score)} — ATTENTION, un faux score peut subsister`);
}

t("aucune erreur JavaScript sur tout le parcours", vraiesErreursCP(erreurs).length === 0,
  vraiesErreursCP(erreurs).slice(0, 4).join("\n       "));

await navigateur.close();
process.exit(bilan() ? 1 : 0);
