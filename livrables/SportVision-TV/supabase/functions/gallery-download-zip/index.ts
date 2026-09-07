// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
//
// Supabase Edge Function — gallery-download-zip
// 07/09/2026 : « tout télécharger » depuis la page de commande.
//
// ── Pourquoi une archive, et pas une boucle de téléchargements ──
// Déclencher N téléchargements à la suite depuis le navigateur ne marche pas : Chrome demande une
// autorisation dès le deuxième fichier, et Safari sur iPhone les refuse simplement. Un parent
// avec 40 photos se retrouverait à cliquer 40 fois. Une archive, c'est un fichier, un clic.
//
// ── Pourquoi en GET, et pas via functions.invoke ──
// `invoke` ramène la réponse en mémoire JavaScript avant de la donner à l'utilisateur : une
// archive de 400 Mo ferait tomber l'onglet d'un téléphone. En navigation directe, c'est le
// navigateur qui reçoit le flux et l'écrit sur le disque au fur et à mesure, comme n'importe quel
// téléchargement. C'est aussi pour ça que la fonction est déployée sans vérification de JWT : une
// navigation ne peut pas porter d'en-tête. Le jeton EST le droit, exactement comme pour
// gallery-download, et il est revérifié ici de la même façon.
//
// ── Pourquoi en flux, et pas un ZIP construit puis renvoyé ──
// Assembler l'archive en mémoire avant de l'envoyer imposerait de tenir toute la commande en RAM.
// On écrit donc l'archive au fil de l'eau : chaque photo est lue depuis le stockage et recopiée
// directement dans la sortie. La mémoire utilisée reste celle d'UNE photo, que la commande en
// contienne 3 ou 80.
//
// Méthode « stockage » et non « dégonflé » : un JPEG est déjà compressé, le recompresser coûterait
// du temps de calcul pour gagner 1 %. L'archive sert à regrouper, pas à réduire.
//
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Découpage en plusieurs archives au-delà de ces seuils. Ce n'est pas la mémoire qui les impose
 * (l'écriture est en flux) mais le temps : la fonction reste ouverte tant que le navigateur
 * télécharge, et un parent en 4G à 2 Mo/s met déjà quatre minutes pour 500 Mo. Au-delà, mieux
 * vaut plusieurs archives qui aboutissent qu'une seule qui se coupe à 80 %. */
const MAX_FICHIERS = 80;
const MAX_OCTETS = 500 * 1024 * 1024;

/** Signature courte : elle ne sert qu'à la lecture interne, ici, tout de suite. */
const TTL_LECTURE = 900;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Écriture ZIP ────────────────────────────────────────────────────────────────────────────
// Format « stockage », en-têtes ZIP32, tailles et CRC écrits APRÈS chaque fichier (descripteur de
// données, drapeau bit 3). C'est ce drapeau qui rend l'écriture en flux possible : sans lui, il
// faudrait connaître le CRC du fichier avant de l'écrire, donc l'avoir lu entièrement d'abord.
// ZIP32 suffit : le plafond de 500 Mo par archive est très en dessous des 4 Go de la limite.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(crc: number, data: Uint8Array): number {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function octets(...vals: [number, 1 | 2 | 4][]): Uint8Array {
  const taille = vals.reduce((n, [, w]) => n + w, 0);
  const buf = new Uint8Array(taille);
  const vue = new DataView(buf.buffer);
  let o = 0;
  for (const [v, w] of vals) {
    if (w === 1) vue.setUint8(o, v);
    else if (w === 2) vue.setUint16(o, v, true);
    else vue.setUint32(o, v >>> 0, true);
    o += w;
  }
  return buf;
}

/** Date MS-DOS. Une archive dont tous les fichiers sont datés de 1980 a l'air cassée dans le
 * Finder ; on met l'heure de fabrication, faute de mieux. */
