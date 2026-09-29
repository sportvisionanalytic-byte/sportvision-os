// L'ACCUMULATION, FAITE CORRECTEMENT.
//
// Fouka : « chaque photo qu'il y a dans les galeries devient une photo de reference supplementaire.
// Lui ne le voit pas, mais nous ca nous fait plus de matiere pour le retrouver. »
//
// LE PIEGE, mesure avant de construire : sur une photo confirmee ou l'enfant n'est pas seul, on ne
// sait pas lequel des visages est le sien. Ajouter les trois sans choisir, c'est ajouter deux
// inconnus comme references — et la reconnaissance se met a ramasser tout le monde. Premiere
// mesure : 3 photos confirmees ont produit 31 references, et 73 photos sur 92 passaient le seuil.
//
// ON CHOISIT DONC LE BON VISAGE : sur chaque photo confirmee, celui qui ressemble le plus a ce
// qu'on connait deja de l'enfant. Et on le fait DANS L'ORDRE des distances — la photo la plus sure
// d'abord — pour que chaque ajout s'appuie sur des references deja fiables.
import { readFileSync } from "node:fs";
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
const CACHE="/private/tmp/claude-501/-Users-fouka-Downloads-jarvis-starter-kit/59ff72cf-ae1f-4672-b48a-f7cb200fed91/scratchpad/empreintes-galerie.json";
await preparer();
const galerie=JSON.parse(readFileSync(CACHE,"utf8"));
const refs=await rest(`player_face_refs?select=storage_path&player_id=eq.${JOUEUR}`);
const vRef=await visagesDe(await charger(refs[0].storage_path), {seuil:0.3, cote:1920});
const tags=await rest(`media_player_tags?select=media_ref_id&player_id=eq.${JOUEUR}&media_ref_type=eq.media_asset&statut=eq.valide`);
const confirmees=[...new Set(tags.map(t=>t.media_ref_id))];

const parPhoto=new Map();
for(const g of galerie){ if(!parPhoto.has(g.asset)) parPhoto.set(g.asset,[]); parPhoto.get(g.asset).push(g.emp); }

/** Sur chaque photo confirmee, le visage le plus proche de ce qu'on connait deja. On avance dans
 *  l'ordre de proximite : la photo la plus sure sert a choisir sur la suivante. */
function accumuler(depart, photos, plafond=Infinity){
  let refs=[...depart];
  const candidats=photos
    .map(a=>({a, d:Math.min(...(parPhoto.get(a)||[[]]).map(e=>Math.min(...refs.map(r=>distance(r,e)))))}))
    .sort((x,y)=>x.d-y.d);
  for(const {a} of candidats){
    const visages=parPhoto.get(a)||[];
    if(!visages.length) continue;
    let best=null, bd=Infinity;
    for(const e of visages){
      const d=Math.min(...refs.map(r=>distance(r,e)));
      if(d<bd){ bd=d; best=e; }
    }
    // UN VISAGE TROP LOIN N'EST PAS LE SIEN, meme sur une photo confirmee : c'est un autre joueur
    // de la meme image. Sans ce plafond, on apprend le visage du voisin.
    if(best && bd<plafond) refs.push(best);
  }
  return refs;
}

function resume(titre, refs){
  const c=[...parPhoto].map(([a,es])=>({a, d:Math.min(...es.map(e=>Math.min(...refs.map(r=>distance(r,e))))),
    confirmee:confirmees.includes(a)})).sort((x,y)=>x.d-y.d);
  const conf=c.filter(x=>x.confirmee);
  console.log(`\n${titre} — ${refs.length} reference(s)`);
  console.log(`  rangs des 3 confirmees : ${conf.map(x=>c.indexOf(x)+1).join(", ")} sur ${c.length}`);
  for(const s of [1.0,1.1,1.2]) console.log(`  sous ${s.toFixed(1)} : ${String(c.filter(x=>x.d<s).length).padStart(3)} photos`);
}

resume("LA SEULE PHOTO DE REFERENCE", [vRef[0].empreinte]);
resume("TOUS LES VISAGES DES PHOTOS CONFIRMEES (naif)",
  [vRef[0].empreinte, ...confirmees.flatMap(a=>parPhoto.get(a)||[])]);
resume("LE BON VISAGE SEULEMENT, sans plafond",
  accumuler([vRef[0].empreinte], confirmees));
for(const plafond of [1.1, 1.24]){
  resume(`LE BON VISAGE, plafond ${plafond}`,
    accumuler([vRef[0].empreinte], confirmees, plafond));
}
