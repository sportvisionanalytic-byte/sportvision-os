"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { lockedModuleMessage } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Écran « module verrouillé » — voir ACTIONS.md § 26. Composant propre au module Bibliothèque
// (voir aussi src/components/services/LockedModule.tsx pour les Prestations) : chaque module
// garde sa propre copie pour ne jamais dépendre d'un fichier partagé entre agents.
export function ContentLockedModule() {
  const { ctx } = useSession();

  return (
    <Card className="mx-auto flex max-w-[560px] flex-col items-center gap-4 p-9 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-bg text-neutral-fg">
        <Lock className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="text-[20px] font-extrabold tracking-tight">Module verrouillé</h1>
      <p className="text-[14px] leading-relaxed text-text-soft">{lockedModuleMessage(ctx)}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
        <Link href="/billing">
          <Button variant="primary">Découvrir les offres</Button>
        </Link>
        <Link href="/support">
          <Button variant="secondary">Parler à mon conseiller</Button>
        </Link>
      </div>
    </Card>
  );
}
