// L'adresse de contact d'une demande d'ouverture Club+ est enregistrée sous sa forme canonique
// (décisions Club+ du 10/09/2026, n° 4).
//
// POURQUOI CE TEST. connect-club-signup-request gardait la casse saisie : « ZZ.Dupont@Club.FR »
// était enregistrée telle quelle, alors que le compte créé ensuite, les recherches de doublon et
// la fiche client comparent en minuscules. Et une adresse collée avec un espace devant était
// refusée comme « invalide », la validation portant sur la saisie brute. Décision : trim +
// minuscules, à l'enregistrement.
//
// On appelle la fonction comme le fait l'écran /signup/request (clé publique), avec deux saisies :
// en majuscules, puis en majuscules entourées d'espaces. On relit ce que la base a gardé.
//
//   node livrables/SportVision-TV/tests/connect-club-signup-request-adresse.test.mjs           (fonction déployée)
//   LOCAL_SIGNUP_REQUEST=http://127.0.0.1:8003 node …   (mesure la déployée PUIS le code du dépôt)
//
// PROPRETÉ. Aucun compte créé, aucun e-mail : une demande n'envoie qu'une notification interne au
// staff, supprimée à la fin avec les demandes (noms « ZZ Test Demande Adresse … »), et vérifié.

import { rapporteur, SB, ANON, enTeteAdmin } from "./_session-os.mjs";

const T0 = Date.now();
const { t, bilan } = rapporteur();
const CIBLES = [["déployée", `${SB}/functions/v1/connect-club-signup-request`], ...(process.env.LOCAL_SIGNUP_REQUEST ? [["code du dépôt", process.env.LOCAL_SIGNUP_REQUEST]] : [])];
const api = (chemin, opts = {}) => fetch(`${SB}/rest/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });
const lire = async (chemin) => { const r = await api(chemin); return r.ok ? r.json() : []; };

async function demander(url, nomClub, adresseSaisie) {
  const r = await fetch(url, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      organization_type: "club", club_nom: nomClub, structure_type: "Association loi 1901", ville: "Villeneuve-la-Guyard",
      sport: "Football", contact_prenom: "ZZ", contact_nom: "Adresse", contact_email: adresseSaisie, contact_telephone: "0600000000",
      fonction: "Président(e)", besoins: ["Photo / vidéo"], certification_acceptee: true,
    }),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

try {
  let i = 0;
  for (const [libelle, url] of CIBLES) {
    for (const [cas, habiller] of [["en majuscules", (e) => e.toUpperCase()], ["en majuscules, entourée d'espaces", (e) => `  ${e.toUpperCase()}  `]]) {
      i++;
      const canonique = `zz-cp-dec-demande-${i}-${T0}@example.invalid`;
      const nomClub = `ZZ Test Demande Adresse ${i} ${T0}`;
      const r = await demander(url, nomClub, habiller(canonique));
      const d = (await lire(`connect_clubplus_signup_requests?select=contact_email&club_nom=eq.${encodeURIComponent(nomClub)}`))[0];
      t(`${libelle} · adresse saisie ${cas} : demande acceptée et adresse enregistrée « ${canonique} »`,
        r.status === 200 && d?.contact_email === canonique, `${r.status} ${JSON.stringify(r.data).slice(0, 120)} — enregistrée : ${JSON.stringify(d?.contact_email)}`);
    }
  }
} catch (e) {
  t("le test va jusqu'au bout", false, String(e?.message || e).slice(0, 200));
} finally {
  const del = (chemin) => api(chemin, { method: "DELETE" });
  await del(`notifications?message=ilike.*ZZ%20Test%20Demande%20Adresse*${T0}*`);
  await del(`notifications?titre=ilike.*ZZ%20Test%20Demande%20Adresse*${T0}*`);
  await del(`connect_clubplus_signup_requests?club_nom=like.ZZ%20Test%20Demande%20Adresse*${T0}`);
  const restes = [
    ...(await lire(`connect_clubplus_signup_requests?select=id&club_nom=like.*${T0}*`)),
    ...(await lire(`notifications?select=id&message=ilike.*${T0}*`)),
  ];
  t("nettoyage : demandes et notifications du staff supprimées", restes.length === 0, `A NETTOYER A LA MAIN : ${restes.length} ligne(s)`);
}
process.exit(bilan() ? 1 : 0);
