"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { lockedModuleMessage } from "@/lib/permissions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// Écran « module verrouillé » — voir ACTIONS.md § 26. Affiché sur toute route protégée dont
// `canAccess` retourne faux. Un module verrouillé n'est jamais masqué sans explication (README.md
// § Permissions centralisées) : il reste atteignable et explique ce qu'il apporte.
//
// Composant propre à mes écrans (Settings, Support, Notifications, Messages, Calendrier,
// Documents, Utilisateurs) : il vit dans src/components/access/ plutôt que src/components/ui/
// pour ne pas devenir un point de conflit avec un autre agent qui construirait le même écran
// pour un autre module en parallèle.

interface LockedModuleProps {
  title: string;
}

export function LockedModule({ title }: LockedModuleProps) {
  const router = useRouter();
  const { ctx } = useSession();

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="flex max-w-[480px] flex-col items-center gap-4 p-9 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-bg text-accent-fg">
          <Lock className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight">{title}</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">{lockedModuleMessage(ctx)}</p>
        </div>
        <div className="mt-2 flex w-full flex-col gap-2.5 sm:flex-row sm:justify-center">
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
