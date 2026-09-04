"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getAvatarAndProfilParticulier } from "@/lib/supabase/session";
import { particulierSportifsLabel } from "@/lib/supabase/particulier";
import { HubGrid } from "@/components/layout/HubTile";

// Connect V3 — pilier "Mon univers" (Espace particulier). Regroupe Mes sportifs/enfants,
// Calendrier et Messages. Libellé "Mes sportifs"/"Mes enfants"/"Mes sportifs suivis" repris tel
// quel de particulierSportifsLabel() (migration-connect-v67) — même bascule que la sidebar,
// jamais un libellé générique inventé ici.
export default function MonUniversParticulierHubPage() {
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

  const sportifsLabel = particulierSportifsLabel(profilParticulier);

  return (
    <HubGrid
      title="Mon univers"
      tiles={[
        {
          href: "/particulier/sportifs",
          label: sportifsLabel,
          description: "Les sportifs rattachés à votre compte",
          icon: "group",
          color: "#22D3EE",
        },
        {
          href: "/particulier/calendrier",
          label: "Calendrier",
          description: "Matchs, entraînements et événements à venir",
          icon: "calendar_month",
          color: "#8CA9FF",
        },
        {
          href: "/particulier/messages",
          label: "Messages",
          description: "Vos échanges avec le club et SportVision",
          icon: "forum",
          color: "#22D3EE",
        },
      ]}
    />
  );
}
