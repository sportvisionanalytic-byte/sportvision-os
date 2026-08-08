"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/lib/session-context";
import { lockedModuleMessage } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Écran « module verrouillé » — voir ACTIONS.md § 26. Affiché sur toute route dont canAccess
// retourne faux. Pas de composant partagé équivalent dans src/components/ui/ à ce jour ; celui-ci
// vit dans son propre dossier (ni studio, ni newsroom, ni matchcenter, ni requests en propre) pour
// être réutilisable par toutes les routes de ce périmètre sans devenir un point de conflit avec
// un autre agent qui construirait le sien en parallèle sur un autre module.
export function LockedModule({ title }: { title: string }) {
  const { ctx } = useSession();

  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-neutral-bg text-neutral-fg">
        <Lock className="h-5 w-5" aria-hidden />
      </div>
      <h1 className="mt-4 text-[20px] font-extrabold tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] text-text-soft">{lockedModuleMessage(ctx)}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
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
