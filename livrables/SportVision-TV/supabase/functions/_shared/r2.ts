// Parler à Cloudflare R2, qui parle le dialecte S3 (24/09/2026).
//
// POURQUOI LES PHOTOS DÉMÉNAGENT
//
// Mesuré le 23/09 sur la production : 2 085 photos, 38 Go, 19 Mo la photo en moyenne, et
// 20 Go de plus par semaine avec trois clubs seulement. À ce rythme, une saison représente
// 800 Go pour trois clubs, 1,3 To pour cinq. Le plan gratuit de Supabase a coupé tout
// l'écosystème le 24/09 à minuit — plus aucune connexion nulle part, pendant la relecture Apple.
//
// Supabase reste ce qu'il fait le mieux : la base, les comptes, les droits, les aperçus. Mais
// c'est un mauvais disque dur, et surtout il facture chaque téléchargement. R2 coûte moitié
// moins au gigaoctet et NE FACTURE PAS la sortie, ce qui correspond exactement à notre usage :
// des familles qui téléchargent des galeries entières.
//
// CE MODULE NE DÉPLACE RIEN TOUT SEUL. Chaque photo porte déjà sa colonne `storage_bucket` :
// les anciennes disent « sportvision-media-prive » et continuent de vivre sur Supabase, les
// nouvelles diront « r2 ». La bascule se fait donc galerie par galerie, sans jour J, sans
// migration massive, et sans qu'une famille s'aperçoive de quoi que ce soit.
//
// LA SIGNATURE EST ÉCRITE À LA MAIN, et c'est volontaire. Une bibliothèque de plus dans une
// fonction qui manipule des clés secrètes, c'est une surface d'attaque de plus et une dépendance
// qui peut disparaître. AWS Signature v4 tient en soixante lignes, et on sait exactement ce qui
// part sur le réseau.

const encodeur = new TextEncoder();

/** Le nom que portent en base les photos rangées sur R2. */
export const SEAU_R2 = "r2";

/** Le seau historique, sur Supabase. Les photos d'avant le 24/09 y restent. */
export const SEAU_SUPABASE = "sportvision-media-prive";

export function estSurR2(bucket: string | null | undefined): boolean {
  return (bucket ?? "") === SEAU_R2;
}

interface ReglagesR2 {
  compte: string;
  cleId: string;
  secret: string;
  seau: string;
}

/**
 * Les réglages, ou rien.
 *
 * Rend `null` quand R2 n'est pas configuré, au lieu de lever une erreur : une fonction qui sert
 * surtout des photos Supabase ne doit pas tomber en panne parce que R2 n'est pas branché.
 */
export function reglagesR2(): ReglagesR2 | null {
  const compte = Deno.env.get("R2_ACCOUNT_ID") ?? "";
  const cleId = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
  const secret = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
  const seau = Deno.env.get("R2_BUCKET") ?? "sportvision-medias";
  if (!compte || !cleId || !secret) return null;
  return { compte, cleId, secret, seau };
}

async function sha256(donnees: Uint8Array | string): Promise<string> {
  const octets = typeof donnees === "string" ? encodeur.encode(donnees) : donnees;
  const empreinte = await crypto.subtle.digest("SHA-256", octets as BufferSource);
  return [...new Uint8Array(empreinte)].map((o) => o.toString(16).padStart(2, "0")).join("");
}

async function hmac(cle: Uint8Array, message: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw", cle as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, encodeur.encode(message)));
}

/**
 * Encoder un chemin comme AWS l'exige, segment par segment, barres obliques préservées.
 *
 * `encodeURIComponent` ne suffit pas : il laisse passer ! ' ( ) *, que la RFC 3986 classe parmi
 * les caractères réservés et qu'AWS attend encodés. Un seul d'entre eux dans un nom de fichier et
 * la signature est refusée. Trouvé le 24/09 en testant « photo d'équipe.txt » — et une apostrophe
 * dans un nom de photo, chez un photographe français, ce n'est pas un cas tordu, c'est mardi.
 *
 * Le même encodeur sert au chemin ET aux paramètres de requête : le 24/09, l'apostrophe de
 * « essai d'équipe.txt » passait dans response-content-disposition et faisait refuser la
 * signature, alors que le chemin, lui, était déjà correct. Un seul encodeur, une seule règle.
 *
 * Le même résultat sert à signer ET à construire l'adresse appelée : signer une chaîne et en
 * envoyer une autre est l'autre moitié du piège.
 */
