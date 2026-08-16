import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

// État d'erreur partagé — voir CLUB-PLUS-PRODUCT-BIBLE.md § 23 ("Error : Message humain +
// Réessayer"). Remplace les blocs "Impossible de charger..." dupliqués (texte seul, sans action)
// trouvés dans /users, /documents, /teams, /requests, etc. — même philosophie que
// LockedModule.tsx (composant partagé unique). Pensé pour vivre à l'intérieur d'une Card
// existante (padding, pas de fond ni de bordure propre).
export function ErrorState({ message = "Impossible de charger ces informations.", onRetry, className }: ErrorStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 p-9 text-center", className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg text-danger-fg">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <p className="max-w-sm text-[13.5px] font-semibold text-text-soft">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="h-9 px-4 text-[12.5px]" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}
