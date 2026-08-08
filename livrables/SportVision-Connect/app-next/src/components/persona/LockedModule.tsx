"use client";

import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import type { ActiveContext } from "@/lib/types";
import { lockedModuleMessage } from "@/lib/permissions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// Écran « module verrouillé » — ACTIONS.md § 26. Affiché sur toute route dont `canAccess`
// retourne faux. Ne jamais rediriger silencieusement. Partagé par les écrans de
// src/app/(app)/{children,authorizations,accompagnement,sessions,camps,eventtimeline,live} —
// vit dans src/components/persona/ (pas src/components/ui/) pour ne pas devenir un point de
// conflit avec un autre agent qui travaille en parallèle sur un autre module.
export function LockedModule({ ctx }: { ctx: ActiveContext }) {
  const router = useRouter();
  return (
    <Card className="mx-auto flex max-w-lg flex-col items-center gap-4 p-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-bg text-neutral-fg">
        <Lock className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-[14px] font-medium leading-relaxed text-text-soft">{lockedModuleMessage(ctx)}</p>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <Button variant="primary" onClick={() => router.push("/billing")}>
          Découvrir les offres
        </Button>
        <Button variant="secondary" onClick={() => router.push("/support")}>
          Parler à mon conseiller
        </Button>
      </div>
    </Card>
  );
}
