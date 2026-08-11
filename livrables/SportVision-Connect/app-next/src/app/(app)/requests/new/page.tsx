"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { PLANS } from "@/lib/plans";
import { LockedModule } from "@/components/ui/LockedModule";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Toast, useToast } from "@/components/feedback/Toast";
import { cn } from "@/lib/cn";
import { submitClubRequest } from "@/lib/data/club/requests";
import { submitOrgRequest } from "@/lib/data/shared/requests";
import { fetchClubTeams } from "@/lib/data/club/teams";
import { createClient } from "@/lib/supabase/client";
import {
  URGENCY_META,
  VISUAL_FORMAT_LABELS,
  VISUAL_PLATFORM_LABELS,
  VISUAL_TYPE_LABELS,
  type VisualFormat,
  type VisualPlatform,
  type VisualRequestUrgency,
  type VisualType,
} from "@/lib/types/studio";
import { VISUAL_FORMAT_OPTIONS, VISUAL_PLATFORM_OPTIONS, VISUAL_TYPE_OPTIONS } from "@/lib/mock/studio";

/** urgency ne supporte que 2 niveaux réels côté schéma (normale/haute, voir
 * migration-clubplus-v4.sql) : "Express" n'a pas d'équivalent et dégraderait
 * silencieusement en "Prioritaire" après écriture — retiré du formulaire. */
const SELECTABLE_URGENCIES: VisualRequestUrgency[] = ["standard", "priority"];

// Nouvelle demande de visuel — modale de la maquette implémentée en page dédiée (route explicite
// /requests/new dans README.md § Arborescence des routes). Voir ACTIONS.md § 11.
export default function NewRequestPage() {
  return (
    <Suspense fallback={null}>
      <NewRequestContent />
    </Suspense>
  );
}

