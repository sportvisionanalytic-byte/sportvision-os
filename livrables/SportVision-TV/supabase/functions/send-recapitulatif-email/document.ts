// Le DOCUMENT du récapitulatif mensuel de prestations, et rien d'autre.
//
// POURQUOI IL EST DANS SON PROPRE FICHIER. Il vivait dans index.ts, à côté de `serve()`. Or importer
// index.ts pour rendre le document DÉMARRE le serveur HTTP de la fonction et ne rend jamais la main.
// On ne pouvait donc pas regarder la page avant de l'envoyer à dix-huit personnes — exactement ce
// qu'il faut pouvoir faire. Ici, aucun effet de bord au chargement.
//
// ══ TROIS MOTS SONT INTERDITS DANS CE FICHIER ════════════════════════════════════════════════════
//
// Les collaborateurs de SportVision sont tous en `type_contrat = 'freelance'`, vérifié en base le
// 29/09/2026. Un bulletin de paie est le document d'un employeur à un salarié : en envoyer un à un
// indépendant, c'est produire soi-même la preuve écrite d'un lien de subordination, la première
// pièce qu'un contrôle URSSAF demande pour requalifier une prestation en contrat de travail. Fouka
// a été alerté et a tranché : « récapitulatif de prestations ».
//
//   « salaire »       → on écrit « montant versé » ;
//   « fiche de paie » → on écrit « récapitulatif de prestations » ;
//   « pénalité »      → on écrit « ajustement ». Le pouvoir de SANCTIONNER est lui aussi un critère
//                       d'employeur : une retenue est un ajustement prévu au contrat, pas une
//                       punition.
//
// Et jamais « vous êtes payé », qui est la phrase d'un employeur, mais « montant qui vous sera
// versé ». La seule occurrence autorisée de « bulletin de paie » est la phrase qui dit que ce
// document n'en est pas un.

const LOGO = "https://sportvision-an.fr/assets/brand/logo-mark.png";

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** « septembre 2026 » depuis « 2026-09-01 ». Sans Date : un fuseau de plus est un bug de plus. */
export function moisEnClair(iso: string): string {
  const [a, m] = iso.split("-");
  return `${MOIS[Number(m) - 1]} ${a}`;
}

/** « samedi 12 septembre » depuis « 2026-09-12 », sans passer par un fuseau. */
function jourEnClair(iso: string | null): string {
  if (!iso) return "";
  const [a, m, j] = iso.split("-").map(Number);
  // UTC volontaire pour le seul calcul du jour de la semaine : la date est déjà une date civile,
  // la relire en heure locale du serveur la décalerait d'un jour une nuit sur deux.
  const jours = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const n = new Date(Date.UTC(a, m - 1, j)).getUTCDay();
  return `${jours[n]} ${j} ${MOIS[m - 1]}`;
}

