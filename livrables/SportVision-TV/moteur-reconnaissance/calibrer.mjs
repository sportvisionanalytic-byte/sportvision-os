// OU PLACER LE SEUIL, AVEC LE NOUVEAU MODELE ?
//
// Les seuils du produit (0,42 et 0,55) appartiennent a l'ANCIEN espace d'empreintes. ArcFace
// travaille dans un autre : ses distances n'ont pas la meme echelle, et reprendre les anciens
// chiffres serait exactement la faute du 28/09 — mesurer dans une unite, trancher dans une autre.
//
// On calcule donc l'empreinte de reference de Nathan avec le NOUVEAU modele, puis sa distance a
// chacun des visages de la galerie. Les photos que Fouka a deja tranchees a la main donnent la
// verite : on regarde ou tombent les « c'est moi » et les « ce n'est pas moi ».
import { readFileSync } from "node:fs";
import { visagesDe, distance, MODELE, preparer } from "./visages.mjs";

const env=Object.fromEntries(readFileSync("/Users/fouka/Downloads/jarvis-starter-kit/.env","utf8")
  .split("\n").filter(l=>l.includes("=")&&!l.trimStart().startsWith("#"))
  .map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));
const URL_SB=env.SUPABASE_URL, CLE=env.SUPABASE_SECRET_KEY;
const ent={apikey:CLE,Authorization:`Bearer ${CLE}`,"Content-Type":"application/json"};
const rest=async(c)=>(await fetch(`${URL_SB}/rest/v1/${c}`,{headers:ent})).json();
const signer=async(c)=>{const r=await fetch(`${URL_SB}/storage/v1/object/sign/sportvision-media-prive/${encodeURI(c)}`,
  {method:"POST",headers:ent,body:JSON.stringify({expiresIn:3600})});
  const j=await r.json().catch(()=>({}));const p=j.signedURL||j.signedUrl;
  return p?`${URL_SB}/storage/v1${p.startsWith("/")?"":"/"}${p}`:null;};
const charger=async(chemin)=>Buffer.from(await (await fetch(await signer(chemin))).arrayBuffer());

const JOUEUR="4ffcdc0b-e0e8-469d-b257-a4ca0c4eda62";
const ALBUM="5536bdea-34d8-47da-a889-82f3b3eef3af";
const REGLAGE={seuil:0.3, cote:1920};

await preparer();
console.log(`modele : ${MODELE}, detection a ${REGLAGE.cote} px seuil ${REGLAGE.seuil}\n`);

// 1. La photo de reference.
const refs=await rest(`player_face_refs?select=storage_path&player_id=eq.${JOUEUR}`);
const vRef=await visagesDe(await charger(refs[0].storage_path), REGLAGE);
if(vRef.length!==1){ console.log(`reference : ${vRef.length} visage(s), on ne devine pas`); process.exit(1); }
console.log(`reference : 1 visage, confiance ${vRef[0].score}`);

// 2. Ce que Fouka a tranche a la main.
const tags=await rest(`media_player_tags?select=media_ref_id,statut&player_id=eq.${JOUEUR}&media_ref_type=eq.media_asset`);
const verdict=new Map(tags.map(t=>[t.media_ref_id,t.statut]));
console.log(`verite connue : ${[...verdict.values()].filter(v=>v==='valide').length} « c'est moi », ${[...verdict.values()].filter(v=>v==='rejete').length} « ce n'est pas moi »\n`);

// 3. Toutes les photos.
const photos=await rest(`media_assets?select=id,preview_clair_path&album_id=eq.${ALBUM}&status=eq.ready&order=position`);
const lignes=[];
let nVisages=0;
const t0=Date.now();
for(let i=0;i<photos.length;i++){
  if(i%20===0) process.stdout.write(`  photo ${i+1}/${photos.length}…\r`);
  try{
    const v=await visagesDe(await charger(photos[i].preview_clair_path), REGLAGE);
    nVisages+=v.length;
    if(!v.length) continue;
    const d=Math.min(...v.map(x=>distance(vRef[0].empreinte,x.empreinte)));
    lignes.push({id:photos[i].id, d, verdict:verdict.get(photos[i].id)||null});
  }catch(e){ /* une photo illisible n'arrete pas la mesure */ }
}
console.log(`  ${nVisages} visages sur ${photos.length} photos (${(nVisages/photos.length).toFixed(1)} par photo), en ${Math.round((Date.now()-t0)/1000)} s\n`);

lignes.sort((a,b)=>a.d-b.d);
const marque=(v)=>v==='valide'?'  ✅ c\'est moi':v==='rejete'?'  ❌ pas moi':'';
console.log("les 30 plus proches de la reference :");
lignes.slice(0,30).forEach((l,i)=>console.log(`  ${String(i+1).padStart(2)}  ${l.d.toFixed(3)}${marque(l.verdict)}`));

const oui=lignes.filter(l=>l.verdict==='valide').map(l=>l.d);
const non=lignes.filter(l=>l.verdict==='rejete').map(l=>l.d);
const st=(a)=>a.length?`${Math.min(...a).toFixed(3)} a ${Math.max(...a).toFixed(3)}`:'—';
console.log(`\n« c'est moi » (${oui.length}) : ${st(oui)}`);
console.log(`« pas moi »  (${non.length}) : ${st(non)}`);
if(oui.length&&non.length){
  const frontiere=(Math.max(...oui)+Math.min(...non))/2;
  console.log(`\nfrontiere entre les deux : ${frontiere.toFixed(3)}`);
  console.log(`photos sous cette frontiere : ${lignes.filter(l=>l.d<frontiere).length} sur ${photos.length}`);
}
