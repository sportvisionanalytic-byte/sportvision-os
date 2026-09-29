// LE NOUVEAU MOTEUR VAUT-IL MIEUX QUE L'ANCIEN ? On mesure sur la galerie reelle, pas sur une
// impression. Deux questions, et deux seulement :
//   1. combien de visages trouve-t-il, la ou l'ancien en trouvait 1,7 par photo ?
//   2. separe-t-il mieux deux personnes differentes d'une meme photo ?
import { readFileSync } from "node:fs";
import { visagesDe, distance, MODELE } from "./visages.mjs";

const env = Object.fromEntries(readFileSync("/Users/fouka/Downloads/jarvis-starter-kit/.env","utf8")
  .split("\n").filter(l=>l.includes("=")&&!l.trimStart().startsWith("#"))
  .map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));
const URL_SB=env.SUPABASE_URL, CLE=env.SUPABASE_SECRET_KEY;
const ent={apikey:CLE,Authorization:`Bearer ${CLE}`,"Content-Type":"application/json"};
const rest=async(c)=>(await fetch(`${URL_SB}/rest/v1/${c}`,{headers:ent})).json();
const signer=async(c)=>{const r=await fetch(`${URL_SB}/storage/v1/object/sign/sportvision-media-prive/${encodeURI(c)}`,
  {method:"POST",headers:ent,body:JSON.stringify({expiresIn:3600})});
  const j=await r.json().catch(()=>({}));const p=j.signedURL||j.signedUrl;
  return p?`${URL_SB}/storage/v1${p.startsWith("/")?"":"/"}${p}`:null;};

const ALBUM="5536bdea-34d8-47da-a889-82f3b3eef3af";
const COMBIEN=Number(process.argv[2]||10);
const photos=(await rest(`media_assets?select=id,preview_clair_path&album_id=eq.${ALBUM}&status=eq.ready&order=position`)).slice(0,COMBIEN);

console.log(`modele : ${MODELE}\n`);
console.log("photo | visages | scores | ms");
const tous=[];
let totalMs=0;
for (let i=0;i<photos.length;i++){
  const u=await signer(photos[i].preview_clair_path);
  if(!u) continue;
  const octets=Buffer.from(await (await fetch(u)).arrayBuffer());
  const t0=Date.now();
  const v=await visagesDe(octets,{seuil:0.5});
  const ms=Date.now()-t0; totalMs+=ms;
  v.forEach(x=>tous.push({photo:i+1, emp:x.empreinte}));
  console.log(`  ${i+1} | ${v.length} | ${v.map(x=>x.score.toFixed(2)).join(" ")||"-"} | ${ms}`);
}
console.log(`\n${tous.length} visages sur ${photos.length} photos, soit ${(tous.length/photos.length).toFixed(1)} par photo.`);
console.log(`Temps : ${Math.round(totalMs/1000)} s, soit ${Math.round(totalMs/photos.length)} ms par photo.`);

// La separation : deux personnes d'une MEME photo sont forcement differentes.
const memePhoto=[], autres=[];
for(let i=0;i<tous.length;i++) for(let j=i+1;j<tous.length;j++){
  const d=distance(tous[i].emp,tous[j].emp);
  (tous[i].photo===tous[j].photo?memePhoto:autres).push(d);
}
const stat=(a)=>{const s=[...a].sort((x,y)=>x-y);
  return s.length?`min ${s[0].toFixed(3)} | median ${s[Math.floor(s.length/2)].toFixed(3)}`:"—";};
console.log(`\nDEUX PERSONNES DIFFERENTES (meme photo), ${memePhoto.length} paires : ${stat(memePhoto)}`);
console.log(`PHOTOS DIFFERENTES (parfois la meme personne), ${autres.length} paires : ${stat(autres)}`);
const s2=[...autres].sort((a,b)=>a-b);
console.log(`  les 8 plus proches : ${s2.slice(0,8).map(x=>x.toFixed(3)).join(" ")}`);
const plancher=[...memePhoto].sort((a,b)=>a-b)[0] ?? 0;
console.log(`\nPlancher des « gens differents » : ${plancher.toFixed(3)}`);
console.log(`Paires d'autres photos SOUS ce plancher : ${autres.filter(d=>d<plancher).length}`);
