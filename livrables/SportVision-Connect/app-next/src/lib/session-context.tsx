"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ActiveContext } from "./types";
import { mockMemberships, mockOrganizations, mockSubscriptions, mockUser } from "./mock-data";

// Contexte de session — fournit l'organisation active et recharge tout au changement
// (navigation, permissions, données, modules), voir README.md § Chrome permanent.
// Implémentation mock côté client pour l'instant : à remplacer par la vraie session
// (cookies/JWT + requêtes serveur) quand la couche d'authentification sera branchée —
// c'est une décision séparée, volontairement pas prise ici.

interface SessionValue {
  ctx: ActiveContext;
  organizations: typeof mockOrganizations;
  setActiveOrganizationId: (id: string) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [activeOrganizationId, setActiveOrganizationId] = useState(mockOrganizations[0]!.id);

  const value = useMemo<SessionValue>(() => {
    const organization = mockOrganizations.find((o) => o.id === activeOrganizationId)!;
    const membership = mockMemberships.find(
      (m) => m.organizationId === activeOrganizationId && m.userId === mockUser.id,
    )!;
    const subscription = mockSubscriptions[activeOrganizationId]!;
    return {
      ctx: { user: mockUser, organization, membership, subscription },
      organizations: mockOrganizations,
      setActiveOrganizationId,
    };
  }, [activeOrganizationId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within a SessionProvider");
  return value;
}
