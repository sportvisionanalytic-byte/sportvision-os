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
 *
 * "generic" (Espace Projet) et coach/academie/tournoi/stage (31/08/2026 — étendu, voir plus bas) :
 * résolu via `ctx.organization.portailClientId` (organizations.legacy_client_id, posé par
 * session.ts:buildProjetActiveContext/buildOrgSpaceActiveContext), `not_linked` si absent. AVANT
 * ce correctif, "generic" supposait `organization.id === client_id` directement (vrai UNIQUEMENT
 * pour les organisations "projet" backfillées par migration-connect-v2, où id et legacy_client_id
 * valent la même chose par construction) — faux pour tout Espace Projet créé depuis le tunnel
 * unifié (connect-org-activate, post-17/08/2026), où organizations.id est un uuid généré
 * indépendamment de clients.id. Bug trouvé le 31/08/2026 en vérifiant en E2E réel le correctif
 * FULLCOM_ELIGIBLE_ORG_TYPES du même jour (session.ts) : /billing, /contracts, /documents,
 * /communication, /publications, /validations, /mycm auraient été tout aussi cassés que la
 * navigation pour un Espace Projet (ou un coach/académie/tournoi/stage Full Communication) créé
 * après cette date, avec le même symptôme "locked"/vide malgré un contrat/des données réelles.
 *
 * "club" : résolu via clubs.portail_client_id, `not_linked` si absent — état honnête, pas une
 * erreur. "player" (11/08/2026, migration-connect-v43) : résolu (et créé à la demande si besoin)
 * via la RPC resolve_player_client_id — voir player_profiles.client_id ; avant cette migration un
 * espace Joueur tombait toujours dans le cas `locked` ci-dessous, ce qui rendait /messages
 * inutilisable pour un vrai compte Joueur (LockedModule affiché). Tout autre type d'organisation
 * (parent/sponsor/structure_coaching/cm_agency) : `locked` (aucune donnée réelle possible pour ces
 * types à ce jour, aucun `portailClientId` n'est jamais posé pour eux côté session.ts).
 */
export function useClientId(): ClientIdResolution {
  const { ctx } = useSession();
  const [state, setState] = useState<ClientIdResolution>({ status: "loading" });

  useEffect(() => {
    if (ctx.organization.type === "generic" || ctx.organization.type === "coach" || ctx.organization.type === "academy" || ctx.organization.type === "tournament_organizer" || ctx.organization.type === "camp") {
      setState(ctx.organization.portailClientId ? { status: "ready", clientId: ctx.organization.portailClientId } : { status: "not_linked" });
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
    if (ctx.organization.type === "player") {
      setState({ status: "loading" });
      const supabase = createClient();
      supabase
        .rpc("resolve_player_client_id", { p_player_id: ctx.organization.id })
        .then(({ data, error }) => {
          setState(!error && data ? { status: "ready", clientId: data as string } : { status: "not_linked" });
        });
      return;
    }
    setState({ status: "locked" });
  }, [ctx.organization.id, ctx.organization.type, ctx.organization.portailClientId]);

  return state;
}