function dateDos(d: Date): { heure: number; jour: number } {
  return {
    heure: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
    jour: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim();
    const partie = Math.max(0, parseInt(url.searchParams.get("partie") || "0", 10) || 0);
    if (!token) return json({ error: "Lien de téléchargement invalide." }, 400);

    // ── Le même contrôle que pour une photo seule ─────────────────────────────────────────
    // Rien n'est allégé parce qu'on télécharge en lot : jeton valide, droit non expiré, commande
    // payée, et on ne prend QUE les photos de cette commande.
    const { data: grant } = await admin
      .from("media_download_grants")
      .select("id, order_id, expires_at, download_count, max_downloads")
      .eq("token", token)
      .maybeSingle();
    if (!grant) return json({ error: "Lien de téléchargement invalide." }, 404);

    if (grant.expires_at && new Date(grant.expires_at as string).getTime() < Date.now()) {
      return json({ error: "Ce lien a expiré.", expired: true }, 410);
    }
    if (grant.max_downloads && (grant.download_count as number) >= (grant.max_downloads as number)) {
      return json({ error: "Nombre de téléchargements atteint." }, 429);
    }

    const { data: order } = await admin
      .from("media_orders")
      .select("id, album_id, status")
      .eq("id", grant.order_id as string)
      .maybeSingle();
    if (!order || order.status !== "paid") return json({ error: "Cette commande n'est pas payée." }, 402);

    const { data: items } = await admin
      .from("media_order_items")
      .select("asset_id, media_assets!inner(id, storage_bucket, original_path, original_filename, bytes, position, created_at)")
      .eq("order_id", order.id);

    type Asset = {
      id: string; storage_bucket: string | null; original_path: string | null;
      original_filename: string | null; bytes: number | null; position: number | null; created_at: string;
    };
    const tous: Asset[] = ((items ?? []) as Record<string, unknown>[])
      .map((r) => (Array.isArray(r.media_assets) ? r.media_assets[0] : r.media_assets) as Asset)
      .filter((a) => a && a.original_path)
      // Même ordre qu'à l'écran : le fichier 3 de l'archive doit être la photo 3 de la page.
      .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.created_at.localeCompare(b.created_at));

    if (tous.length === 0) return json({ error: "Aucune photo à télécharger." }, 404);

    // ── Découpage en parties ──────────────────────────────────────────────────────────────
    // Calculé sur la liste ENTIÈRE et de façon déterministe : la partie 2 doit contenir les mêmes
    // photos qu'on la demande maintenant ou dans dix minutes.
    const parties: Asset[][] = [];
    let courante: Asset[] = [];
    let poids = 0;
    for (const a of tous) {
      const taille = a.bytes ?? 0;
      if (courante.length > 0 && (courante.length >= MAX_FICHIERS || poids + taille > MAX_OCTETS)) {
        parties.push(courante);
        courante = [];
        poids = 0;
      }
      courante.push(a);
      poids += taille;
    }
    if (courante.length > 0) parties.push(courante);

    // ── Mode « annonce » ──────────────────────────────────────────────────────────────────
    // La page a besoin de savoir combien d'archives proposer. Elle NE recalcule pas le découpage
    // de son côté : il dépend aussi du poids des fichiers, qu'elle ne connaît pas, et deux
    // implémentations d'une même règle finissent toujours par diverger — ici, la page afficherait
    // deux boutons quand il en faut trois, et l'acheteur perdrait des photos sans le savoir.
    // C'est donc le code qui fabrique les archives qui dit combien il y en a.
    if (url.searchParams.get("info")) {
      return json({
        photos: tous.length,
        octets: tous.reduce((n, a) => n + (a.bytes ?? 0), 0),
        parties: parties.map((p, i) => ({
          index: i,
          photos: p.length,
          octets: p.reduce((n, a) => n + (a.bytes ?? 0), 0),
        })),
      });
    }

    if (partie >= parties.length) return json({ error: "Cette partie n'existe pas." }, 404);
    const lot = parties[partie]!;

    const { data: album } = await admin
      .from("media_albums")
      .select("title")
      .eq("id", order.album_id as string)
      .maybeSingle();
    const base = ((album?.title as string) || "photos")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "photos";
    const nomArchive = parties.length > 1
      ? `${base}-partie-${partie + 1}-sur-${parties.length}.zip`
      : `${base}.zip`;

    // ── Fabrication de l'archive, au fil de l'eau ─────────────────────────────────────────
    const enc = new TextEncoder();
    const vus = new Set<string>();
    const central: Uint8Array[] = [];
    let offset = 0;
    let nbEcrits = 0;

    async function* flux(): AsyncGenerator<Uint8Array> {
      for (const a of lot) {
        // Deux photos peuvent porter le même nom d'origine (IMG_1234.JPG sort de deux appareils) :
        // sans dédoublonnage, la seconde écraserait la première à l'extraction.
        let nom = (a.original_filename || `photo-${a.id.slice(0, 8)}.jpg`).replace(/[/\\]/g, "-");
        if (vus.has(nom.toLowerCase())) {
          const p = nom.lastIndexOf(".");
          const racine = p > 0 ? nom.slice(0, p) : nom;
          const ext = p > 0 ? nom.slice(p) : "";
          let n = 2;
          while (vus.has(`${racine}-${n}${ext}`.toLowerCase())) n++;
          nom = `${racine}-${n}${ext}`;
        }
        vus.add(nom.toLowerCase());
        const nomBin = enc.encode(nom);

        const { data: signe } = await admin.storage
          .from(a.storage_bucket || "sportvision-media-prive")
          .createSignedUrl(a.original_path!, TTL_LECTURE);
        if (!signe?.signedUrl) {
          // Une photo illisible ne doit pas faire perdre les autres : on la saute, l'archive
          // reste valide, et le journal garde la trace.
          console.error("[gallery-download-zip] signature impossible :", a.id);
          continue;
        }
        const rep = await fetch(signe.signedUrl);
        if (!rep.ok || !rep.body) {
          console.error("[gallery-download-zip] lecture impossible :", a.id, rep.status);
          continue;
        }

        const { heure, jour } = dateDos(new Date());
        const debut = offset;

        // En-tête local. Drapeau 0x0808 : bit 3 (tailles et CRC après le fichier) + bit 11 (nom
        // en UTF-8, sans quoi les accents deviennent illisibles à l'extraction sous Windows).
        const entete = octets(
          [0x04034b50, 4], [20, 2], [0x0808, 2], [0, 2],
          [heure, 2], [jour, 2],
          [0, 4], [0, 4], [0, 4],
          [nomBin.length, 2], [0, 2],
        );
        yield entete; offset += entete.length;
        yield nomBin; offset += nomBin.length;

        let crc = 0;
        let taille = 0;
        const lecteur = rep.body.getReader();
        while (true) {
          const { done, value } = await lecteur.read();
          if (done) break;
          crc = crc32(crc, value);
          taille += value.length;
          yield value;
          offset += value.length;
        }

        const descripteur = octets([0x08074b50, 4], [crc, 4], [taille, 4], [taille, 4]);
        yield descripteur; offset += descripteur.length;

        const cd = new Uint8Array(46 + nomBin.length);
        cd.set(octets(
          [0x02014b50, 4], [20, 2], [20, 2], [0x0808, 2], [0, 2],
          [heure, 2], [jour, 2],
          [crc, 4], [taille, 4], [taille, 4],
          [nomBin.length, 2], [0, 2], [0, 2],
          [0, 2], [0, 2], [0, 4],
          [debut, 4],
        ), 0);
        cd.set(nomBin, 46);
        central.push(cd);
        nbEcrits++;
      }

      const debutCentral = offset;
      let tailleCentral = 0;
      for (const cd of central) {
        yield cd;
        tailleCentral += cd.length;
      }
      yield octets(
        [0x06054b50, 4], [0, 2], [0, 2],
        [nbEcrits, 2], [nbEcrits, 2],
        [tailleCentral, 4], [debutCentral, 4], [0, 2],
      );
    }

    // Compteur informatif, incrémenté à l'ouverture du flux : attendre la fin ne servirait à rien,
    // le client peut couper à tout moment et la fonction ne le saurait pas.
    await admin
      .from("media_download_grants")
      .update({ download_count: (grant.download_count as number) + 1 })
      .eq("id", grant.id as string);

    // Flux construit à la main plutôt qu'avec ReadableStream.from : celui-ci dépend de la version
    // de Deno du runtime, et une archive n'est pas l'endroit où découvrir une incompatibilité.
    // `pull` demande un morceau à la fois : c'est ce qui garde la mémoire au niveau d'une photo.
    const generateur = flux();
    const corps = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await generateur.next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel() {
        // Le navigateur a fermé l'onglet ou annulé : on arrête de lire le stockage pour rien.
        void generateur.return(undefined as never);
      },
    });

    return new Response(corps, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        // filename* en UTF-8 : sans lui, un titre d'album accentué arrive tronqué ou mal encodé.
        "Content-Disposition": `attachment; filename="${nomArchive.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nomArchive)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[gallery-download-zip] erreur inattendue :", e);
    return json({ error: "Une erreur est survenue." }, 500);
  }
});
