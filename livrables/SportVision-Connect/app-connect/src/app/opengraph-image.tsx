import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Image de prévisualisation générée au build (pas un asset fourni par Fouka) — affichée quand un
// lien Connect est partagé (WhatsApp, iMessage, Slack...). Absente jusqu'ici : un lien de
// cotisation partagé via ShareFundingButtons.tsx (bouton WhatsApp) n'affichait aucune carte de
// prévisualisation, juste le texte brut de l'URL. Réutilise le logo déjà en place
// (public/uploads/logo.png, identique à celui du sidebar) et les tokens de couleur du design
// system (bg #09081A, dégradé sv-gradient) plutôt qu'un nouveau visuel à faire créer.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logoPath = join(process.cwd(), "public", "uploads", "logo.png");
  const logoData = await readFile(logoPath);
  const logoSrc = `data:image/png;base64,${logoData.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          background: "#09081A",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse (next/og) n'accepte pas next/image, source locale encodée en base64 */}
        <img src={logoSrc} width={140} height={140} alt="" />
        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight: 700,
            color: "white",
            letterSpacing: "-0.02em",
          }}
        >
          SportVision Connect
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#9A9AB8" }}>
          Votre sport. Vos contenus. Votre équipe.
        </div>
      </div>
    ),
    { ...size },
  );
}
