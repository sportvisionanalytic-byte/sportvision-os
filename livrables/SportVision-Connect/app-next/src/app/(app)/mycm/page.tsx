"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, MessageCircle, Sparkles } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card, CardPremium } from "@/components/ui/Card";
import { LockedModule } from "@/components/ui/LockedModule";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { createClient } from "@/lib/supabase/client";
import {
  fetchCommunityManager,
  fetchContentsProducedThisMonth,
  fetchIsFullCommunication,
  type CommunityManager,
} from "@/lib/data/shared/community-manager";

// /mycm — fiche Community Manager, branchée sur de vraies données (Phase 2 du plan MyCM,
// 10/08/2026 : migration-connect-v21-client-cm-view.sql + data/shared/community-manager.ts).
// Périmètre : club et Espace Projet (generic) avec un contrat Full Communication actif —
// résolu dynamiquement via client_contrats à chaque chargement (même logique que
// session.ts:buildClubActiveContext → isFullCommunication), pas via un entitlement statique.
// Coach/académie en bénéficieront automatiquement une fois legacy_client_id peuplé pour eux
// (Phase 1 du plan, pas construite à ce jour) — useClientId() ne résout pas encore de client_id
// pour ces types, donc ils retombent honnêtement sur l'état "locked" ci-dessous.
//
// « Envoyer un message » renvoie vers /messages (fil du CM), hors périmètre de ce module.
// « Demander un échange » (ex-« Planifier un échange », modale ScheduleSlotModal à créneaux
// fictifs — supprimée avec ce commit) renvoie désormais vers /support : aucun vrai système de
// prise de RDV CM↔client n'existe (/appointments est un système staff-géré distinct pour
// l'Espace Projet, hors périmètre) — mieux vaut un renvoi honnête vers l'Aide qu'une simulation
// de réservation qui ne réserve rien.
export default function MyCmPage() {
  const { ctx } = useSession();
  if (!canAccess(ctx, "mycm")) return <LockedModule title="Mon Community Manager" />;
  return <MyCmGate />;
}

function MyCmGate() {
  const { ctx } = useSession();
  const resolution = useClientId();

  if (resolution.status === "locked") return <LockedModule title="Mon Community Manager" />;
  if (resolution.status === "loading") {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }
  if (resolution.status === "not_linked") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[29px] font-extrabold tracking-tight">Mon Community Manager</h1>
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="max-w-md text-[13.5px] text-text-soft">
            SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace CM. Contactez votre
            interlocuteur SportVision pour l&apos;activer.
          </div>
        </Card>
      </div>
    );
  }
  return <MyCmScreen clientId={resolution.clientId} />;
}

type LoadState =
  | { status: "loading" }
  | { status: "not_full_communication" }
  | { status: "no_cm" }
  | { status: "error" }
  | { status: "ready"; cm: CommunityManager; contentsProducedThisMonth: number };

function MyCmScreen({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const supabase = createClient();

    (async () => {
      const isFullCommunication = await fetchIsFullCommunication(supabase, clientId);
      if (cancelled) return;
      if (!isFullCommunication) {
        setState({ status: "not_full_communication" });
        return;
      }
      const cm = await fetchCommunityManager(supabase, clientId);
      if (cancelled) return;
      if (!cm) {
        setState({ status: "no_cm" });
        return;
      }
      const contentsProducedThisMonth = await fetchContentsProducedThisMonth(supabase, clientId, cm.id);
      if (cancelled) return;
      setState({ status: "ready", cm, contentsProducedThisMonth });
    })().catch(() => {
      if (!cancelled) setState({ status: "error" });
    });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (state.status === "loading") {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  if (state.status === "not_full_communication") {
    return <LockedModule title="Mon Community Manager" />;
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[29px] font-extrabold tracking-tight">Mon Community Manager</h1>
        <Card className="px-8 py-16 text-center text-[13.5px] text-danger-fg">
          Impossible de charger les informations de votre Community Manager. Réessayez plus tard.
        </Card>
      </div>
    );
  }

  if (state.status === "no_cm") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[29px] font-extrabold tracking-tight">Mon Community Manager</h1>
        <Card className="px-8 py-16 text-center text-[13.5px] text-text-soft">
          Aucun Community Manager n&apos;est encore assigné à cet espace.
        </Card>
      </div>
    );
  }

  const { cm, contentsProducedThisMonth } = state;
  const fullName = `${cm.firstName} ${cm.lastName}`.trim() || "Community Manager";
  const initials = ((cm.firstName[0] ?? "") + (cm.lastName[0] ?? "")).toUpperCase() || "CM";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Full Communication</div>
        <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">Mon Community Manager</h1>
      </div>

      <CardPremium>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-16 w-16 flex-none items-center justify-center rounded-full bg-white/15 text-[19px] font-extrabold text-white">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[20px] font-extrabold tracking-tight">{fullName}</div>
            <div className="text-[13px] text-[#B9C7EB]">{cm.levelLabel ?? "Community Manager SportVision"}</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3.5 border-t border-white/10 pt-4">
          <div>
            <div className="text-[11px] font-semibold text-[#B9C7EB]">Contenus publiés</div>
            <div className="mt-1 text-[18px] font-extrabold">{contentsProducedThisMonth}</div>
            <div className="text-[11px] text-[#8B9BBE]">ce mois-ci</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#B9C7EB]">Délai de réponse</div>
            <div className="mt-1 text-[15px] font-extrabold leading-tight">Non disponible</div>
            <div className="text-[11px] text-[#8B9BBE]">aucun suivi automatique</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#B9C7EB]">Prochain point</div>
            <div className="mt-1 text-[15px] font-extrabold leading-tight">Non disponible</div>
            <div className="text-[11px] text-[#8B9BBE]">à demander via l&apos;Aide</div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <Button variant="primary" onClick={() => router.push("/messages")}>
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            Envoyer un message
          </Button>
          <Button
            variant="secondary"
            className="border-white/25 bg-white/[.12] text-white hover:border-white/40"
            onClick={() => router.push("/support")}
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
            Demander un échange
          </Button>
        </div>
      </CardPremium>

      <Card className="p-5">
        <div className="flex items-center gap-2 text-[15px] font-extrabold tracking-tight">
          <Sparkles className="h-4 w-4 text-brand-blue-electric" aria-hidden />
          Comment travailler ensemble
        </div>
        <ol className="mt-3.5 flex flex-col gap-3">
          {WORKING_TOGETHER_TIPS.map((point, i) => (
            <li key={point} className="flex gap-3">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-info-bg text-[11px] font-extrabold text-info-fg">
                {i + 1}
              </span>
              <span className="text-[13.5px] leading-relaxed text-text-soft">{point}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

// Conseils génériques (pas de personnalisation par CM/client réelle à ce jour) — remplace les
// tuyaux mock qui citaient un nom de CM fictif ("Nina couvre les temps forts terrain...").
const WORKING_TOGETHER_TIPS = [
  "Transmettez vos informations et contenus prioritaires (dates, visuels, actualités) dès qu'ils sont disponibles.",
  "Le planning éditorial en cours est visible dans l'onglet Publications.",
  "Pour toute question ou demande, utilisez la messagerie ci-dessus ou contactez l'Aide.",
];
