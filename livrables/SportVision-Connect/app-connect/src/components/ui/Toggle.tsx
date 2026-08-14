"use client";

// Bascule visuelle — voir design-connect-personnel-12-08/README.md § Composants transverses.
// Purement présentationnelle : l'appelant décide de l'action au clic (toujours un appel serveur
// réel derrière, jamais un état local qui persisterait rien — voir NotificationsCard/AccessGrantCard).
export function Toggle({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <span
      className="inline-flex h-[26px] w-[46px] flex-none items-center rounded-sv-pill border p-0.5 transition-colors duration-150"
      style={{
        background: on ? "linear-gradient(120deg,#A855F7,#4F7DFF)" : "rgba(255,255,255,.08)",
        borderColor: on ? "transparent" : "rgba(255,255,255,.16)",
        justifyContent: on ? "flex-end" : "flex-start",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span className="block h-[20px] w-[20px] rounded-full bg-white" />
    </span>
  );
}
