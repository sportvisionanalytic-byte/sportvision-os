// Le Community Manager DU CLUB, dans Club+ deploye (15/09/2026).
//
//   node livrables/SportVision-TV/tests/clubplus-cm-du-club.test.mjs
//
// Fouka : « rajouter le role de Community Manager du club, il aura le meme acces que le CM
// affilie, ils partagent ensemble les galeries ». Trois limites qu'il a posees : role distinct,
// ni l'argent ni les acces, et sur les galeries il voit et partage sans fixer de prix.
//
// Ce test regarde ce qu'il VOIT et ce qu'il PEUT, avec sa propre session, sur le vrai Club+.
import { chromium } from "../../SportVision-Connect/app-next/node_modules/playwright/index.mjs";
import { SB, env, enTeteAdmin, rapporteur } from "./_session-os.mjs";
import { ouvrirClubPlus, ouvrirLeClub, vraiesErreursCP } from "./_session-clubplus.mjs";

const H = { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation" };
const REF = SB.replace(/^https:\/\/([a-z0-9]+)\..*$/, "$1");
const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) })).json();
const svc = async (m, q, b) => (await fetch(`${SB}/rest/v1/${q}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })).json();
const { t, bilan } = rapporteur();
const stamp = Date.now();
const ids = { users: [] };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const CLUB = "SF Villemomble";

const nav = await chromium.launch();
try {
  const vm = (await sql(`select c.id, c.portail_client_id, cl.cm_id from clubs c join clients cl on cl.id=c.portail_client_id where c.nom='${CLUB}'`))[0];
  ids.club = vm.id; ids.client = vm.portail_client_id;
  const email = `qa-sv-cmclub-${stamp}@example.invalid`;
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: H,
    body: JSON.stringify({ email, password: "QaCmClub!2026", email_confirm: true }) })).json();
  ids.users.push(u.id);
  await svc("POST", "club_members", { user_id: u.id, club_id: vm.id, role: "comm", status: "actif", teams: [] });

  const P = await ouvrirClubPlus(nav, email, { chemin: "/clubplus/communication" });
  await ouvrirLeClub(P.page, "zz-aucun-club");
  await attendre(3500);
  const vu = await P.page.evaluate(() => document.body.innerText);

  t("son menu porte le planning éditorial", /Centre communication|Planning éditorial/.test(vu));
  for (const [lb, attendu] of [["Calendrier", true], ["Équipes", true], ["Actualités", true],
                               ["Galeries", true], ["Présences", true],
                               ["Factures", false], ["Invitations", false], ["Sponsors", false]])
    t(`menu : « ${lb} » ${attendu ? "présent" : "absent"}`, new RegExp(lb).test(vu) === attendu);

  // Il construit le planning : c'est le partage demandé par Fouka.
  t("le planning s'ouvre sans erreur", /Planning éditorial de|Communication/.test(vu),
    vu.replace(/\s+/g, " ").slice(0, 110));
  const peutAjouter = await P.page.locator("button", { hasText: "Ajouter" }).count();
  t("il peut ajouter un contenu au planning", peutAjouter > 0);

  const boum = vraiesErreursCP(P.erreurs);
  t("aucune erreur JavaScript", boum.length === 0, boum.slice(0, 2).join(" | "));
  await P.ctx.close();

  // Et en base, la frontière tient.
  const j = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "QaCmClub!2026" }) })).json();
  const lit = async (q) => {
    const r = await fetch(`${SB}/rest/v1/${q}`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${j.access_token}` } });
    const b = await r.json();
    return Array.isArray(b) ? b.length : -1;
  };
  t("il ne lit aucun sponsor du club", (await lit(`club_sponsors?select=id&club_id=eq.${vm.id}`)) === 0);
  t("il ne lit aucune invitation", (await lit(`club_invitations?select=id&club_id=eq.${vm.id}`)) === 0);
  t("il lit le planning de son club", (await lit(`contenus?select=id&client_id=eq.${vm.portail_client_id}&limit=5`)) > 0);
} catch (e) {
  t("déroulé", false, String(e.message).slice(0, 200));
} finally {
  await nav.close();
  const u = ids.users.map((x) => `'${x}'`).join(",") || "null";
  await sql(`begin; select set_config('request.jwt.claims','{"role":"service_role"}',true);
    delete from club_members where user_id in (${u});
    delete from memberships where user_id in (${u});
    delete from club_onboarding_events where auteur_id in (${u});
    delete from profiles where id in (${u});
    delete from auth.users where id in (${u}); commit;`);
  const reste = (await sql(`select count(*)::int n from auth.users where email like 'qa-sv-cmclub-%@example.invalid'`))[0];
  t("nettoyage complet", reste?.n === 0, JSON.stringify(reste));
  bilan();
}
