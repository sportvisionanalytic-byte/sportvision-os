"use client";

import { cn } from "@/lib/cn";

// Interrupteur — utilisé par /authorizations pour les 5 périmètres du droit à l'image
// (ACTIONS.md § 20). États obligatoires couverts : focus visible via :focus-visible uniquement
// (CHARTE.md § Boutons), transition 160 ms (CHARTE.md § Animations). `aria-label` systématique
// car ce composant n'affiche aucun texte visible lui-même — le libellé porté est toujours
// affiché à côté par l'appelant, mais l'attribut reste requis pour les lecteurs d'écran.
export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 flex-none rounded-full border transition-colors duration-sv",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]",
        checked ? "border-brand-blue bg-brand-blue" : "border-border-strong bg-surface-sunken",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sv-card transition-transform duration-sv",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
