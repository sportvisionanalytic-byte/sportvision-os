// Une galerie témoin, créée pour un test et supprimée après lui.
//
// POURQUOI. Le test du filigrane visait en dur l'album « Test paiement — U18 ». Cet album a été
// archivé le 10/09/2026 avec le reste du décor de test, et le garde-fou s'est mis à échouer sans
// que rien ne le signale clairement : il ne surveillait plus rien. Un test qui dépend d'une donnée
// de production dépend aussi de la prochaine personne qui fera le ménage.
//
// Celle-ci est construite comme une vraie galerie :
//   • les originaux vont dans le bucket PRIVÉ ;
//   • les vignettes et aperçus sont fabriqués par le CODE DE L'OS lui-même (_galDessiner,
//     _galFiligrane, _galToBlob, réglages GAL_MEDIA_CFG), exécuté dans un vrai navigateur sur la
//     page de production. Aucune imitation du filigrane : si l'OS cesse de filigraner, le test le
//     verra. C'est précisément l'erreur commise le 10/09 en fabriquant une galerie à la main — elle
//     n'avait aucun filigrane, et c'est Fouka qui l'a vu, pas un test.
//   • un lien public avec une formule « 2 photos », marqué hors statistiques.
//
// Elle est posée sur le club de test de Fouka (Villeneuve 340 SC). `nettoyer()` supprime tout —
// fichiers compris — et vérifie qu'il ne reste rien.

import { readFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SB, enTeteAdmin } from "./_session-os.mjs";

const OS = "https://bc6m3cgdz.sportvision-an.fr/SportVision-OS-Full.html";
const RACINE = new URL("../../../", import.meta.url).pathname;
// Des captures de l'interface : aucune personne, aucun mineur, rien de réel sur une URL publique.
const SOURCES = [
  "livrables/screenshots-promo/clubplus-02-dashboard-admin.png",
  "livrables/screenshots-promo/clubplus-03-membres.png",
  "livrables/screenshots-promo/clubplus-04-calendrier.png",
];

const api = (chemin, opts = {}) =>
  fetch(`${SB}/rest/v1/${chemin}`, { ...opts, headers: { ...enTeteAdmin, "Content-Type": "application/json", ...(opts.headers || {}) } });
const stockage = (bucket, chemin, opts = {}) =>
  fetch(`${SB}/storage/v1/object/${bucket}/${chemin}`, { ...opts, headers: { ...enTeteAdmin, ...(opts.headers || {}) } });

