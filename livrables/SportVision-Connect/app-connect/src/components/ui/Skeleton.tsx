import { cn } from "@/lib/cn";

// Squelette de chargement — bloc de base réutilisé par tous les loading.tsx de route (voir
// rapport fluidité perçue du 15/08). Reprend le pattern déjà utilisé ponctuellement dans
// commandes/page.tsx (`animate-pulse` + `bg-surface` + arrondi sv) plutôt que d'introduire une
// nouvelle convention visuelle.
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-sv bg-surface", className)} aria-hidden="true" />;
}

// Squelette de page générique (titre + sous-titre + grille de cartes) affiché immédiatement par
// les loading.tsx pendant qu'un Server Component résout ses données Supabase, à la place d'un
// écran blanc/gelé. Un seul composant partagé pour rester cohérent d'une route à l'autre — voir
// PageSkeleton dans chaque loading.tsx pour son usage exact (nombre de cartes adapté au contenu
// réel de la page).
export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6 px-5 py-7 lg:px-8 lg:py-10">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: cards }).map((_, i) => (
            <Skeleton key={i} className="h-[130px] w-full rounded-sv-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
