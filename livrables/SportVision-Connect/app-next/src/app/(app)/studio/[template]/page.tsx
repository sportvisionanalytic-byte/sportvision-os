"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Sparkles, UploadCloud } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess, canCreate } from "@/lib/permissions";
import { PLANS } from "@/lib/plans";
import { LockedModule } from "@/components/ui/LockedModule";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Toast, useToast } from "@/components/feedback/Toast";
import { currentSeasonLabel, inferVisualType } from "@/lib/mock/studio";
import { fetchStudioTemplate } from "@/lib/data/club/studio";
import { submitClubRequest } from "@/lib/data/club/requests";
import { submitOrgRequest } from "@/lib/data/shared/requests";
import { fetchClubMatchById } from "@/lib/data/club/matches";
import { fetchClubTeams } from "@/lib/data/club/teams";
import { createClient } from "@/lib/supabase/client";
import {
  STUDIO_CATEGORY_LABELS,
  STUDIO_FIELD_LABELS,
  STUDIO_PREFILLED_FIELDS,
  type StudioFieldKey,
  type StudioTemplate,
} from "@/lib/types/studio";

// Fiche modèle du Studio — formulaire préempli, bandeau de coût en crédits. Voir ACTIONS.md § 6.
// Le modèle est chargé depuis studio_templates (migration-clubplus-v38-studio-sponsors.sql, voir
// data/club/studio.ts) au lieu de la constante STUDIO_TEMPLATES — d'où le chargement asynchrone
// (findTemplate() était synchrone sur le tableau en mémoire, fetchStudioTemplate() ne l'est pas).
// À l'envoi, submitClubRequest/submitOrgRequest appellent la vraie RPC serveur qui réserve les
// crédits (club_requests) ou stocke credits_reserved sur la ligne (requests générique, aucun
// solde réel déduit — voir data/shared/requests.ts). `ctx.subscription.creditsRemaining` ne se
// rafraîchit qu'à la prochaine navigation (session-context.tsx, hors périmètre).
export default function StudioTemplatePage() {
  return (
    <Suspense fallback={null}>
      <StudioTemplateContent />
    </Suspense>
  );
}

