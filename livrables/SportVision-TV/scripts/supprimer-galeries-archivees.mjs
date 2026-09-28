#!/usr/bin/env node
// Supprime pour de bon les galeries archivées depuis plus d'un mois (décision de Fouka, 28/09/2026 :
// « archivé le 3e mois, supprimer pour de bon, libérer le 4e mois »).
//
// POURQUOI UN SCRIPT ET PAS UNE TÂCHE DE NUIT. Les photos vivent dans le stockage, hors de portée du
// SQL. Les effacer demande un appel au stockage, et L'ORDRE COMPTE : les fichiers d'abord, les
// lignes ensuite. Dans l'autre sens on perd la liste des fichiers à effacer et il reste des objets
// que plus rien ne référence, que personne ne retrouvera et qui se paient chaque mois.
//
// IL DÉMARRE EN SIMULATION. Sans `--pour-de-vrai`, il n'efface rien et se contente de dire ce qu'il
// ferait. C'est le seul geste du système qu'on ne peut pas reprendre.
//
//   node scripts/supprimer-galeries-archivees.mjs                  # simulation
//   node scripts/supprimer-galeries-archivees.mjs --pour-de-vrai   # efface
//
// Les gardes ne sont PAS dans ce script : `media_retention_a_supprimer()` ne propose que ce qui est
// mûr et non protégé, et `media_retention_effacer()` revérifie tout avant d'effacer une seule ligne.
// Un script qui se fie à sa propre liste est un script qui efface ce qu'il a lu il y a dix minutes.

import { readFileSync } from "node:fs";

const POUR_DE_VRAI = process.argv.includes("--pour-de-vrai");
// `.env` vit a la racine de l'espace de travail, deux crans au-dessus de livrables/.
const RACINE = new URL("../../../", import.meta.url).pathname;
for (const ligne of readFileSync(`${RACINE}.env`, "utf8").split("\n")) {
  const m = ligne.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL_SB = process.env.SUPABASE_URL;
const CLE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_SB || !CLE) { console.error("SUPABASE_URL et SUPABASE_SECRET_KEY sont nécessaires."); process.exit(1); }

const enTete = { apikey: CLE, Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" };
const rpc = async (nom, corps = {}) => {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/${nom}`, { method: "POST", headers: enTete, body: JSON.stringify(corps) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${nom} : ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  return d;
};

const mures = await rpc("media_retention_a_supprimer");
if (!Array.isArray(mures) || mures.length === 0) {
  console.log("Aucune galerie mûre pour la suppression. Rien à faire.");
  process.exit(0);
}

const totalPhotos = mures.reduce((n, g) => n + (g.photos || 0), 0);
const totalFichiers = mures.reduce((n, g) => n + (g.chemins?.length || 0), 0);
console.log(`${mures.length} galerie(s) mûre(s) : ${totalPhotos} photos, ${totalFichiers} fichiers.\n`);
for (const g of mures) {
  console.log(`  ${g.titre}`);
  console.log(`    archivée le ${g.archivee_le} · ${g.photos} photos · ${g.chemins?.length || 0} fichiers`);
}

if (!POUR_DE_VRAI) {
  console.log("\nSIMULATION : rien n'a été effacé. Relance avec --pour-de-vrai pour exécuter.");
  process.exit(0);
}

// Le seau est le même pour toutes les photos privées ; les aperçus clairs vivent ailleurs et sont
// régénérables, on ne les traite pas ici.
const SEAU = "sportvision-media-prive";
let effacees = 0, fichiersEffaces = 0, refusees = 0;

for (const g of mures) {
  const chemins = g.chemins || [];
  // 1. LES FICHIERS D'ABORD. Par paquets : l'API du stockage accepte une liste, et un appel par
  //    fichier sur 4 000 photos prendrait la nuit.
  let echecFichier = null;
  for (let i = 0; i < chemins.length; i += 100) {
    const lot = chemins.slice(i, i + 100);
    const r = await fetch(`${URL_SB}/storage/v1/object/${SEAU}`, {
      method: "DELETE", headers: enTete, body: JSON.stringify({ prefixes: lot }),
    });
    if (!r.ok) { echecFichier = `${r.status} ${(await r.text()).slice(0, 160)}`; break; }
    fichiersEffaces += lot.length;
  }
  if (echecFichier) {
    console.log(`  ✗ ${g.titre} : le stockage a refusé (${echecFichier}). Les lignes sont CONSERVÉES.`);
    refusees++;
    continue;
  }

  // 2. LES LIGNES ENSUITE, et la base revérifie toutes les gardes avant d'écrire.
  const res = await rpc("media_retention_effacer", { p_album_id: g.album_id });
  if (res?.efface) { console.log(`  ✓ ${g.titre} : ${res.photos} photos effacées`); effacees++; }
  else { console.log(`  ✗ ${g.titre} : la base a refusé (${res?.raison}). Fichiers déjà partis.`); refusees++; }
}

console.log(`\n${effacees} galerie(s) effacée(s), ${fichiersEffaces} fichiers, ${refusees} refus.`);
