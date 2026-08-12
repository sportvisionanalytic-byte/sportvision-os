import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

// Quatre familles seulement — voir design-connect-personnel-12-08/README.md § Composants transverses.
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-sv-gradient text-white hover:brightness-[1.12]",
  secondary: "bg-surface border border-border-strong text-text hover:bg-surface-hover",
  ghost: "bg-transparent text-[#8CA9FF] hover:text-[#B6C7FF]",
  danger: "bg-danger-bg border border-danger-border text-danger hover:bg-[rgba(244,114,182,.16)]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", loading, className, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex h-14 items-center justify-center gap-2.5 rounded-sv px-5 font-sora text-[16px] font-semibold transition-[filter,background-color,opacity] duration-150",
          "disabled:cursor-not-allowed disabled:opacity-45",
          loading && "cursor-wait opacity-75",
          VARIANT_CLASSES[variant],
          className,
        )}
        {...props}
      >
        {loading && (
          <span
            className="h-[18px] w-[18px] animate-sv-spin rounded-full border-2 border-white/35 border-t-white"
            aria-hidden
          />
        )}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
