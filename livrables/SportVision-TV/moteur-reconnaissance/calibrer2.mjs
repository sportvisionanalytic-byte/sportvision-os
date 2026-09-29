// CE QUE CHANGE L'ACCUMULATION DES REFERENCES.
//
// Avec UNE photo de reference, les trois photos que Fouka a confirmees tombent a 0,384, 1,124 et
// 1,207 : la premiere est evidente, les deux autres sont noyees dans la masse des inconnus, qui
// commence vers 1,2. Une seule photo ne couvre qu'un angle.
//
// Fouka : « plus il met des photos, plus tu reconnais la personne ». On mesure exactement ca : on
// ajoute les visages des photos CONFIRMEES comme references supplementaires, et on regarde si les
// autres photos se rapprochent. C'est le mecanisme de la v334, et voici ce qu'il vaut.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { visagesDe, distance, preparer } from "./visages.mjs";
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
const charger=async(c)=>Buffer.from(await (await fetch(await signer(c))).arrayBuffer());

const JOUEUR="4ffcdc0b-e0e8-469d-b257-a4ca0c4eda62";
const ALBUM="5536bdea-34d8-47da-a889-82f3b3eef3af";
const REGLAGE={seuil:0.3, cote:1920};
const CACHE="/private/tmp/claude-501/-Users-fouka-Downloads-jarvis-starter-kit/59ff72cf-ae1f-4672-b48a-f7cb200fed91/scratchpad/empreintes-galerie.json";

await preparer();

// On garde les empreintes de la galerie : quatre minutes de calcul qu'on ne refait pas a chaque essai.
let galerie;
if (existsSync(CACHE)) {
  galerie = JSON.parse(readFileSync(CACHE, "utf8"));
  console.log(`empreintes relues du cache : ${galerie.length} visages\n`);
} else {
  const photos=await rest(`media_assets?select=id,preview_clair_path&album_id=eq.${ALBUM}&status=eq.ready&order=position`);
  galerie=[];
  for(let i=0;i<photos.length;i++){
    if(i%20===0) process.stdout.write(`  photo ${i+1}/${photos.length}…\r`);
    try{
      for(const v of await visagesDe(await charger(photos[i].preview_clair_path), REGLAGE))
        galerie.push({asset:photos[i].id, emp:v.empreinte});
    }catch{}
  }
  writeFileSync(CACHE, JSON.stringify(galerie));
  console.log(`  ${galerie.length} visages releves et gardes en cache\n`);
}

const refs=await rest(`player_face_refs?select=storage_path&player_id=eq.${JOUEUR}`);
const vRef=await visagesDe(await charger(refs[0].storage_path), REGLAGE);
const tags=await rest(`media_player_tags?select=media_ref_id,statut&player_id=eq.${JOUEUR}&media_ref_type=eq.media_asset&statut=eq.valide`);
const confirmees=new Set(tags.map(t=>t.media_ref_id));

// Par photo, la distance a l'ENSEMBLE des references : c'est ce que fait la base avec min().
function classement(references){
  const parPhoto=new Map();
  for(const g of galerie){
    const d=Math.min(...references.map(r=>distance(r,g.emp)));
    if(!parPhoto.has(g.asset) || d<parPhoto.get(g.asset)) parPhoto.set(g.asset,d);
  }
  return [...parPhoto].map(([asset,d])=>({asset,d,confirmee:confirmees.has(asset)})).sort((a,b)=>a.d-b.d);
}

function resume(titre, references){
  const c=classement(references);
  const conf=c.filter(x=>x.confirmee);
  const rangs=conf.map(x=>c.indexOf(x)+1);
  console.log(`\n${titre} (${references.length} reference${references.length>1?"s":""})`);
  console.log(`  photos confirmees : distances ${conf.map(x=>x.d.toFixed(3)).join(", ")}`);
  console.log(`  leurs rangs       : ${rangs.join(", ")} sur ${c.length} photos`);
  for(const s of [1.0, 1.1, 1.2]){
    const n=c.filter(x=>x.d<s).length;
    const bonnes=c.filter(x=>x.d<s&&x.confirmee).length;
    console.log(`  sous ${s.toFixed(1)} : ${String(n).padStart(3)} photos, dont ${bonnes}/${conf.length} confirmees`);
  }
  return c;
}

const base=[vRef[0].empreinte];
resume("AVEC LA SEULE PHOTO DE REFERENCE", base);

// On ajoute les visages des photos confirmees — c'est ce que fait la v334 apres un « c'est moi ».
const enPlus=[];
for(const g of galerie) if(confirmees.has(g.asset)) enPlus.push(g.emp);
resume("EN AJOUTANT LES PHOTOS CONFIRMEES", base.concat(enPlus));
