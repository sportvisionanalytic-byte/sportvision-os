"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActiveContext } from "./types";
import type { Space } from "./supabase/session";
import { switchActiveSpace } from "./supabase/actions";

// Contexte de session — fournit l'organisation active et recharge tout au changement
// (navigation, permissions, données, modules), voir README.md § Chrome permanent.
//
// Reçoit l'état résolu côté serveur (src/app/(app)/layout.tsx, voir le plan Phase 1
// § Décisions d'architecture n°2) : ctx reste garanti non-nul ici, seul le layout serveur
// décide si l'app se monte ou non. Le changement d'espace persiste côté serveur (cookie via
// Server Action) puis déclenche un router.refresh() pour que le layout recalcule ctx.

interface SessionValue {
  ctx: ActiveContext;
  spaces: Space[];
  setActiveSpace: (space: Pick<Space, "kind" | "id">) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  children,
  initialCtx,
  initialSpaces,
}: {
  children: ReactNode;
  initialCtx: ActiveContext;
  initialSpaces: Space[];
}) {
  const router = useRouter();

  const value = useMemo<SessionValue>(
    () => ({
      ctx: initialCtx,
      spaces: initialSpaces,
      setActiveSpace: (space) => {
        void switchActiveSpace(space).then(() => router.refresh());
      },
    }),
    [initialCtx, initialSpaces, router],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within a SessionProvider");
  return value;
}