function NewRequestContent() {
  const { ctx } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toastMessage, toastTone, showToast } = useToast();

  const allowed = canAccess(ctx, "visual_requests");
  const canWrite = canCreate(ctx, "visual_request");

  const [visualType, setVisualType] = useState<VisualType>("other");
  const [teamName, setTeamName] = useState("");
  const [eventName, setEventName] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [format, setFormat] = useState<VisualFormat>("post_1_1");
  const [platform, setPlatform] = useState<VisualPlatform>("instagram");
  const [bodyText, setBodyText] = useState("");
  const [urgency, setUrgency] = useState<VisualRequestUrgency>("standard");
  const [submitting, setSubmitting] = useState(false);
  const [teamNames, setTeamNames] = useState<string[]>([]);

  // requests générique (table `requests`, RPC submit_request) vs club_requests : partagé par
  // Coach/Académie/Sponsor ET désormais Projet (organization.type="generic", migration-connect-
  // v24-projet-credits.sql) — aucun des 4 n'a de ligne `clubs`, submitClubRequest y échouerait
  // (is_club_member(organization.id) ne trouve jamais de club). Distinct de noCreditSystemOrg
  // ci-dessous : Projet a un vrai solde suivi contrairement à coach/académie/sponsor.
  const usesGenericRequestsTable = ["coach", "academy", "sponsor", "generic"].includes(ctx.organization.type);
  // coach/académie/sponsor n'ont aucun système de crédits réel suivi (plan "one_off",
  // creditsRemaining toujours à 0 côté session.ts) : bloquer l'envoi sur ce quota qui
  // n'existe pas pour eux rendrait le bouton définitivement inactif. Projet EXCLU de cette
  // liste : depuis la v24, son creditsRemaining est réel (organizations.credits_balance/
  // credits_reserved) et doit être contrôlé comme pour un club.
  const noCreditSystemOrg = ["coach", "academy", "sponsor"].includes(ctx.organization.type);

  useEffect(() => {
    const prefillBody = searchParams.get("prefillBody");
    const team = searchParams.get("teamName");
    if (prefillBody) setBodyText(prefillBody);
    if (team) setTeamName(team);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (usesGenericRequestsTable) return;
    const supabase = createClient();
    fetchClubTeams(supabase, ctx.organization.id).then((teams) => setTeamNames(teams.map((t) => t.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.organization.id]);

  if (!allowed) return <LockedModule title="Demandes de visuels" />;

  const plan = PLANS[ctx.subscription.planCode];
  const cost = URGENCY_META[urgency].creditCost;
  const available = ctx.subscription.creditsRemaining;
  const hasCreditSystem = plan.monthlyCredits !== null && !noCreditSystemOrg;
  const remainingAfter = hasCreditSystem ? available - cost : null;
  const hasEnoughCredits = !hasCreditSystem || available >= cost;

  function handleSubmit() {
    if (!canWrite || !hasEnoughCredits) return;
    setSubmitting(true);
    const supabase = createClient();
    // Pas de colonnes réelles pour eventName/publishDate (club_requests et requests générique) ni
    // pour team/format/platform côté requests générique — tout repris dans le texte transmis pour
    // ne rien perdre. Pour un club, `team` a une vraie colonne (passée à part) : pas dupliqué ici.
    const composedBody = [
      bodyText,
      usesGenericRequestsTable && teamName && `Équipe : ${teamName}`,
      eventName && `Événement : ${eventName}`,
      publishDate && `Publication visée : ${publishDate}`,
      `Format : ${VISUAL_FORMAT_LABELS[format]}`,
      `Plateforme : ${VISUAL_PLATFORM_LABELS[platform]}`,
    ]
      .filter(Boolean)
      .join("\n");
    const submission = usesGenericRequestsTable
      ? submitOrgRequest(supabase, ctx.organization.id, { visualType, bodyText: composedBody, urgency, credits: cost })
      : submitClubRequest(supabase, ctx.organization.id, { visualType, teamName: teamName || undefined, bodyText: composedBody, urgency, credits: cost });
    submission
      .then((request) => {
        const creditsSuffix = hasCreditSystem ? ` · ${cost} crédit${cost > 1 ? "s" : ""} réservé${cost > 1 ? "s" : ""}` : "";
        showToast(`Demande ${request.reference} envoyée${creditsSuffix}.`);
        setTimeout(() => router.push("/requests"), 650);
      })
      .catch(() => {
        setSubmitting(false);
        showToast("Envoi impossible, réessayez.", "error");
      });
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/requests" className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-brand-blue-electric">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Retour aux demandes
      </Link>

      <div>
        <div className="text-[12px] font-bold text-text-soft">Communication</div>
        <h1 className="mt-1.5 text-[27px] font-extrabold leading-tight tracking-tight">Nouvelle demande de visuel</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Type de visuel">
              <select
                value={visualType}
                onChange={(e) => setVisualType(e.target.value as VisualType)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              >
                {VISUAL_TYPE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {VISUAL_TYPE_LABELS[v]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Équipe">
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                list="sv-new-request-teams"
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              />
              <datalist id="sv-new-request-teams">
                {teamNames.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>

            <Field label="Événement (optionnel)">
              <input
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              />
            </Field>

            <Field label="Date de publication">
              <input
                type="date"
                value={publishDate}
                onChange={(e) => setPublishDate(e.target.value)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              />
            </Field>

            <Field label="Format">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as VisualFormat)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              >
                {VISUAL_FORMAT_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {VISUAL_FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Plateforme">
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as VisualPlatform)}
                className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue"
              >
                {VISUAL_PLATFORM_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {VISUAL_PLATFORM_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Texte à intégrer">
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={3}
              className="rounded-sv border border-border-strong bg-input-bg px-3 py-2 text-[13.5px] outline-none focus-visible:border-brand-blue"
            />
          </Field>

          <div>
            <span className="text-[12.5px] font-bold text-text-soft">Urgence</span>
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {SELECTABLE_URGENCIES.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUrgency(u)}
                  className={cn(
                    "rounded-xl border px-3.5 py-3 text-left transition-colors duration-sv",
                    urgency === u ? "border-brand-blue-electric bg-info-bg" : "border-border-strong bg-surface-alt",
                  )}
                >
                  <div className="text-[13px] font-extrabold tracking-tight">{URGENCY_META[u].label}</div>
                  <div className="mt-0.5 text-[12px] text-text-soft">
                    {URGENCY_META[u].creditCost} crédit{URGENCY_META[u].creditCost > 1 ? "s" : ""} · {URGENCY_META[u].delayLabel}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card className="h-fit border-brand-blue-electric/40 p-5">
          <div className="text-[13px] font-extrabold tracking-tight text-brand-blue-pale">Récapitulatif</div>
          <dl className="mt-3 flex flex-col gap-2.5 text-[13px]">
            <SummaryRow label="Type" value={VISUAL_TYPE_LABELS[visualType]} />
            <SummaryRow label="Urgence" value={URGENCY_META[urgency].label} />
            <SummaryRow label="Délai" value={URGENCY_META[urgency].delayLabel} />
            <SummaryRow label="Crédits nécessaires" value={`${cost}`} />
            <SummaryRow label="Crédits disponibles" value={hasCreditSystem ? `${available}` : "Suivi avec votre CM"} />
            <SummaryRow
              label="Solde restant"
              value={remainingAfter === null ? "Suivi avec votre CM" : `${Math.max(0, remainingAfter)}`}
              emphasis
            />
          </dl>
          {!hasEnoughCredits && (
            <p className="mt-3 text-[12.5px] font-bold text-danger-fg">
              Crédits insuffisants ce mois-ci. Gérez votre offre pour continuer.
            </p>
          )}
          {!canWrite && (
            <p className="mt-3 text-[12.5px] font-bold text-warning-fg">
              Votre rôle ne vous permet pas d&apos;effectuer cette action. Contactez l&apos;administrateur du club.
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2.5">
            <Button
              variant="primary"
              className="w-full"
              loading={submitting}
              disabled={!canWrite || !hasEnoughCredits}
              onClick={handleSubmit}
            >
              Envoyer la demande
            </Button>
          </div>
        </Card>
      </div>

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {children}
    </div>
  );
}

function SummaryRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-divider pb-2 last:border-0">
      <dt className="font-semibold text-text-soft">{label}</dt>
      <dd className={cn("text-right", emphasis ? "text-[14px] font-extrabold text-text" : "font-bold text-text")}>{value}</dd>
    </div>
  );
}
