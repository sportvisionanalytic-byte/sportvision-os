"use client";

import { useEffect } from "react";

// Filet de secours ultime : ne se déclenche que si le RootLayout lui-même (app/layout.tsx)
// plante — cas très rare, mais sans ce fichier Next.js retombe sur son écran blanc générique en
// anglais. Doit fournir son propre <html>/<body> (le layout défaillant n'est plus monté) : pas
// de dépendance à globals.css ni aux classes Tailwind du design system, uniquement des styles
// inline, pour rester fiable même si le chargement CSS est lui-même en cause.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/global-error]", error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09081A",
          color: "#F5F5F7",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: 440,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 600 }}>Une erreur est survenue</span>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#9AA0B4" }}>
            SportVision Connect n&apos;a pas pu se charger correctement. Réessayez dans quelques instants — si le problème
            persiste, contactez-nous.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: "none",
              borderRadius: 10,
              padding: "12px 22px",
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              background: "linear-gradient(135deg,#2454FF,#832DFF)",
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
