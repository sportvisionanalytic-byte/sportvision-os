// Bandeau permanent affiché uniquement quand NEXT_PUBLIC_REVIEW_MODE=true (jamais
// défini en production — voir livrables/SportVision-Review-Hub/). Sert à ce qu'un
// auditeur ne puisse jamais confondre cet environnement avec la production, quel
// que soit l'écran affiché ni ce que le badge de build (NEXT_PUBLIC_BUILD_CONTEXT,
// hérité du contexte de déploiement Netlify, toujours "production" pour ce site
// Review aussi) pourrait laisser penser.
export function ReviewModeBanner() {
  if (process.env.NEXT_PUBLIC_REVIEW_MODE !== "true") return null;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 9999,
        background: "repeating-linear-gradient(135deg, #ff7a1a, #ff7a1a 12px, #e0680f 12px, #e0680f 24px)",
        color: "#1a0d00",
        fontWeight: 800,
        textAlign: "center",
        padding: "8px 16px",
        fontSize: "12px",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      SportVision — Environnement Review{" "}
      <span style={{ background: "rgba(255,255,255,.85)", padding: "2px 10px", borderRadius: 20, margin: "0 4px" }}>
        Données fictives
      </span>
      <span style={{ background: "rgba(255,255,255,.85)", padding: "2px 10px", borderRadius: 20, margin: "0 4px" }}>
        Aucune action réelle
      </span>
    </div>
  );
}
