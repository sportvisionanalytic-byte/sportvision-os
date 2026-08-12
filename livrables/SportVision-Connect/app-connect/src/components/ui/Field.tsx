import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
}

// Champ standard — voir design-connect-personnel-12-08/README.md § Composants transverses.
// Toujours un <label> associé (jamais un <div> — perte d'association lecteur d'écran sinon,
// cf. sportvision_audit_uiux_connect_11-08 côté app-next : bug déjà trouvé une fois ailleurs).
export const Field = forwardRef<HTMLInputElement, FieldProps>(
  ({ label, error, id, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-text-secondary">
          {label}
        </label>
        <input
          ref={ref}
          id={id}
          className={cn(
            "h-[54px] w-full rounded-sv border bg-surface px-4 font-sans text-[15px] text-text outline-none transition-[border-color,box-shadow] duration-150",
            "placeholder:text-text-label",
            "focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)]",
            error ? "border-danger" : "border-border-strong",
            className,
          )}
          {...props}
        />
        {error && <span className="text-[12px] text-danger">{error}</span>}
      </div>
    );
  },
);
Field.displayName = "Field";
