// Des planches numerotees, pour etiqueter a la main les dossards reellement visibles.
import sharp from "/Users/fouka/Downloads/jarvis-starter-kit/.claude/worktrees/cockpit-main/livrables/SportVision-TV/moteur-reconnaissance/node_modules/sharp/lib/index.js";
import { writeFileSync } from "node:fs";
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SECRET_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const S = process.argv[2];
async function charger(c) {
  const r = await fetch(`${U}/storage/v1/object/sign/${encodeURI("sportvision-media-prive/" + c)}`,
    { method: "POST", headers: H, body: JSON.stringify({ expiresIn: 3600 }) });
  if (!r.ok) return null;
  const j = await r.json(); const p = j.signedURL || j.signedUrl;
  const rep = await fetch(`${U}/storage/v1${p.startsWith("/") ? "" : "/"}${p}`);
  return rep.ok ? Buffer.from(await rep.arrayBuffer()) : null;
}
const r = await fetch(`${U}/rest/v1/media_assets?select=id,preview_clair_path&album_id=eq.5536bdea-34d8-47da-a889-82f3b3eef3af&status=eq.ready&order=position&limit=36`, { headers: H });
const photos = await r.json();
writeFileSync(`${S}/photos-etiquetage.json`, JSON.stringify(photos, null, 1));
const L = 4, TL = 600, TH = 900;
for (let pl = 0; pl < 3; pl++) {
  const lot = photos.slice(pl * 12, pl * 12 + 12);
  const tuiles = [];
  for (const [i, p] of lot.entries()) {
    const b = await charger(p.preview_clair_path);
    if (!b) continue;
    const n = pl * 12 + i;
    const etiquette = Buffer.from(
      `<svg width="${TL}" height="${TH}"><rect x="0" y="0" width="86" height="54" fill="#000" opacity="0.8"/>`
      + `<text x="12" y="41" font-family="Helvetica" font-size="40" font-weight="bold" fill="#fff">${n}</text></svg>`);
    tuiles.push(await sharp(b).resize(TL, TH, { fit: "cover" })
      .composite([{ input: etiquette, top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer());
  }
  await sharp({ create: { width: TL * L, height: TH * 3, channels: 3, background: "#111" } })
    .composite(tuiles.map((b, i) => ({ input: b, left: (i % L) * TL, top: Math.floor(i / L) * TH })))
    .jpeg({ quality: 90 }).toFile(`${S}/planche-${pl}.jpg`);
  console.log(`planche-${pl}.jpg : photos ${pl * 12} a ${pl * 12 + lot.length - 1}`);
}
