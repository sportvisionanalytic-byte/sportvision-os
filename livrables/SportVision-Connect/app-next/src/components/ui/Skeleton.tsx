import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Bloc de squelette de chargement — voir CLUB-PLUS-PRODUCT-BIBLE.md § 22/§23 ("Loading :
// Skeleton correspondant à la forme de la page"). Remplace le texte brut "Chargement…" trouvé
// dans une trentaine de pages : chaque appelant compose sa propre forme (lignes, cartes,
// avatar, tableau...) avec ce bloc de base plutôt que d'utiliser un unique skeleton générique
// identique partout — même philosophie que LockedModule.tsx (composant partagé unique après
// consolidation de copies quasi identiques). Utilise `animate-svfade` + `bg-elevated` : les
// tokens de mouvement/couleur déjà définis (tailwind.config.ts), pas de convention nouvelle.
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-sv bg-elevated", className)}
      aria-hidden="true"
      {...props}
    />
  );
}

// Ligne de texte simulée — raccourci pour le cas le plus fréquent (titre, libellé, valeur).
export function SkeletonText({ className }: { className?: string }) {
  return <Skeleton className={cn("h-4 w-full max-w-[220px]", className)} />;
}

// Avatar/rond simulé (initiales, icône, miniature ronde).
export function SkeletonAvatar({ className }: { className?: string }) {
  return <Skeleton className={cn("h-9 w-9 flex-none rounded-full", className)} />;
}

// Carte simulée — reprend les proportions de Card.tsx (rounded-sv-card, padding standard) pour
// qu'un skeleton de grille de cartes n'ait pas un rythme visuel différent du contenu réel.
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-sv-card border border-border bg-surface p-4", className)}>
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-3 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-4/5" />
    </div>
  );
}

// Ligne de tableau/liste simulée — reprend le rythme des lignes réelles (avatar + 2 colonnes de
// texte + badge), voir par ex. la liste de /users ou /teams.
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0", className)}>
      <SkeletonAvatar />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="mt-2 h-3 w-1/4" />
      </div>
      <Skeleton className="h-6 w-20 flex-none rounded-full" />
    </div>
  );
}
