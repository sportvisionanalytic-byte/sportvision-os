"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getAvatarAndProfilParticulier } from "@/lib/supabase/session";
import { HubGrid, type HubTileItem } from "@/components/layout/HubTile";

// Connect V3 — pilier "Services" (Espace particulier). Regroupe Prestations, Paiement collectif,
// Mes commandes et Factures & paiements ; "Mon abonnement" ajouté uniquement pour un compte agent
// (migration-connect-v67-distinction-parent-agent.sql) — même garde que ParticularShell.tsx,
// jamais montré à un parent/tuteur plafonné gratuitement.
const BASE_TILES: HubTileItem[] = [
  {
    href: "/particulier/prestations",
    label: "Prestations",
    description: "Réserver une prestation SportVision",
    icon: "camera_alt",
    color: "#8CA9FF",
  },
  {
    href: "/particulier/cotisations",
    label: "Paiement collectif",
    description: "Participer à un paiement groupé",
    icon: "savings",
    color: "#F472B6",
  },
  {
    href: "/particulier/commandes",
    label: "Mes commandes",
    description: "L'historique de vos commandes",
    icon: "receipt_long",
    color: "#8CA9FF",
  },
  {
    href: "/particulier/factures",
    label: "Factures & paiements",
    description: "Vos factures et le suivi de vos paiements",
    icon: "payments",
    color: "#FBBF24",
  },
];

const ABONNEMENT_TILE: HubTileItem = {
  href: "/particulier/abonnement",
  label: "Mon abonnement",
  description: "Votre formule et vos options",
  icon: "workspace_premium",
  color: "#22D3EE",
};

export default function ServicesParticulierHubPage() {
  const [profilParticulier, setProfilParticulier] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return;
      const info = await getAvatarAndProfilParticulier(supabase, userId);
      if (!cancelled) setProfilParticulier(info.profilParticulier);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tiles = profilParticulier === "agent" ? [...BASE_TILES, ABONNEMENT_TILE] : BASE_TILES;

  return <HubGrid title="Services" tiles={tiles} />;
}
