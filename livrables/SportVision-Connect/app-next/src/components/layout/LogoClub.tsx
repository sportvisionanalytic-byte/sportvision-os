"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

// L'écusson d'un club plutôt que ses initiales (11/09/2026, Fouka : « bien afficher les logos »).
// Le haut du menu montrait déjà le logo (ctx.organization.logoUrl) ; le sélecteur de structures et
// l'écran « Mes clubs SportVision » n'affichaient que « SV », « V3S ». Une seule lecture de
// clubs.logo_url pour tous les clubs d'une liste ; initiales en repli, tant qu'un club n'a pas de
// logo ou si l'image ne se charge pas.

export function initialesClub(nom: string): string {
  return nom
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

/** Les logos des clubs dont on donne les identifiants : { id: url }. */
export function useLogosClubs(ids: string[]): Record<string, string> {
  const [logos, setLogos] = useState<Record<string, string>>({});
  const cle = [...ids].sort().join(",");
  useEffect(() => {
    if (!cle) return;
    let annule = false;
    createClient()
      .from("clubs")
      .select("id, logo_url")
      .in("id", cle.split(","))
      .then(({ data }) => {
        if (annule || !data) return;
        const carte: Record<string, string> = {};
        for (const c of data as { id: string; logo_url: string | null }[]) if (c.logo_url) carte[c.id] = c.logo_url;
        setLogos(carte);
      });
    return () => {
      annule = true;
    };
  }, [cle]);
  return logos;
}

/** Pastille carrée : l'écusson du club, sinon ses initiales sur le dégradé habituel. */
export function PastilleClub({ nom, logo, className, degrade = "from-brand-blue-electric to-brand-violet" }: {
  nom: string;
  logo?: string | null;
  className: string;
  degrade?: string;
}) {
  const [casse, setCasse] = useState(false);
  if (logo && !casse) {
    return (
      <span className={cn("flex flex-none items-center justify-center overflow-hidden bg-white", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" className="h-full w-full object-contain p-[2px]" onError={() => setCasse(true)} />
      </span>
    );
  }
  return (
    <span className={cn("flex flex-none items-center justify-center bg-gradient-to-br font-extrabold text-white", degrade, className)}>
      {initialesClub(nom)}
    </span>
  );
}
