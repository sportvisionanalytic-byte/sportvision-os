// CE QUE DONNE LE REGROUPEMENT, sur les 284 visages deja releves et gardes en cache.
// Deux questions : combien de personnes distinctes trouve-t-on, et la grappe de Nathan contient-
// elle bien SES photos et seulement elles ?
import { readFileSync } from "node:fs";
import { regrouper } from "./grappes.mjs";
import { visagesDe, distance, preparer } from "./visages.mjs";
const env=Object.fromEntries(readFileSync("/Users/fouka/Downloads/jarvis-starter-kit/.env","utf8")
  .split("\n").filter(l=>l.includes("=")&&!l.trimStart().startsWith("#"))
  .map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));
const URL_SB=env.SUPABASE_URL, CLE=env.SUPABASE_SECRET_KEY;
const ent={apikey:CLE,Authorization:`Bearer ${CLE}`,"Content-Type":"application/json"};
const rest=async(c)=>(await fetch(`${URL_SB}/rest/v1/${c}`,{headers:ent})).json();
const signer=async(c)=>{const r=await fetch(`${URL_SB}/storage/v1/object/sign/sportvision-media-prive/${encodeURI(c)}`,
  {method:"POST",headers:ent,body:JSON.stringify({expiresIn:3600})});
  const j=await r.json().catch(()=>({}));const p=j.signedURL||j.signedUrl;return `${URL_SB}/storage/v1${p.startsWith("/")?"":"/"}${p}`;};
const CACHE="/private/tmp/claude-501/-Users-fouka-Downloads-jarvis-starter-kit/59ff72cf-ae1f-4672-b48a-f7cb200fed91/scratchpad/empreintes-galerie.json";
const JOUEUR="4ffcdc0b-e0e8-469d-b257-a4ca0c4eda62";

const brut=JSON.parse(readFileSync(CACHE,"utf8"));
const visages=brut.map((v,i)=>({cle:i, asset:v.asset, emp:v.emp}));
console.log(`${visages.length} visages, sur ${new Set(visages.map(v=>v.asset)).size} photos.\n`);

await preparer();
const refs=await rest(`player_face_refs?select=storage_path&player_id=eq.${JOUEUR}`);
const vRef=await visagesDe(Buffer.from(await (await fetch(await signer(refs[0].storage_path))).arrayBuffer()),{seuil:0.2,cote:1920});
const reference=vRef[0].empreinte;
const tags=await rest(`media_player_tags?select=media_ref_id&player_id=eq.${JOUEUR}&media_ref_type=eq.media_asset&statut=eq.valide`);
const confirmees=new Set(tags.map(t=>t.media_ref_id));

for(const seuil of [0.8, 0.9, 1.0, 1.1]){
  const g=regrouper(visages,{seuilFusion:seuil});
  const grandes=g.filter(x=>x.membres.length>=2);
  // La grappe de Nathan : celle dont le centre est le plus proche de sa photo de reference.
  let sienne=null, best=Infinity;
  for(const x of g){ const d=distance(reference,x.centre); if(d<best){best=d;sienne=x;} }
  const sesPhotos=new Set(sienne.membres.map(m=>m.asset));
  const retrouvees=[...confirmees].filter(a=>sesPhotos.has(a)).length;
  console.log(`seuil ${seuil.toFixed(1)} : ${g.length} grappes (${grandes.length} a 2+ visages)`);
  console.log(`   sa grappe : ${sienne.membres.length} visages sur ${sesPhotos.size} photos, `
    + `distance a sa reference ${best.toFixed(3)}, cohesion ${sienne.cohesion.toFixed(3)}`);
  console.log(`   dont ${retrouvees}/${confirmees.size} des photos qu'il a confirmees a la main`);
}
