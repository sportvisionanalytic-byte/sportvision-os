// create-guest-media-checkout : retrouver le compte d'un acheteur déjà inscrit, quel que soit le
// nombre de comptes du projet.
//
// POURQUOI CE TEST. La fonction ne lisait que la première page de 200 comptes. Au 201e compte du
// projet, un acheteur déjà inscrit aurait reçu « Cet e-mail est déjà utilisé mais introuvable » et
// n'aurait plus pu payer. Décision de Fouka (10/09/2026) : recherche exhaustive et fiable, par
// adresse en minuscules — sans toucher au moment de création du compte ni au circuit Stripe.
//
// CE QU'IL VÉRIFIE, SANS STRIPE ET SANS E-MAIL
//   1. la recherche livrée (extraite telle quelle de la fonction) contre une fausse API de 2 500
//      comptes : elle trouve le 1er, le 350e, le 2 500e, et répond « aucun » pour une adresse absente ;
//      et elle ne s'arrête pas sur une page plus courte que demandé (API qui plafonnerait) ;
//   2. la même recherche contre la VRAIE API d'administration Supabase : un compte de test créé en
//      majuscules est retrouvé par son adresse en minuscules ;
//   3. l'ancienne recherche (200 premiers) ne passe pas le point 1 : c'est le rouge.
//
//   node livrables/SportVision-TV/tests/guest-media-checkout-compte.test.mjs
//   REF_GIT=origin/main node livrables/SportVision-TV/tests/guest-media-checkout-compte.test.mjs

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { rapporteur, SB, KEY, enTeteAdmin } from "./_session-os.mjs";

const { t, bilan } = rapporteur();
const T0 = Date.now();
const CHEMIN = "livrables/SportVision-TV/supabase/functions/create-guest-media-checkout/index.ts";
const src = process.env.REF_GIT
  ? execFileSync("git", ["show", `${process.env.REF_GIT}:${CHEMIN}`], { encoding: "utf8" })
  : readFileSync(new URL("../supabase/functions/create-guest-media-checkout/index.ts", import.meta.url).pathname, "utf8");

// Extraction de la fonction livrée (même méthode que emails-rendu.test.mjs).
function extraire(nom) {
  const i = src.indexOf(`async function ${nom}(`);
  if (i === -1) return null;
  let k = src.indexOf("(", i), par = 0;
  for (; k < src.length; k++) {
    if (src[k] === "(") par++;
    else if (src[k] === ")" && --par === 0) break;
  }
  // Le corps commence à la première accolade suivie d'un saut de ligne : le type de retour
  // (`Promise<{ id: string } | null>`) contient lui aussi des accolades.
  const debut = src.indexOf("{\n", k);
  let p = 0;
  for (let j = debut; j < src.length; j++) {
    if (src[j] === "{") p++;
    else if (src[j] === "}" && --p === 0) return src.slice(i, j + 1);
  }
  return null;
}
const ts = (await import("../../SportVision-Connect/app-next/node_modules/typescript/lib/typescript.js")).default;
const code = extraire("compteParAdresse");
// L'ancienne recherche, telle qu'elle était écrite dans la fonction (une page de 200).
const ancienne = async (admin, email) => {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const m = list?.users?.find((u) => (u.email || "").toLowerCase() === email);
  return m ? { id: m.id } : null;
};
const compteParAdresse = code
  ? new Function(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText + "\nreturn compteParAdresse;")()
  : null;
const rechercheLivree = compteParAdresse || ancienne;
console.log(compteParAdresse ? "Recherche livrée : compteParAdresse" : "Recherche livrée : l'ancienne (200 premiers comptes)");

// ── 1. Fausse API : 2 500 comptes, pages plafonnées ou non ──────────────────
function fausseApi(n, plafond = Infinity) {
  const comptes = Array.from({ length: n }, (_, i) => ({ id: `id-${i + 1}`, email: `compte${i + 1}@exemple.fr` }));
  let appels = 0;
  return {
    appels: () => appels,
    auth: { admin: { listUsers: async ({ page = 1, perPage = 50 }) => {
      appels++;
      const taille = Math.min(perPage, plafond);
      return { data: { users: comptes.slice((page - 1) * taille, page * taille) }, error: null };
    } } },
  };
}
console.log("\n1. Recherche contre une fausse API de 2 500 comptes");
for (const [rang, libelle] of [[1, "le 1er"], [350, "le 350e"], [2500, "le 2 500e"]]) {
  const api = fausseApi(2500);
  const r = await rechercheLivree(api, `compte${rang}@exemple.fr`);
  t(`${libelle} compte est retrouvé`, r?.id === `id-${rang}`, JSON.stringify(r));
}
{
  const api = fausseApi(2500);
  t("une adresse absente répond « aucun compte », sans erreur", (await rechercheLivree(api, "absent@exemple.fr")) === null);
  const plafonnee = fausseApi(2500, 50);
  t("API qui renverrait des pages de 50 au lieu de 1000 : le 2 000e est quand même retrouvé",
    (await rechercheLivree(plafonnee, "compte2000@exemple.fr"))?.id === "id-2000");
}

// ── 2. La vraie API d'administration ────────────────────────────────────────
console.log("\n2. Contre la vraie API d'administration Supabase");
const { createClient } = await import("../../SportVision-Connect/app-connect/node_modules/@supabase/supabase-js/dist/index.mjs");
const admin = createClient(SB, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const saisie = `ZZ-CX-DEC-Guest-${T0}@Example.Invalid`;
const cree = await (await fetch(`${SB}/auth/v1/admin/users`, {
  method: "POST", headers: { ...enTeteAdmin, "Content-Type": "application/json" },
  body: JSON.stringify({ email: saisie, password: "ZzDecisions!2026", email_confirm: true }),
})).json();
try {
  t("décor : un compte de test créé (sans e-mail)", !!cree.id, JSON.stringify(cree).slice(0, 160));
  const r = await rechercheLivree(admin, saisie.toLowerCase());
  t("il est retrouvé par son adresse en minuscules", r?.id === cree.id, JSON.stringify(r));
  t("une adresse inconnue du projet répond « aucun compte »", (await rechercheLivree(admin, `zz-cx-dec-absent-${T0}@example.invalid`)) === null);
} finally {
  if (cree.id) await fetch(`${SB}/auth/v1/admin/users/${cree.id}`, { method: "DELETE", headers: enTeteAdmin });
  const reste = await (await fetch(`${SB}/auth/v1/admin/users/${cree.id}`, { headers: enTeteAdmin })).json();
  t("le compte de test est supprimé", !reste?.id);
}

// ── 3. Garde-fous sur le code livré ─────────────────────────────────────────
console.log("\n3. Le code livré");
t("plus aucune recherche limitée à une page de 200", !/perPage:\s*200/.test(src));
t("le moment de création du compte n'a pas bougé (inviteUserByEmail avant la commande)",
  src.indexOf("inviteUserByEmail(") > 0 && src.indexOf("inviteUserByEmail(") < src.indexOf('.from("media_orders")'));
t("le circuit Stripe n'a pas bougé (même metadata que le parcours connecté)", src.includes('metadata: { product: "media_pass", order_id: order.id }'));

process.exit(bilan() ? 1 : 0);
