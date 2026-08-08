"use client";

import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import type { ActiveContext } from "@/lib/types";
import { lockedModuleMessage } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Écran « module verrouillé » — ACTIONS.md § 26. Affiché sur toute route dont canAccess()
// retourne faux ; jamais de redirection silencieuse. Composant propre au module communication
// (README.md § Conventions point 3) : chaque module qui en a besoin construit le sien au même
// endroit relatif, pour ne jamais entrer en conflit avec un autre agent.
export function LockedModule({ ctx }: { ctx: ActiveContext }) {
  const router = useRouter();
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="flex max-w-[460px] flex-col items-center gap-4 p-9 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-sunken text-text-faint">
          <Lock className="h-6 w-6" aria-hidden />
        </span>
        <p className="text-[15px] font-semibold leading-relaxed text-text-soft">{lockedModuleMessage(ctx)}</p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
          <Button variant="primary" onClick={() => router.push("/billing")}>
            Découvrir les offres
          </Button>
          <Button variant="secondary" onClick={() => router.push("/support")}>
            Parler à mon conseiller
          </Button>
        </div>
      </Card>
    </div>
  );
}
