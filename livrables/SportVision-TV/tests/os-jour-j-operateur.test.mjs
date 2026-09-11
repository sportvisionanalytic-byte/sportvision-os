// Le matin du match, dans le Mode Jour J de l'OS déployé (11/09/2026, v151).
//
//   node tests/os-jour-j-operateur.test.mjs
//
// Trouvé en répétant la première mission réelle (SF Villemomble, 12/09) : une mission « équipe
// affectée » n'offrait aucun bouton dans le Mode Jour J, et « Kit prêt » était refusé par la base.
// Ce test ouvre le Mode Jour J avec un opérateur de test sur une mission fictive du jour, clique
// les deux premières étapes et relit la base après chaque clic. Puis l'après-match (v152) : sur
// une seconde mission « médias complets » dont les trois livrables photo + vidéo sont déposés,
// l'écran Sauvegarde & livraison propose « Envoyer à Production » et la mission arrive « prête
// pour validation ». Tout est supprimé à la fin.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, ouvrirOS, vraiesErreurs } from "./_session-os.mjs";
const H = { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" };
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (query) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
})).json();
const svc = async (m, q, b) => (await fetch(`${SB}/rest/v1/${q}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })).json();
const r = []; const t = (n, ok, d = "") => r.push(`${ok ? "ok  " : "KO  "} ${n}${d ? "  · " + d : ""}`);
const attendre = (ms) => new Promise((res) => setTimeout(res, ms));
const stamp = Date.now(); const ids = {};
const auj = new Date(); const iso = `${auj.getFullYear()}-${String(auj.getMonth() + 1).padStart(2, "0")}-${String(auj.getDate()).padStart(2, "0")}`;

const nav = await chromium.launch();
try {
  const email = `qa-sv-jourj-photo-${stamp}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password: `Qa!${stamp}x${Math.random()}`, email_confirm: true }) })).json();
  ids.user = u.id;
  await svc("POST", "profiles?on_conflict=id", { id: u.id, prenom: "QA", nom: "Jour J", role: "photo", actif: true });
  const cli = (await svc("POST", "clients", { nom: `ZZ Club Jour J ${stamp}`, statut_relation: "partenaire" }))[0]; ids.cli = cli.id;
  const pre = (await svc("POST", "prestations", { client_id: cli.id, date_prestation: iso, heure_debut: "23:30", lieu: "Stade ZZ", type_prestation: "match", statut: "équipe_affectée", source: "interne" }))[0]; ids.pre = pre.id;
  await svc("POST", "prestations_equipe", { prestation_id: pre.id, collaborateur_id: u.id, statut: "acceptée", remuneration: 55, heure_rdv: "23:15" });

  const O = await ouvrirOS(nav, { id: u.id, email, role: "photo", prenom: "QA" }, { largeur: 390, hauteur: 844 });
  const page = O.page;
  await page.evaluate(() => window.switchView("jourj")); await attendre(4500);
  const kit = page.locator("#jourj-real button", { hasText: "Kit prêt, je peux partir" });
  t("Mode Jour J, mission « équipe affectée » : le bouton « Kit prêt » est là", (await kit.count()) === 1);
  if (await kit.count()) { await kit.click(); await attendre(3500); }
  let b = (await sql(`select p.statut::text st, (select kit_prepare_at is not null from mission_suivi_operateur where prestation_id = p.id and collaborateur_id = '${u.id}') kit from prestations p where p.id = '${pre.id}'`))[0];
  t("base : mission « prête », kit préparé horodaté", b?.st === "prête" && b?.kit === true, JSON.stringify(b));
  const route = page.locator("#jourj-real button", { hasText: "Je suis en route" });
  t("l'étape suivante apparaît : « Je suis en route »", (await route.count()) === 1);
  if (await route.count()) { await route.click(); await attendre(3500); }
  b = (await sql(`select p.statut::text st, (select parti_at is not null from mission_suivi_operateur where prestation_id = p.id and collaborateur_id = '${u.id}') parti from prestations p where p.id = '${pre.id}'`))[0];
  t("base : « équipe en route », départ horodaté", b?.st === "équipe_en_route" && b?.parti === true, JSON.stringify(b));

  // ── L'après-match : sa livraison envoyée à la Production ──
  const apres = (await svc("POST", "prestations", { client_id: ids.cli, date_prestation: iso, heure_debut: "09:30", lieu: "Stade ZZ", type_prestation: "match", statut: "médias_complets", source: "interne", couverture: "photo_video" }))[0];
  ids.pre2 = apres.id;
  await svc("POST", "prestations_equipe", { prestation_id: apres.id, collaborateur_id: ids.user, statut: "acceptée", remuneration: 55 });
  await svc("POST", "media_liens", [
    { prestation_id: apres.id, nom: "ZZ photos", url: "https://example.invalid/photos", categorie: "final", type_media: "photo", ajouteur_id: ids.user, transfert_confirme: true },
    { prestation_id: apres.id, nom: "ZZ montage", url: "https://example.invalid/montage", categorie: "final", type_media: "video", ajouteur_id: ids.user },
    { prestation_id: apres.id, nom: "ZZ rushs", url: "https://example.invalid/rushs", categorie: "rushs", type_media: "video", ajouteur_id: ids.user },
  ]);
  await page.evaluate((id) => window.modalSauvegarde(id), apres.id); await attendre(3500);
  const envoyer = page.locator("#sv-modal-ct button", { hasText: "Envoyer à Production" });
  t("après-match : « Envoyer à Production » proposé dès « médias complets »", (await envoyer.count()) === 1);
  if (await envoyer.count()) { await envoyer.click(); await attendre(4000); }
  b = (await sql(`select p.statut::text st, (select livre_at is not null from mission_suivi_operateur where prestation_id = p.id and collaborateur_id = '${ids.user}') livre from prestations p where p.id = '${apres.id}'`))[0];
  t("base : mission « prête pour validation », livraison horodatée", b?.st === "prêt_validation" && b?.livre === true, JSON.stringify(b));
  t("aucune erreur JavaScript", vraiesErreurs(O.erreurs).length === 0, vraiesErreurs(O.erreurs).slice(0, 2).join(" | "));
  await page.context().close();
} catch (e) {
  t("déroulé", false, String(e.message).slice(0, 220));
} finally {
  await nav.close();
  const pres = [ids.pre, ids.pre2].filter(Boolean).map((x) => `'${x}'`).join(",") || "null";
  const net = await sql(`begin;
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    delete from activity_log where entity_id in (select id from prestations_equipe where prestation_id in (${pres})) or entity_id in (${pres});
    delete from financial_audit_log where ligne_id in (select id from prestations_equipe where prestation_id in (${pres})) or ligne_id in (${pres});
    delete from notifications where destinataire_id = ${ids.user ? `'${ids.user}'` : "null"} or prestation_id in (${pres}) or lien_prestation_id in (${pres});
    delete from audit_logs where acteur_id = ${ids.user ? `'${ids.user}'` : "null"};
    delete from mission_suivi_operateur where prestation_id in (${pres});
    delete from prestations_equipe where prestation_id in (${pres});
    delete from media_historique where prestation_id in (${pres});
    delete from media_liens where prestation_id in (${pres});
    delete from prestations where id in (${pres});
    delete from clients where id = ${ids.cli ? `'${ids.cli}'` : "null"};
    delete from profiles where id = ${ids.user ? `'${ids.user}'` : "null"};
    delete from auth.users where id = ${ids.user ? `'${ids.user}'` : "null"};
    commit;`);
  if (!Array.isArray(net)) t("nettoyage : erreur", false, JSON.stringify(net).slice(0, 200));
  const reste = (await sql(`select (select count(*) from auth.users where email like 'qa-sv-jourj-photo-%') comptes, (select count(*) from clients where nom like 'ZZ Club Jour J %') clients`))[0];
  t("nettoyage complet", Object.values(reste).every((v) => v === 0), JSON.stringify(reste));
  console.log(r.join("\n"));
}
