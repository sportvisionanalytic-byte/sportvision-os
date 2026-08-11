import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Écran dédié club pour /services/new et /services/[id] — voir NewServiceTunnel.tsx et
// entitlements.ts § "services". Le tunnel écrit dans `prestations` (client_id, montants
// numériques réels) ; un club n'a pas de client_id direct rattaché à ses demandes de prestation
// aujourd'hui (club_bookings, sa propre table, n'a ni prix numérique structuré — juste
// `price_label` texte libre — ni les mêmes statuts que ce que cet écran attend). Plutôt que
// d'afficher le message générique "module non activé sur votre contrat" (LockedModule), trompeur
// ici puisque ce n'est pas une question de plan/offre mais de représentation des données, ce
// composant explique honnêtement la situation et laisse un vrai club joindre SportVision par un
// autre canal — jamais une impasse totale. Voir le plan Phase 3 § Hors scope pour la décision.
export function ClubServiceRequestNotice() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="mx-auto flex max-w-lg flex-col items-center gap-4 p-9 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-bg text-neutral-fg">
          <MessageCircle className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight">Nouvelle demande de prestation</h1>
          <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-text-soft">
            Ce formulaire en ligne n&apos;est pas encore disponible pour les clubs. Contactez votre interlocuteur
            SportVision pour toute nouvelle demande de captation ou de prestation : il s&apos;en occupe directement.
          </p>
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