function encodeStrict(valeur: string): string {
  return encodeURIComponent(valeur).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function cheminEncode(chemin: string): string {
  return chemin.split("/").map(encodeStrict).join("/");
}

async function cleDeSignature(secret: string, jour: string): Promise<Uint8Array> {
  let k = await hmac(encodeur.encode("AWS4" + secret), jour);
  k = await hmac(k, "auto");   // R2 n'a qu'une région logique
  k = await hmac(k, "s3");
  return await hmac(k, "aws4_request");
}

/**
 * Une requête signée, en-têtes compris. Pour ce que la fonction fait elle-même : déposer un
 * fichier, en lire un, en supprimer un.
 */
export async function signerRequete(
  r: ReglagesR2, methode: string, chemin: string,
  corps: Uint8Array | string = "", typeContenu?: string,
): Promise<{ url: string; entetes: Headers }> {
  const hote = `${r.compte}.r2.cloudflarestorage.com`;
  const cheminComplet = `/${r.seau}/${chemin.replace(/^\//, "")}`;
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const jour = stamp.slice(0, 8);
  const empreinte = await sha256(corps);

  const entetes: Record<string, string> = {
    host: hote,
    "x-amz-content-sha256": empreinte,
    "x-amz-date": stamp,
  };
  if (typeContenu) entetes["content-type"] = typeContenu;

  const noms = Object.keys(entetes).sort();
  const canonique = [
    methode, cheminEncode(cheminComplet), "",
    noms.map((n) => `${n}:${entetes[n]}\n`).join(""),
    noms.join(";"), empreinte,
  ].join("\n");

  const portee = `${jour}/auto/s3/aws4_request`;
  const aSigner = ["AWS4-HMAC-SHA256", stamp, portee, await sha256(canonique)].join("\n");
  const signature = [...await hmac(await cleDeSignature(r.secret, jour), aSigner)]
    .map((o) => o.toString(16).padStart(2, "0")).join("");

  const sortie = new Headers();
  for (const [n, v] of Object.entries(entetes)) if (n !== "host") sortie.set(n, v);
  sortie.set("Authorization",
    `AWS4-HMAC-SHA256 Credential=${r.cleId}/${portee}, SignedHeaders=${noms.join(";")}, `
    + `Signature=${signature}`);

  // L'adresse rendue porte le chemin ENCODE, le meme que celui qui vient d'etre signe.
  // Rendre le chemin brut laisserait fetch l'encoder a sa facon, et la signature tomberait.
  return { url: `https://${hote}${cheminEncode(cheminComplet)}`, entetes: sortie };
}

/**
 * Une adresse de téléchargement à durée limitée, que le navigateur d'une famille ouvre seul.
 *
 * C'est la pièce qui compte pour le coût : le fichier part de Cloudflare directement vers la
 * famille, sans repasser par Supabase ni par cette fonction. Aucune sortie facturée, et une
 * fonction serveur qui ne porte pas 19 Mo dans sa mémoire.
 *
 * `nomFichier` force le nom enregistré sur le téléphone : sans lui, une photo s'appellerait
 * « 3f2a8b1c » et une galerie entière deviendrait illisible dans la pellicule.
 *
 * En PUT, la même mécanique sert au DÉPÔT : le navigateur de l'opérateur envoie la photo
 * directement à Cloudflare, sans que les 19 Mo traversent une fonction serveur — qui ne
 * tiendrait de toute façon pas la charge d'une galerie de cinq cents photos. Les clés R2, elles,
 * ne quittent jamais le serveur : c'est tout l'intérêt d'une adresse signée.
 */
export async function urlSigneeR2(
  r: ReglagesR2, chemin: string, secondes = 3600, nomFichier?: string,
  methode: "GET" | "PUT" = "GET",
): Promise<string> {
  const hote = `${r.compte}.r2.cloudflarestorage.com`;
  const cheminComplet = `/${r.seau}/${chemin.replace(/^\//, "")}`;
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const jour = stamp.slice(0, 8);
  const portee = `${r.cleId}/${jour}/auto/s3/aws4_request`;

  const parametres = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": portee,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(secondes),
    "X-Amz-SignedHeaders": "host",
  });
  if (nomFichier) {
    // Les guillemets et les barres obliques casseraient l'en-tête : on ne garde que ce qui fait
    // un nom de fichier.
    const propre = nomFichier.replace(/["\\/\r\n]/g, "-");
    parametres.set("response-content-disposition", `attachment; filename="${propre}"`);
  }

  // Les paramètres doivent être triés par nom : la signature porte sur la chaîne exacte, et un
  // ordre différent donne une signature différente.
  const requete = [...parametres.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeStrict(k)}=${encodeStrict(v)}`)
    .join("&");

  const canonique = [
    methode, cheminEncode(cheminComplet), requete,
    `host:${hote}\n`, "host", "UNSIGNED-PAYLOAD",
  ].join("\n");

  const aSigner = [
    "AWS4-HMAC-SHA256", stamp, `${jour}/auto/s3/aws4_request`, await sha256(canonique),
  ].join("\n");
  const signature = [...await hmac(await cleDeSignature(r.secret, jour), aSigner)]
    .map((o) => o.toString(16).padStart(2, "0")).join("");

  return `https://${hote}${cheminEncode(cheminComplet)}?${requete}&X-Amz-Signature=${signature}`;
}