function euros(n: number): string {
  return `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function echapper(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Une ligne du recapitulatif, telle qu'elle est stockee. */
export interface LigneRecap {
  date_prestation: string | null;
  libelle: string;
  montant: number;
  nature: string;
  motif?: string | null;
}

/** Le recapitulatif, tel qu'il est stocke, plus le collaborateur joint. */
export interface Recap {
  mois: string;
  note?: string | null;
  nb_prestations: number;
  montant_prestations: number;
  montant_primes: number;
  montant_ajustements: number;
  montant_frais: number;
  montant_du: number;
  montant_verse: number;
  virement_annonce_le: string | null;
  collaborateur?: { prenom?: string | null; nom?: string | null; email?: string | null } | null;
}

/**
 * LE DOCUMENT. Exportee, et c'est deliberе : c'est ce qui permet de le RENDRE et de le REGARDER
 * avant qu'il ne parte chez dix-huit personnes, sans recopier ce HTML dans un script d'apercu. Une
 * copie ne prouverait que la copie.
 */
export function rendreRecapitulatif(r: Recap, toutes: LigneRecap[]): string {
  const prenom = echapper(r.collaborateur?.prenom ?? "");
  const nomComplet = echapper(`${r.collaborateur?.prenom ?? ""} ${r.collaborateur?.nom ?? ""}`.trim());
  const periode = moisEnClair(r.mois);
  const bloc = (titre: string, nature: string) => {
    const l = toutes.filter((x) => x.nature === nature);
    if (!l.length) return "";
    return `
    <tr><td colspan="3" style="padding:16px 0 6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8891A8">${echapper(titre)}</td></tr>
    ${l.map((x) => `
    <tr>
      <td style="padding:7px 0;font-size:13px;color:#5B6477;white-space:nowrap;vertical-align:top">${echapper(jourEnClair(x.date_prestation))}</td>
      <td style="padding:7px 10px;font-size:13px;color:#1B2033;vertical-align:top">${echapper(x.libelle)}${x.motif ? `<br><span style="font-size:11.5px;color:#8891A8">${echapper(x.motif)}</span>` : ""}</td>
      <td style="padding:7px 0;font-size:13px;color:#1B2033;text-align:right;white-space:nowrap;vertical-align:top;font-variant-numeric:tabular-nums">${euros(x.montant)}</td>
    </tr>`).join("")}`;
  };

  const totalLigne = (libelle: string, valeur: number, fort = false) => `
    <tr>
      <td colspan="2" style="padding:${fort ? "12px 0 0" : "5px 0"};font-size:${fort ? "15px" : "13px"};${fort ? "font-weight:700;" : ""}color:${fort ? "#1B2033" : "#5B6477"};${fort ? "border-top:2px solid #1B2033;" : ""}">${echapper(libelle)}</td>
      <td style="padding:${fort ? "12px 0 0" : "5px 0"};font-size:${fort ? "15px" : "13px"};${fort ? "font-weight:700;" : ""}color:#1B2033;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;${fort ? "border-top:2px solid #1B2033;" : ""}">${euros(valeur)}</td>
    </tr>`;

  // L'ÉCART ENTRE LE DÛ ET LE VERSÉ SE DIT, IL NE SE CACHE PAS. Fouka décide du montant ; si ce
  // montant diffère de la somme des lignes, le collaborateur doit pouvoir le voir sur le document
  // plutôt que de le découvrir sur son relevé bancaire.
  const ecart = Number(r.montant_verse) - Number(r.montant_du);

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Récapitulatif de prestations — ${periode}</title></head>
<body style="margin:0;padding:0;background:#F4F6FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
  <div style="background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(27,32,51,.08)">

    <div style="padding:26px 28px 20px;border-bottom:1px solid #E8EBF4">
      <img src="${LOGO}" alt="SportVision" width="46" height="46" style="display:block;border:0">
      <div style="margin-top:14px;font-size:19px;font-weight:700;color:#1B2033">Récapitulatif de prestations</div>
      <div style="margin-top:3px;font-size:14px;color:#5B6477">${echapper(periode)}</div>
    </div>

    <div style="padding:22px 28px 0">
      <div style="font-size:14px;color:#1B2033;line-height:1.6">
        Bonjour${prenom ? ` ${prenom}` : ""},<br><br>
        Voici le récapitulatif des prestations que vous avez réalisées pour SportVision en
        ${echapper(periode)}.
      </div>
    </div>

    <div style="padding:6px 28px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        ${bloc("Prestations", "prestation")}
        ${bloc("Primes", "prime")}
        ${bloc("Frais et déplacements", "frais")}
        ${bloc("Ajustements", "ajustement")}
      </table>
    </div>

    <div style="padding:18px 28px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        ${Number(r.montant_prestations) ? totalLigne(`Prestations (${r.nb_prestations})`, Number(r.montant_prestations)) : ""}
        ${Number(r.montant_primes) ? totalLigne("Primes", Number(r.montant_primes)) : ""}
        ${Number(r.montant_frais) ? totalLigne("Frais et déplacements", Number(r.montant_frais)) : ""}
        ${Number(r.montant_ajustements) ? totalLigne("Ajustements", Number(r.montant_ajustements)) : ""}
        ${totalLigne("Montant qui vous sera versé", Number(r.montant_verse), true)}
      </table>
      ${Math.abs(ecart) >= 0.01 ? `
      <div style="margin-top:10px;font-size:12.5px;color:#5B6477;line-height:1.6">
        Total des lignes ci-dessus : ${euros(Number(r.montant_du))}. Le montant versé est
        ${ecart > 0 ? "supérieur" : "inférieur"} de ${euros(Math.abs(ecart))}.
      </div>` : ""}
      ${r.note ? `
      <div style="margin-top:14px;padding:12px 14px;background:#F4F6FB;border-radius:9px;font-size:13px;color:#1B2033;line-height:1.6">
        ${echapper(r.note)}
      </div>` : ""}
    </div>

    <div style="padding:20px 28px 6px">
      <div style="padding:14px 16px;background:#EEF7F0;border-radius:9px;font-size:13.5px;color:#1B5E32;line-height:1.6">
        <strong>Virement en cours.</strong> Le montant vous sera viré au plus tard le
        ${echapper(jourEnClair(r.virement_annonce_le))}.
      </div>
    </div>

    <div style="padding:16px 28px 26px">
      <div style="font-size:12px;color:#8891A8;line-height:1.7;border-top:1px solid #E8EBF4;padding-top:14px">
        Ce document récapitule des prestations réalisées en qualité d'indépendant. Il ne constitue
        ni un bulletin de paie ni un contrat de travail.<br>
        Une question sur ce récapitulatif ? Répondez simplement à cet e-mail.
      </div>
      <div style="margin-top:14px;font-size:10.5px;color:#8891A8;line-height:1.6">
        ${nomComplet ? `${nomComplet}<br>` : ""}
        SportVision — Elkana Group, SAS — 4 Place Pierre Sémard, 77130 Montereau-Fault-Yonne<br>
        SIREN 105 173 124 · SIRET 105 173 124 00014 · RCS Melun · APE 74.20Z<br>
        TVA intracommunautaire : FR15 105 173 124
      </div>
    </div>

  </div>
  </div>
</body></html>`;
}
