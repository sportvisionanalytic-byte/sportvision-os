// Regarder ce que la machine a vu : la photo de reference et les visages des photos confirmees.
import { readFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";
import { detecter, preparer } from "./visages.mjs";
const env=Object.fromEntries(readFileSync("/Users/fouka/Downloads/jarvis-starter-kit/.env","utf8")
  .split("\n").filter(l=>l.includes("=")&&!l.trimStart().startsWith("#"))
  .map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));
const URL_SB=env.SUPABASE_URL, CLE=env.SUPABASE_SECRET_KEY;
const ent={apikey:CLE,Authorization:`Bearer ${CLE}`,"Content-Type":"application/json"};
const rest=async(c)=>(await fetch(`${URL_SB}/rest/v1/${c}`,{headers:ent})).json();
const signer=async(c)=>{const r=await fetch(`${URL_SB}/storage/v1/object/sign/sportvision-media-prive/${encodeURI(c)}`,
  {method:"POST",headers:ent,body:JSON.stringify({expiresIn:3600})});
  const j=await r.json().catch(()=>({}));const p=j.signedURL||j.signedUrl;return `${URL_SB}/storage/v1${p.startsWith("/")?"":"/"}${p}`;};
const charger=async(c)=>Buffer.from(await (await fetch(await signer(c))).arrayBuffer());
const SORTIE="/private/tmp/claude-501/-Users-fouka-Downloads-jarvis-starter-kit/59ff72cf-ae1f-4672-b48a-f7cb200fed91/scratchpad/verite";
mkdirSync(SORTIE,{recursive:true});
const JOUEUR="4ffcdc0b-e0e8-469d-b257-a4ca0c4eda62";
await preparer();

async function decouper(octets, nom){
  const v=await detecter(octets,{seuil:0.3,cote:1920});
  const meta=await sharp(octets).metadata();
  for(let i=0;i<v.length;i++){
    const [x,y,w,h]=v[i].boite, m=Math.max(w,h)*0.35;
    await sharp(octets).extract({
      left:Math.max(0,Math.round(x-m)), top:Math.max(0,Math.round(y-m)),
      width:Math.min(meta.width-Math.max(0,Math.round(x-m)), Math.round(w+2*m)),
      height:Math.min(meta.height-Math.max(0,Math.round(y-m)), Math.round(h+2*m)),
    }).resize(200,200,{fit:"cover"}).jpeg({quality:88}).toFile(`${SORTIE}/${nom}-v${i+1}.jpg`);
  }
  return v.length;
}

const refs=await rest(`player_face_refs?select=storage_path&player_id=eq.${JOUEUR}`);
console.log("reference :", await decouper(await charger(refs[0].storage_path), "reference"), "visage(s)");

const tags=await rest(`media_player_tags?select=media_ref_id&player_id=eq.${JOUEUR}&media_ref_type=eq.media_asset&statut=eq.valide`);
let k=0;
for(const t of tags){
  const a=(await rest(`media_assets?select=preview_clair_path&id=eq.${t.media_ref_id}`))[0];
  if(!a) continue;
  k++;
  console.log(`confirmee ${k} :`, await decouper(await charger(a.preview_clair_path), `confirmee${k}`), "visage(s)");
}
