import Link from "next/link";
import { Lock } from "lucide-react";
import type { ActiveContext } from "@/lib/types";
import { lockedModuleMessage } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Écran « module verrouillé » — ACTIONS.md § 26. Affiché sur toute route dont `canAccess`
// retourne faux. Ce petit composant est dupliqué à l'identique dans chaque dossier de module
// (teams/sponsors/contracts/billing) plutôt que partagé depuis src/components/ui/, pour ne
// jamais devenir un point de conflit avec un autre agent (voir README.md § Conventions).
export function LockedModule({ ctx }: { ctx: ActiveContext }) {
  return (
    <Card className="flex flex-col items-center gap-4 px-8 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-bg text-neutral-fg">
        <Lock className="h-6 w-6" aria-hidden />
      </span>
      <div className="max-w-md">
        <h2 className="text-[18px] font-extrabold tracking-tight">Module non activé</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">{lockedModuleMessage(ctx)}</p>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
        <Link href="/support">
          <Button variant="secondary">Parler à mon conseiller</Button>
        </Link>
        <Link href="/billing">
          <Button variant="primary">Découvrir les offres</Button>
        </Link>
      </div>
    </Card>
  );
}
