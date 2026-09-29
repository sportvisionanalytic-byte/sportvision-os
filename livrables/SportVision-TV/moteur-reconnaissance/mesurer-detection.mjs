// COMBIEN DE VISAGES SELON LA RESOLUTION ET LE SEUIL ?
// Le nouveau detecteur est quinze fois plus rapide : on peut lui donner une image bien plus
// grande, et c'est exactement ce qu'il faut pour un visage au fond du terrain.
import { readFileSync } from "node:fs";
import { detecter, preparer } from "./visages.mjs";
const env=Object.fromEntries(readFileSync("/Users/fouka/Downloads/jarvis-starter-kit/.env","utf8")
  .split("\n").filter(l=>l.includes("=")&&!l.trimStart().startsWith("#"))
  .map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));
const URL_SB=env.SUPABASE_URL, CLE=env.SUPABASE_SECRET_KEY;
const ent={apikey:CLE,Authorization:`Bearer ${CLE}`,"Content-Type":"application/json"};
const rest=async(c)=>(await fetch(`${URL_SB}/rest/v1/${c}`,{headers:ent})).json();
const signer=async(c)=>{const r=await fetch(`${URL_SB}/storage/v1/object/sign/sportvision-media-prive/${encodeURI(c)}`,
  {method:"POST",headers:ent,body:JSON.stringify({expiresIn:3600})});
  const j=await r.json().catch(()=>({}));const p=j.signedURL||j.signedUrl;
  return `${URL_SB}/storage/v1${p.startsWith("/")?"":"/"}${p}`;};
const photos=(await rest(`media_assets?select=preview_clair_path&album_id=eq.5536bdea-34d8-47da-a889-82f3b3eef3af&status=eq.ready&order=position`)).slice(0,8);
await preparer();
const images=[];
for(const p of photos) images.push(Buffer.from(await (await fetch(await signer(p.preview_clair_path))).arrayBuffer()));
console.log("cote | seuil | visages | ms/photo");
for(const cote of [640, 1280, 1920]){
  for(const seuil of [0.5, 0.3]){
    let n=0; const t0=Date.now();
    for(const im of images) n += (await detecter(im,{seuil,cote})).length;
    console.log(`${String(cote).padStart(4)} | ${seuil} | ${String(n).padStart(3)} | ${Math.round((Date.now()-t0)/images.length)}`);
  }
}
console.log(`\n(l'ancien moteur : 9 visages sur ces 8 photos, 5 500 ms chacune)`);
