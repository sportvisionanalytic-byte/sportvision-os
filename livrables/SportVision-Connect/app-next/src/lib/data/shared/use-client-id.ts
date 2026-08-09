"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import { resolveClubPortailClientId } from "@/lib/data/club/portail-link";

export type ClientIdResolution =
  | { status: "loading" }
  | { status: "locked" }
  | { status: "not_linked" }
  | { status: "ready"; clientId: string };

/**
 * Résout le `client_id` Portail applicable à l'espace courant — même logique de résolution que
 * /billing, /contracts, /documents (voir portail-link.ts), factorisée ici pour /messages,
 * /communication, /publications, /validations (chantier Tier B Phase 2) qui en ont tous besoin.
 * "generic" (Espace Projet) : organization.id EST déjà le client_id (sync direct, voir
 * migration-connect-v2). "club" : résolu via clubs.portail_client_id, `not_linked` si absent —
 * état honnête, pas une erreur. Tout autre type d'organisation : `locked` (aucune donnée réelle
 * possible pour ces types à ce jour).
 */
export function useClientId(): ClientIdResolution {
  const { ctx } = useSession();
  const [state, setState] = useState<ClientIdResolution>({ status: "loading" });

  useEffect(() => {
    if (ctx.organization.type === "generic") {
      setState({ status: "ready", clientId: ctx.organization.id });
      return;
    }
    if (ctx.organization.type === "club") {
      setState({ status: "loading" });
      const supabase = createClient();
      resolveClubPortailClientId(supabase, ctx.organization.id).then((clientId) => {
        setState(clientId ? { status: "ready", clientId } : { status: "not_linked" });
      });
      return;
    }
    setState({ status: "locked" });
  }, [ctx.organization.id, ctx.organization.type]);

  return state;
}
