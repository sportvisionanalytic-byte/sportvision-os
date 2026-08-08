"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

// Coque des 3 écrans Paramètres — voir ACTIONS.md § 25. Fichier nouveau (aucun `settings/
// layout.tsx` n'existait), propre à mon périmètre : il ne touche à aucun layout partagé.
const TABS = [
  { href: "/settings/profile", label: "Personnel" },
  { href: "/settings/organization", label: "Organisation" },
  { href: "/settings/integrations", label: "Intégrations" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[29px] font-extrabold tracking-tight">Paramètres</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">Votre profil, votre organisation et vos intégrations.</p>
      </div>

      <div className="flex gap-1.5 border-b border-divider">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative px-3.5 pb-3 text-[13.5px] font-bold transition-colors duration-sv",
                active ? "text-text" : "text-text-soft hover:text-text",
              )}
            >
              {tab.label}
              {active && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-gradient-to-r from-brand-blue to-brand-violet" />}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
