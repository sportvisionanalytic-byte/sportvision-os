"use client";

import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { ContentLockedModule } from "@/components/content/LockedModule";
import { ContentLibrary } from "@/components/content/ContentLibrary";

// /media — alias de /content pour les navigations Full Communication (voir README.md §
// Arborescence des routes). Réexport de la même page plutôt qu'une redirection, pour éviter un
// aller-retour visible côté client.
export default function MediaPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "content")) return <ContentLockedModule />;
  return <ContentLibrary />;
}
