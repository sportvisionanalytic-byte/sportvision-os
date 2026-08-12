import { Lock } from "lucide-react";
import { Card } from "@/components/ui/Card";

// Écran affiché à un communication_manager/coach de club qui arrive par URL directe sur un
// module financier (Documents/Factures/Contrats) — voir permissions.ts § hasClubFinancialAccess
// et navigation.ts § filterClubRoleNav. Ces 3 modules ne sont plus dans leur menu ; ce composant
// couvre l'accès direct plutôt que de laisser un "Aucun document pour le moment" trompeur (la
// requête sous-jacente renvoie déjà [] côté RLS, club_member_has_financial_access, migration-
// connect-v41-decisions-produit-11-08.sql — ceci n'est qu'un message plus honnête, pas une
// frontière de sécurité supplémentaire).
export function RestrictedToBureau({ title }: { title?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="mx-auto flex max-w-lg flex-col items-center gap-4 p-9 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-bg text-neutral-fg">
          <Lock className="h-6 w-6" aria-hidden />
        </span>
        <div>
          {title && <h1 className="text-[20px] font-extrabold tracking-tight">{title}</h1>}
          <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-text-soft">
            Les documents financiers du club (devis, factures, contrats) sont réservés au bureau du club
            (administrateur, président, trésorier, membre du bureau). Contactez l&apos;un d&apos;eux si vous avez besoin
            d&apos;un accès.
          </p>
        </div>
      </Card>
    </div>
  );
}
