// delete-account, par le chemin réel : un client Connect qui a une commande média et une facture
// demande la suppression de son compte, avec SON jeton.
//
// POURQUOI CE TEST. suppression-compte-client.test.sql prouve la règle dans une transaction
// annulée. Celui-ci prouve le chemin complet — jeton de la personne, edge function, RPC en
// service_role, base réelle — avec un vrai compte de test.
//
// ATTENDU
//   • migration exécutée + fonction à jour : 200, compte supprimé, commande conservée et détachée,
//     facture conservée sur sa fiche, fiche anonymisée ;
//   • fonction à jour SANS la migration : erreur propre, et RIEN n'a bougé (c'est l'état au
//     10/09/2026, avant exécution de la migration : les vérifications de suppression sont rouges,
//     celles de « rien n'a bougé » vertes) ;
//   • ancienne fonction (REF_GIT=origin/main) : « Database error deleting user », le client ne peut
//     pas partir — le défaut d'origine.
//
// OÙ. Par défaut la fonction déployée. FONCTION_LOCALE=1 : la copie du dépôt (ou de REF_GIT), lancée
// sous Deno contre la vraie base. Aucun e-mail : compte créé par l'API d'administration, adresse
// .invalid. Tout ce qui est créé est supprimé, et la suppression vérifiée.
//
//   FONCTION_LOCALE=1 node livrables/SportVision-TV/tests/suppression-compte-client-fonction.test.mjs
//   FONCTION_LOCALE=1 REF_GIT=origin/main node livrables/SportVision-TV/tests/suppression-compte-client-fonction.test.mjs

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { rapporteur, SB, KEY, ANON, env, enTeteAdmin } from "./_session-os.mjs";
import { lancerFonctionLocale } from "./_fonction-locale.mjs";

