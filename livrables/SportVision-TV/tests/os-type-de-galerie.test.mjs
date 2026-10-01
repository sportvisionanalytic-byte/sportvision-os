// LE TYPE DE GALERIE DANS L'OS (v390, 01/10/2026)
//
// Verifie que les trois morceaux d'ecran ajoutes par la v390 rendent bien ce qu'on attend, en
// extrayant le code REELLEMENT livre dans SportVision-OS-Full.html (jamais une copie).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ICI = dirname(fileURLToPath(import.meta.url));
const H = readFileSync(join(ICI, "..", "SportVision-OS-Full.html"), "utf8");
const bloc = (debut, fin) => {
  const i = H.indexOf(debut); if (i < 0) throw new Error("introuvable : " + debut);
  const j = H.indexOf(fin, i); if (j < 0) throw new Error("fin introuvable apres : " + debut);
  return H.slice(i, j);
};
// Les constantes et l'aide, telles qu'elles sont dans le fichier.
const consts = bloc("const PA_TYPE_LB=", "const paNumeroUtile=") + bloc("const paNumeroUtile=", "\nlet _photoAlbums");
const env = {};
new Function("env", consts + "\nenv.PA_TYPE_LB=PA_TYPE_LB;env.PA_TYPE_AIDE=PA_TYPE_AIDE;env.paNumeroUtile=paNumeroUtile;")(env);
let ko = 0;
const dire = (ok, quoi, vu) => { if (!ok) ko++; console.log(`${ok ? "ok    " : "ROUGE "} ${quoi}${ok ? "" : " -> " + vu}`); };
dire(env.PA_TYPE_LB.entrainement === "Entraînement", "libellé accentué pour entrainement", env.PA_TYPE_LB.entrainement);
dire(Object.keys(env.PA_TYPE_LB).length === 6, "six types proposés", Object.keys(env.PA_TYPE_LB).join(","));
dire(env.paNumeroUtile("match") === true && env.paNumeroUtile("plateau") === true
  && env.paNumeroUtile("entrainement") === false && env.paNumeroUtile("stage") === false
  && env.paNumeroUtile(null) === true, "paNumeroUtile : faux pour entrainement/stage, vrai sinon et si vide", "");
// AUCUN TIRET LONG dans ce qui s'affiche (regle de Fouka).
const affiche = Object.values(env.PA_TYPE_LB).join(" ") + " " + Object.values(env.PA_TYPE_AIDE).join(" ");
dire(!affiche.includes("—"), "aucun tiret long dans les libellés et les aides", affiche);
// Le champ existe, il est obligatoire a la creation, et il est enregistre.
dire(/id="pa-type"/.test(H), "le champ Type de galerie est dans le formulaire", "");
dire(/if\(!albumId&&!typeEvt\)\{/.test(H), "type obligatoire a la creation seulement", "");
dire(/type_evenement:typeEvt/.test(H), "type_evenement part bien a l'enregistrement", "");
dire(/media_albums\?select=id,title,event_date,type_evenement/.test(H), "type_evenement est relu depuis la base", "");
dire(/À préciser/.test(H) && !/— à préciser/.test(H), "aucun tiret long dans le choix vide", "");
dire(/paNumeroUtile\(_galAlbum&&_galAlbum\.type_evenement\)\?''/.test(H),
  "le bloc des numeros lisibles disparait sur un entrainement", "");
console.log(ko ? `\nROUGE : ${ko} controle(s) en echec` : "\nVERT : tous les controles passent");
process.exit(ko ? 1 : 0);
