"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { lockedModuleMessage } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Écran « module verrouillé » — voir ACTIONS.md § 26. Affiché sur toute route dont `canAccess`
// retourne faux. Un module verrouillé n'est jamais masqué sans explication (README.md
// § Permissions centralisées) : il reste atteignable et explique ce qu'il apporte.
//
// Composant partagé unique (consolidé depuis 10 copies quasi identiques laissées par les agents
// qui ont construit chaque module en parallèle sans fichier commun à se disputer). `title` est
// optionnel : la plupart des écrans s'en passent, quelques-uns (Studio, Aide, Utilisateurs...)
// précisent le nom du module verrouillé.
interface LockedModuleProps {
  title?: string;
  /**
   * Remplace le message générique de `lockedModuleMessage` (qui suggère qu'un changement de
   * formule ou un entitlement peut débloquer le module « à tout moment »). À utiliser
   * uniquement pour un module qu'AUCUNE formule ne débloque aujourd'hui (ex. Studio, absent de
   * READY_MODULES sans exception — voir entitlements.ts) : le message générique y serait
   * trompeur (trouvé lors de l'audit démo Club+ du 19/08/2026).
   */
  message?: string;
}

export function LockedModule({ title, message }: LockedModuleProps) {
  const { ctx } = useSession();

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="mx-auto flex max-w-lg flex-col items-center gap-4 p-9 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-bg text-neutral-fg">
          <Lock className="h-6 w-6" aria-hidden />
        </span>
        <div>
          {title && <h1 className="text-[20px] font-extrabold tracking-tight">{title}</h1>}
          <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-text-soft">{message ?? lockedModuleMessage(ctx)}</p>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
          <Link href="/support">
            <Button variant="primary">Parler à mon conseiller</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
