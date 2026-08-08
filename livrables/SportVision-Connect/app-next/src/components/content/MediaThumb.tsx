import { MEDIA_KIND_LABELS, type MediaAssetKind } from "@/lib/types/content";
import { cn } from "@/lib/cn";

// Placeholder d'imagerie — voir CHARTE.md § Imagerie : dégradé rayé à 125°, libellé monospace
// décrivant le contenu attendu. Aucune photographie fournie par le design, tout média est un
// placeholder.
export function MediaThumb({
  kind,
  label,
  className,
  children,
}: {
  kind: MediaAssetKind;
  label?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("relative flex items-center justify-center overflow-hidden", className)}
      style={{
        backgroundImage:
          "repeating-linear-gradient(125deg, rgba(36,84,255,.55) 0px, rgba(36,84,255,.55) 16px, rgba(131,45,255,.5) 16px, rgba(131,45,255,.5) 32px)",
      }}
    >
      <span className="rounded-full bg-black/35 px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[.04em] text-white">
        {label ?? MEDIA_KIND_LABELS[kind]}
      </span>
      {children}
    </div>
  );
}