// `filigrane: false` sert UNIQUEMENT a prouver qu'un test sait echouer : une galerie sans
// filigrane doit le faire rougir. Par defaut, le temoin est filigrane comme une vraie galerie.
export async function creerGalerieTemoin(navigateur, { nom = "ZZ Galerie temoin", filigrane = true } = {}) {
  const club = (await (await api("clubs?select=id&nom=eq.Villeneuve%20340%20SC")).json())[0];
  const equipe = (await (await api(`club_teams?select=id&club_id=eq.${club.id}&limit=1`)).json())[0];
  const saison = (await (await api("saisons?select=id&label=eq.2026-2027")).json())[0];

  const album = (await (await api("media_albums", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ club_id: club.id, team_id: equipe?.id ?? null, saison_id: saison?.id ?? null,
      title: `${nom} — ${new Date().toISOString().slice(0, 16)}`, event_date: new Date().toISOString().slice(0, 10),
      status: "published", watermark_previews: filigrane }),
  })).json())[0];
  if (!album?.id) throw new Error("album temoin impossible a creer");

  const temoin = { albumId: album.id, clubId: club.id, assets: [], fichiers: [], lienId: null };

  // La page de l'OS fournit le code de filigrane de production.
  const page = await navigateur.newPage();
  await page.goto(OS, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof _galDessiner === "function" && typeof GAL_MEDIA_CFG === "object", null, { timeout: 30000 });

  const dossier = mkdtempSync(join(tmpdir(), "sv-temoin-"));
  let position = 0;
  for (const source of SOURCES) {
    const jpg = join(dossier, `${position}.jpg`);
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "88", join(RACINE, source), "--out", jpg], { stdio: "ignore" });
    const original = readFileSync(jpg);
    const id = crypto.randomUUID();
    const cheminOriginal = `media/${album.id}/${id}.jpg`;

    const r1 = await stockage("sportvision-media-prive", cheminOriginal, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: original });
    if (!r1.ok) throw new Error(`original : HTTP ${r1.status}`);
    temoin.fichiers.push(["sportvision-media-prive", cheminOriginal]);

    const derives = await page.evaluate(async ([b64, filigrane]) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bin], { type: "image/jpeg" }), { imageOrientation: "from-image" });
      const enB64 = async (blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
      const t = await _galToBlob(_galDessiner(bitmap, GAL_MEDIA_CFG.thumb.max, filigrane, "thumb"), GAL_MEDIA_CFG.thumb.mime, GAL_MEDIA_CFG.thumb.quality);
      const p = await _galToBlob(_galDessiner(bitmap, GAL_MEDIA_CFG.preview.max, filigrane, "preview"), GAL_MEDIA_CFG.preview.mime, GAL_MEDIA_CFG.preview.quality);
      return { t: await enB64(t), p: await enB64(p), mime: GAL_MEDIA_CFG.preview.mime, w: bitmap.width, h: bitmap.height };
    }, [original.toString("base64"), filigrane]);

    const ext = derives.mime === "image/webp" ? "webp" : "jpg";
    const cheminT = `${album.id}/${id}-t.${ext}`, cheminP = `${album.id}/${id}-p.${ext}`;
    for (const [chemin, donnees] of [[cheminT, derives.t], [cheminP, derives.p]]) {
      const r = await stockage("galerie-previews", chemin, { method: "POST", headers: { "Content-Type": derives.mime }, body: Buffer.from(donnees, "base64") });
      if (!r.ok) throw new Error(`derive ${chemin} : HTTP ${r.status}`);
      temoin.fichiers.push(["galerie-previews", chemin]);
    }

    const r2 = await api("media_assets", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
      id, album_id: album.id, club_id: club.id, original_path: cheminOriginal, preview_path: cheminP, thumb_path: cheminT,
      original_filename: `TEMOIN_${position}.JPG`, mime_type: "image/jpeg", checksum: `temoin-${id}`,
      width: derives.w, height: derives.h, bytes: original.length, status: "ready", position,
    }) });
    if (!r2.ok) throw new Error(`media_assets : HTTP ${r2.status} ${await r2.text()}`);
    temoin.assets.push({ id, original_path: cheminOriginal, thumb_path: cheminT, preview_path: cheminP });
    position++;
  }
  await page.close();

  const lien = (await (await api("media_album_links", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ album_id: album.id, slug: `zz-temoin-${Date.now()}`, label: "Temoin de test", analytics_excluded: true, is_enabled: true }),
  })).json())[0];
  temoin.lienId = lien.id; temoin.slug = lien.slug; temoin.token = lien.token;

  const offre = (await (await api("media_album_link_offers", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ link_id: lien.id, price_override_cents: 150, photos_allowance: 2, label: "2 photos", display_order: 1, offer_type: "pack", is_enabled: true, is_featured: true }),
  })).json())[0];
  temoin.offerId = offre.id;
  temoin.url = `https://connect.sportvision-an.fr/gallery/${lien.slug}?k=${lien.token}`;

  temoin.nettoyer = async () => {
    await api(`media_download_grants?order_id=in.(${(await (await api(`media_orders?select=id&album_id=eq.${album.id}`)).json()).map((o) => o.id).join(",") || "00000000-0000-0000-0000-000000000000"})`, { method: "DELETE" });
    await api(`media_order_items?order_id=in.(${(await (await api(`media_orders?select=id&album_id=eq.${album.id}`)).json()).map((o) => o.id).join(",") || "00000000-0000-0000-0000-000000000000"})`, { method: "DELETE" });
    await api(`media_orders?album_id=eq.${album.id}`, { method: "DELETE" });
    await api(`media_album_link_offers?link_id=eq.${lien.id}`, { method: "DELETE" });
    await api(`media_album_links?album_id=eq.${album.id}`, { method: "DELETE" });
    await api(`media_assets?album_id=eq.${album.id}`, { method: "DELETE" });
    await api(`media_albums?id=eq.${album.id}`, { method: "DELETE" });
    for (const bucket of ["sportvision-media-prive", "galerie-previews"]) {
      const prefixes = temoin.fichiers.filter(([b]) => b === bucket).map(([, c]) => c);
      if (prefixes.length) {
        await fetch(`${SB}/storage/v1/object/${bucket}`, { method: "DELETE",
          headers: { ...enTeteAdmin, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes }) });
      }
    }
    const reste = (await (await api(`media_albums?select=id&id=eq.${album.id}`)).json()).length
      + (await (await api(`media_assets?select=id&album_id=eq.${album.id}`)).json()).length;
    const fichierPublic = await fetch(`${SB}/storage/v1/object/public/galerie-previews/${temoin.assets[0]?.preview_path}`);
    return { reste, fichierEncoreServi: fichierPublic.status === 200 };
  };
  return temoin;
}
