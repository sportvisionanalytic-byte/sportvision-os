"use client";

import { cn } from "@/lib/cn";

// Interrupteur réutilisé sur Paramètres et Préférences de notifications — voir CHARTE.md § États
// obligatoires (focus visible, désactivé). Propre à mes écrans : vit dans src/components/settings
// plutôt que src/components/ui pour ne jamais entrer en conflit avec un autre agent.
interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 flex-none rounded-full transition-colors duration-sv focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]",
        checked ? "bg-gradient-to-r from-brand-blue to-brand-violet" : "bg-surface-sunken",
        disabled && "cursor-not-allowed opacity-50",
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
