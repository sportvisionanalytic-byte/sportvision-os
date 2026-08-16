import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

interface EmptyStateProps {
  icon?: ComponentType<LucideProps>;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  // Pour un CTA non réductible à { label, onClick } (ex. un <Link>) — rendu après `action`.
  children?: ReactNode;
  className?: string;
  /** "default" : bloc plein (icône + titre + description), pour une page ou une Card.
   *  "compact" : placeholder en pointillés, une ligne, pour un sous-module dense (onglet,
   *  colonne kanban) où le bloc plein serait disproportionné — reprend le pattern répété à
   *  l'identique dans KanbanBoard/DeliverablesTab/FilesTab/TeamTab avant consolidation. */
  variant?: "default" | "compact";
}

// État vide partagé — voir CLUB-PLUS-PRODUCT-BIBLE.md § 23 ("Empty : Titre court + explication +
// CTA uniquement si utile"). Remplace les blocs "Aucun·e ... pour le moment." dupliqués (texte
// seul, sans icône ni CTA) trouvés dans /users, /documents, /teams, /requests, etc. — même
// philosophie que LockedModule.tsx (composant partagé unique consolidé depuis des copies quasi
// identiques). Pensé pour vivre à l'intérieur d'une Card existante (padding, pas de fond ni de
// bordure propre) : la page garde le contrôle du conteneur.
export function EmptyState({ icon: Icon = Inbox, title, description, action, children, className, variant = "default" }: EmptyStateProps) {
  if (variant === "compact") {
    return (
      <div className={cn("rounded-xl border border-dashed border-border-strong px-3 py-6 text-center text-[12px] text-text-faint", className)}>
        {title}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center gap-3 p-9 text-center", className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-bg text-neutral-fg">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className="text-[14px] font-extrabold tracking-tight">{title}</p>
        {description && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-text-soft">{description}</p>}
      </div>
      {action && (
        <Button variant="secondary" className="mt-1 h-9 px-4 text-[12.5px]" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {children}
    </div>
  );
}
