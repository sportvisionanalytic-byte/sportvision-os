import { type ButtonHTMLAttributes, forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

// Variantes — voir CHARTE.md § Boutons. Une seule action principale par écran.
export type ButtonVariant = "primary" | "secondary" | "dark" | "tertiary" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-br from-brand-blue to-brand-violet text-white shadow-sv-button hover:brightness-[1.06]",
  secondary:
    "bg-transparent border border-border-strong text-text-soft hover:border-brand-blue-electric",
  // Bordure + teinte volontairement distincte de --sv-surface (#111735, la couleur de fond de
  // Card) : le bouton était rendu invisible (même hex exact que la carte qui le contient, cas
  // le plus courant pour ce variant) jusqu'à ce qu'on lui passe la souris dessus — repéré sur
  // /children, "Régulariser l'autorisation" apparaissait comme du texte flottant sans bouton.
  dark: "border border-white/10 bg-[#1E2650] text-white hover:bg-[#2A3470]",
  tertiary: "bg-transparent text-brand-blue-electric hover:text-brand-violet",
  danger: "bg-[#EF5B67] text-white hover:bg-[#D92D20]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", loading, className, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex h-11 items-center justify-center gap-2 rounded-sv px-5 text-[13.5px] font-bold transition-[filter,background-color,border-color] duration-sv",
          // disabled:bg-none est indispensable pour le variant "primary" : bg-gradient-to-br pose
          // un background-image (le dégradé) qui reste peint PAR-DESSUS le background-color gris
          // ci-dessous tant que l'image de fond n'est pas explicitement retirée — sans ça, un
          // bouton primary désactivé (ou en loading, qui pose aussi l'attribut disabled) restait
          // visuellement identique à un bouton actif, dégradé plein, malgré le curseur "not-allowed"
          // et le clic bloqué. Repéré sur /signup/account, "Continuer" avant remplissage du formulaire.
          "disabled:cursor-not-allowed disabled:bg-none disabled:bg-[#E4E7EC] disabled:text-[#98A2B3] disabled:shadow-none disabled:hover:brightness-100",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]",
          VARIANT_CLASSES[variant],
          loading && "cursor-wait opacity-85",
          className,
        )}
        {...props}
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