function StudioTemplateContent() {
  const params = useParams<{ template: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { ctx } = useSession();
  const { toastMessage, showToast } = useToast();

  const [template, setTemplate] = useState<StudioTemplate | null | undefined>(undefined);
  const allowed = canAccess(ctx, "studio");
  // Même routage que requests/new/page.tsx : Coach/Académie/Sponsor ET Projet/"generic" n'ont pas
  // de ligne `clubs`, submitClubRequest y échoue toujours (is_club_member ne trouve jamais de
  // club pour leur organization.id).
  const usesGenericRequestsTable = ["coach", "academy", "sponsor", "generic"].includes(ctx.organization.type);
  // Contrairement au routage ci-dessus, Projet EST exclu ici : depuis la v24, il a un vrai solde
  // de crédits (session.ts) et doit afficher "X crédit(s) réservé(s)" comme un club — seuls
  // coach/académie/sponsor n'ont aucun solde réel suivi.
  const noCreditSystemOrg = ["coach", "academy", "sponsor"].includes(ctx.organization.type);

  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [teamNames, setTeamNames] = useState<string[]>([]);

  // `undefined` = en cours de chargement, `null` = confirmé introuvable (code absent ou
  // désactivé en base), voir data/club/studio.ts § fetchStudioTemplate.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    fetchStudioTemplate(supabase, params.template)
      .then((t) => {
        if (!cancelled) setTemplate(t);
      })
      .catch(() => {
        if (!cancelled) setTemplate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [params.template]);

  // Vérifié le 17/08/2026 (brief Fouka, chantier Centre communication §9/§18) : pour un club
  // classique (ctx.organization.type === "club"), usesGenericRequestsTable vaut false, donc la
  // branche `matchId` ci-dessous s'exécute bel et bien — le prefill fonctionne comme prévu.
  // "studio" ajouté à READY_MODULES le 19/08/2026 (audit pré-lancement) : `allowed` est
  // désormais vrai pour tout compte réel. Le CTA "Demander un visuel" de matchcenter/page.tsx et
  // du Centre communication (communication/page.tsx) continue de pointer vers /requests/new
  // (voir requestVisualHref, data/club/matches.ts) — pas modifié ici, hors périmètre de ce
  // déverrouillage.
  useEffect(() => {
    if (!template) return;
    const matchId = searchParams.get("matchId");
    const prefillBody = searchParams.get("prefillBody");

    if (matchId && !usesGenericRequestsTable) {
      const supabase = createClient();
      fetchClubMatchById(supabase, ctx.organization.id, matchId).then((match) => {
        if (!match) return;
        const next: Record<string, string> = { team: match.teamName };
        if (match.opponent) next.opponent = match.opponent;
        if (match.competition) next.competition = match.competition;
        if (match.kickoffAt) next.date = match.kickoffAt.slice(0, 10);
        if (match.venue) next.venue = match.venue;
        if (match.scoreFor !== undefined && match.scoreAgainst !== undefined) {
          next.comment = `${match.teamName} ${match.scoreFor} - ${match.scoreAgainst} ${match.opponent}`;
        }
        setValues((prev) => ({ ...prev, ...next }));
      });
    } else if (prefillBody) {
      setValues((prev) => ({ ...prev, comment: prefillBody }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.code]);

  useEffect(() => {
    if (usesGenericRequestsTable) return;
    const supabase = createClient();
    fetchClubTeams(supabase, ctx.organization.id).then((teams) => setTeamNames(teams.map((t) => t.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.organization.id]);

  if (!allowed) return <LockedModule title={template ? template.name : "Studio Club+"} />;

  if (template === undefined) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  if (!template) {
    return (
      <Card className="mx-auto max-w-lg p-8 text-center">
        <div className="text-[16px] font-extrabold">Modèle introuvable</div>
        <p className="mt-2 text-[13px] text-text-soft">Ce modèle n&apos;existe pas ou plus dans le Studio.</p>
        <Link href="/studio" className="mt-5 inline-block">
          <Button variant="secondary">Retour au Studio</Button>
        </Link>
      </Card>
    );
  }

  const plan = PLANS[ctx.subscription.planCode];
  const remainingAfter =
    plan.monthlyCredits === null ? null : ctx.subscription.creditsRemaining - template.creditCost;
  const hasEnoughCredits = plan.monthlyCredits === null || ctx.subscription.creditsRemaining >= template.creditCost;
  const canSubmit = canCreate(ctx, "visual_request");

  function setField(field: StudioFieldKey, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function composeBodyText(): string {
    const parts = [values.comment];
    for (const field of template!.formFields) {
      if (field === "team" || field === "comment" || field === "photo") continue;
      if (values[field]) parts.push(`${STUDIO_FIELD_LABELS[field]} : ${values[field]}`);
    }
    return parts.filter(Boolean).join("\n");
  }

  function handleSubmit() {
    if (!hasEnoughCredits || !canSubmit) return;
    setSubmitting(true);
    const supabase = createClient();
    const bodyText = composeBodyText();
    const submission = usesGenericRequestsTable
      ? submitOrgRequest(supabase, ctx.organization.id, {
          visualType: inferVisualType(template!),
          bodyText,
          urgency: "standard",
          credits: template!.creditCost,
        })
      : submitClubRequest(supabase, ctx.organization.id, {
          visualType: inferVisualType(template!),
          teamName: values.team || undefined,
          bodyText,
          urgency: "standard",
          credits: template!.creditCost,
        });
    submission
      .then((request) => {
        const creditsSuffix = noCreditSystemOrg
          ? ""
          : ` · ${template!.creditCost} crédit${template!.creditCost > 1 ? "s" : ""} réservé${
              template!.creditCost > 1 ? "s" : ""
            }`;
        showToast(`Demande ${request.reference} envoyée${creditsSuffix}.`);
        setTimeout(() => router.push("/requests"), 650);
      })
      .catch(() => {
        setSubmitting(false);
        showToast("Envoi impossible, réessayez.");
      });
  }

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/studio"
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-brand-blue-electric"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Retour au Studio
      </Link>

      <div>
        <Badge tone="accent">{STUDIO_CATEGORY_LABELS[template.category]}</Badge>
        <h1 className="mt-2 text-[27px] font-extrabold leading-tight tracking-tight">{template.name}</h1>
        <p className="mt-1 text-[13px] text-text-soft">Livraison sous {template.deliveryDelay}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <div className="text-[13.5px] font-extrabold tracking-tight">Aperçu et exemples</div>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {[template.previewUrl, template.sampleUrls[0], template.sampleUrls[1]].map((url, i) => (
                <div
                  key={url}
                  className="flex h-32 items-center justify-center rounded-xl px-2 text-center text-[10.5px] font-mono uppercase tracking-wide text-white/80"
                  style={{
                    background:
                      "repeating-linear-gradient(125deg, #1B2A6B 0px, #1B2A6B 14px, #24327A 14px, #24327A 28px)",
                  }}
                >
                  {i === 0 ? "aperçu du modèle" : `exemple client ${i}`}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-[13.5px] font-extrabold tracking-tight">
              <Check className="h-4 w-4 text-success-fg" aria-hidden />
              Prérempli automatiquement
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {STUDIO_PREFILLED_FIELDS.map((f) => (
                <Badge key={f} tone="neutral">
                  {f}
                </Badge>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] text-text-soft">
              <div>Club : {ctx.organization.name}</div>
              <div>Saison : {currentSeasonLabel()}</div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-[13.5px] font-extrabold tracking-tight">Informations de la création</div>
            <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              {template.formFields.map((field) => (
                <FormField
                  key={field}
                  field={field}
                  value={values[field] ?? ""}
                  onChange={(v) => setField(field, v)}
                  teamNames={teamNames}
                />
              ))}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="border-brand-blue-electric/40 p-4">
            <div className="flex items-center gap-2 text-[13px] font-extrabold tracking-tight text-brand-blue-pale">
              <Sparkles className="h-4 w-4" aria-hidden />
              Coût de la création
            </div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
              Cette création utilisera{" "}
              <strong className="text-text">
                {template.creditCost} crédit{template.creditCost > 1 ? "s" : ""}
              </strong>{" "}
              · livraison sous <strong className="text-text">{template.deliveryDelay}</strong>
              {remainingAfter !== null ? (
                <>
                  {" "}
                  · il vous restera{" "}
                  <strong className="text-text">
                    {Math.max(0, remainingAfter)} crédit{remainingAfter !== 1 ? "s" : ""}
                  </strong>
                </>
              ) : (
                <> · offre sur mesure, suivi avec votre Community Manager</>
              )}
              .
            </p>
            {!hasEnoughCredits && (
              <p className="mt-2 text-[12.5px] font-bold text-danger-fg">
                Crédits insuffisants ce mois-ci. Gérez votre offre pour continuer.
              </p>
            )}
            {!canSubmit && (
              <p className="mt-2 text-[12.5px] font-bold text-warning-fg">
                Votre rôle ne vous permet pas d&apos;effectuer cette action. Contactez l&apos;administrateur du club
                pour demander un accès supplémentaire.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2.5">
              <Button
                variant="primary"
                className="w-full"
                loading={submitting}
                disabled={!hasEnoughCredits || !canSubmit}
                onClick={handleSubmit}
              >
                Envoyer ma demande
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <Toast message={toastMessage} />
    </div>
  );
}

function FormField({
  field,
  value,
  onChange,
  teamNames,
}: {
  field: StudioFieldKey;
  value: string;
  onChange: (value: string) => void;
  teamNames: string[];
}) {
  if (field === "photo") {
    return (
      <label className="col-span-full flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong bg-surface-alt px-4 py-6 text-center transition-colors duration-sv hover:border-brand-blue-electric">
        <UploadCloud className="h-5 w-5 text-text-faint" aria-hidden />
        <span className="text-[12.5px] font-bold text-text-soft">
          {value ? value : "Glissez une photo ou cliquez pour en choisir une"}
        </span>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => onChange(e.target.files?.[0]?.name ?? "")}
        />
      </label>
    );
  }

  if (field === "comment") {
    return (
      <div className="col-span-full flex flex-col gap-1.5">
        <span className="text-[12.5px] font-bold text-text-soft">{STUDIO_FIELD_LABELS[field]}</span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="rounded-sv border border-border-strong bg-input-bg px-3 py-2 text-[13.5px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.1)]"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{STUDIO_FIELD_LABELS[field]}</span>
      <input
        type={field === "date" ? "date" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={field === "team" ? "sv-team-suggestions" : undefined}
        className="h-10 rounded-sv border border-border-strong bg-input-bg px-3 text-[13.5px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.1)]"
      />
      {field === "team" && (
        <datalist id="sv-team-suggestions">
          {teamNames.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      )}
    </div>
  );
}