const { t, bilan } = rapporteur();
const T0 = Date.now();
const EMAIL = `zz-cx-dec-suppr-fn-${T0}@example.invalid`;
const MDP = "ZzDecisions!2026";
const REF = SB.replace(/^https:\/\/([^.]+)\..*$/, "$1");
const CLUB = "Villeneuve 340 SC";
const api = (c, o = {}) => fetch(`${SB}/rest/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", Prefer: "return=representation", ...(o.headers || {}) } });
const lire = async (c) => { const r = await api(c); return r.ok ? r.json() : []; };
const authApi = (c, o = {}) => fetch(`${SB}/auth/v1/${c}`, { ...o, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(o.headers || {}) } });
async function sqlLecture(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_MANAGEMENT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
  return r.json();
}

// ── La fonction appelée ─────────────────────────────────────────────────────
let URL_FN = `${SB}/functions/v1/delete-account`, locale = null;
if (process.env.FONCTION_LOCALE === "1") {
  const source = process.env.REF_GIT
    ? execFileSync("git", ["show", `${process.env.REF_GIT}:livrables/SportVision-TV/supabase/functions/delete-account/index.ts`], { encoding: "utf8" })
    : readFileSync(new URL("../supabase/functions/delete-account/index.ts", import.meta.url).pathname, "utf8");
  locale = await lancerFonctionLocale({ source, env: { SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: KEY } });
  URL_FN = locale.url;
  console.log(`delete-account : copie ${process.env.REF_GIT ? `de ${process.env.REF_GIT}` : "du dépôt"}, exécutée en local contre la vraie base (${URL_FN})`);
}
const migrationExecutee = Number((await sqlLecture("select count(*) n from pg_proc where proname = 'supprimer_compte_client'"))?.[0]?.n) > 0;
console.log(`supprimer_compte_client en production : ${migrationExecutee ? "oui" : "NON (migration pas encore exécutée)"}`);

// ── Le client : compte, fiche de particulier, commande payée, facture ──
const club = (await lire(`clubs?select=id&nom=eq.${encodeURIComponent(CLUB)}`))[0];
const compte = await (await authApi("admin/users", { method: "POST", body: JSON.stringify({ email: EMAIL, password: MDP, email_confirm: true, user_metadata: { first_name: "Zoé", last_name: "ZZDecSuppr" } }) })).json();
const fiche = (await (await api("clients", { method: "POST", body: JSON.stringify({ nom: "Zoé ZZDecSupprFn", type_client: "particulier", prenom_contact: "Zoé", email: EMAIL }) })).json())?.[0];
await api("connect_profile_settings", { method: "POST", body: JSON.stringify({ user_id: compte.id, client_id: fiche?.id, account_type: "particulier" }) });
const commande = (await (await api("media_orders", { method: "POST", body: JSON.stringify({ club_id: club?.id, purchased_by_user_id: compte.id, amount_cents: 1500, currency: "eur", status: "paid", shipping_status: "non_requis" }) })).json())?.[0];
const facture = (await (await api("factures", { method: "POST", body: JSON.stringify({ numero: `ZZ-DEC-FN-${T0}`, client_id: fiche?.id, type_facture: "totalite", montant_ttc: 15, statut: "payee" }) })).json())?.[0];

try {
  t("décor : compte, fiche, commande payée et facture du client", !!(compte.id && fiche?.id && commande?.id && facture?.id),
    JSON.stringify({ compte: compte.id, fiche: fiche?.id, commande: commande?.id, facture: facture?.id }));

  const jeton = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: MDP }) })).json()).access_token;
  const r = await fetch(URL_FN, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: "{}" });
  const rep = await r.text();
  console.log(`       réponse : HTTP ${r.status} ${rep.slice(0, 160)}`);

  const encore = (await (await authApi(`admin/users/${compte.id}`)).json())?.id === compte.id;
  const cmd = (await lire(`media_orders?select=purchased_by_user_id,acheteur_supprime_le&id=eq.${commande?.id}`))[0]
    ?? (await lire(`media_orders?select=purchased_by_user_id&id=eq.${commande?.id}`))[0];
  const fct = (await lire(`factures?select=client_id&id=eq.${facture?.id}`))[0];
  const fch = (await lire(`clients?select=nom,email&id=eq.${fiche?.id}`))[0];

  t("la demande aboutit (200)", r.status === 200, `HTTP ${r.status}`);
  t("le compte est supprimé", !encore);
  t("la commande est conservée, détachée du compte", !!cmd && cmd.purchased_by_user_id === null, JSON.stringify(cmd));
  t("la facture est conservée, sur sa fiche", fct?.client_id === fiche?.id, JSON.stringify(fct));
  t("la fiche est anonymisée", fch?.nom === "Client supprimé" && fch?.email === null, JSON.stringify(fch));
  if (r.status !== 200) {
    // Échec : il ne doit alors RIEN s'être passé (tout ou rien), et le message ne doit pas être brut.
    t("échec : rien n'a bougé (compte, commande, fiche intacts)", encore && cmd?.purchased_by_user_id === compte.id && fch?.nom === "Zoé ZZDecSupprFn");
    t("échec : message écrit pour la personne, pas l'erreur brute de la base", !/Database error|violates|foreign key/i.test(rep), rep.slice(0, 160));
  }
} finally {
  if (locale) await locale.arreter();
  // ── Nettoyage, vérifié ──
  if (facture?.id) await api(`factures?id=eq.${facture.id}`, { method: "DELETE" });
  if (commande?.id) await api(`media_orders?id=eq.${commande.id}`, { method: "DELETE" });
  if (compte.id) await authApi(`admin/users/${compte.id}`, { method: "DELETE" });
  if (fiche?.id) {
    await api(`messages_client?client_id=eq.${fiche.id}`, { method: "DELETE" });
    await api(`clients?id=eq.${fiche.id}`, { method: "DELETE" });
    await api(`organizations?id=eq.${fiche.id}`, { method: "DELETE" }); // copie posée par sync_client_to_organization
  }
  const reste = (await sqlLecture(`select
      (select count(*) from auth.users where email = '${EMAIL}') comptes,
      (select count(*) from clients where id = '${fiche?.id}') fiches,
      (select count(*) from organizations where id = '${fiche?.id}') organisations,
      (select count(*) from media_orders where id = '${commande?.id}') commandes,
      (select count(*) from factures where numero = 'ZZ-DEC-FN-${T0}') factures`))?.[0] || {};
  t("rien ne subsiste (compte, fiche, organisation, commande, facture)", Object.values(reste).every((n) => Number(n) === 0), JSON.stringify(reste));
}

process.exit(bilan() ? 1 : 0);
