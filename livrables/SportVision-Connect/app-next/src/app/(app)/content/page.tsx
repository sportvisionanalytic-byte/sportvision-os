"use client";

import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { ContentLibrary } from "@/components/content/ContentLibrary";

// /content — bibliothèque de contenus, voir ACTIONS.md § 13.
export default function ContentPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "content")) return <LockedModule />;
  return <ContentLibrary />;
}
