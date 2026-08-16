"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export interface OffreOption {
  id: string;
  nom: string;
  categorie: string;
  description: string | null;
  prix_ht: number;
  tva_pct: number | null;
}

export interface GroupOption {
  id: string;
  name: string;
}

type RepartitionMode = "egale" | "libre";

function ttc(o: OffreOption) {
  return Math.round(o.prix_ht * (1 + (o.tva_pct ?? 20) / 100) * 100) / 100;
}
function euros(n: number) {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
}

const CATEGORY_ICON: Record<string, string> = {
  photo: "photo_camera",
  video: "videocam",
  pack: "auto_awesome_motion",
  tournoi: "emoji_events",
  stage: "school",
  shooting: "photo_camera",
  drone: "flight",
  veo: "videocam",
  contenu: "movie",
};

// Bénéficiaire (Espace particulier uniquement, migration-connect-v51-espace-particulier.sql
// §6) : quand fourni, envoyé à create_group_funding() qui revérifie lui-même le droit
// "cotisation" côté serveur avant toute écriture — jamais une confiance dans ce prop. `null`
// (défaut) reproduit exactement le comportement existant côté Espace joueur (cotisation pour
// soi-même, colonnes beneficiary_* laissées NULL).
export interface FundingBeneficiary {
  kind: "linked" | "managed";
  id: string;
  label: string;
}

export function CreateFundingWizard({
  offres,
  groups,
  initialGroupId,
  initialOfferId = null,
  beneficiary = null,
  basePath = "/cotisations",
}: {
  offres: OffreOption[];
  groups: GroupOption[];
  initialGroupId: string | null;
  initialOfferId?: string | null;
  beneficiary?: FundingBeneficiary | null;
  basePath?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | "success">(1);
  const [offreId, setOffreId] = useState<string | null>(initialOfferId);
  const [contexte, setContexte] = useState("");
  const [groupId, setGroupId] = useState<string | null>(initialGroupId);
  const [mode, setMode] = useState<RepartitionMode>("egale");
  const [count, setCount] = useState(10);
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; share_token: string; montant_cible: number } | null>(null);

  const offre = useMemo(() => offres.find((o) => o.id === offreId) || null, [offres, offreId]);
  const goal = offre ? ttc(offre) : 0;
  const perPerson = mode === "egale" && count > 0 ? Math.ceil((goal / count) * 100) / 100 : null;
  const selectedGroup = groups.find((g) => g.id === groupId) || null;

  const stepIndex = step === "success" ? 4 : step - 1;
  const progressPct = Math.min(100, Math.round(((stepIndex + 1) / 4) * 100));

  function minDeadline() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  async function handleCreate() {
    if (!offre || busy) return;
    if (!deadline) {
      setError("Indiquez une date limite.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_group_funding", {
      p_group_id: groupId,
      p_catalogue_offre_id: offre.id,
      p_contexte: contexte.trim() || null,
      p_repartition_mode: mode,
      p_nb_participants: mode === "egale" ? count : null,
      p_date_limite: deadline,
      p_beneficiary_kind: beneficiary?.kind ?? null,
      p_beneficiary_owner_user_id: beneficiary?.kind === "linked" ? beneficiary.id : null,
      p_beneficiary_managed_id: beneficiary?.kind === "managed" ? beneficiary.id : null,
    });
    setBusy(false);
    if (rpcError || !data) {
      setError(rpcError?.message || "Impossible de créer la cotisation pour le moment.");
      return;
    }
    setResult(data as { id: string; share_token: string; montant_cible: number });
    setStep("success");
  }

  if (step === "success" && result) {
    const link = typeof window !== "undefined" ? `${window.location.origin}/cotisation/${result.share_token}` : "";
    return (
      <div className="flex max-w-[620px] flex-col gap-[22px]">
        <div className="flex flex-col gap-2.5">
          <h1 className="font-sora text-[28px] font-bold tracking-tight">Votre cotisation est prête 🎉</h1>
          <p className="text-[15px] text-text-tertiary">Envoyez le lien à vos coéquipiers pour commencer.</p>
        </div>

        <div
          className="rounded-sv-card p-px"
          style={{ background: "linear-gradient(150deg,rgba(244,114,182,.6),rgba(168,85,247,.3) 55%,transparent)" }}
        >
          <div className="flex flex-col gap-3.5 rounded-[calc(theme(borderRadius.sv-modal)-1px)] bg-bg-elevated-accent p-[22px]">
            <span className="font-sora text-[19px] font-semibold tracking-tight">{offre?.nom}</span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-sora text-[30px] font-bold tracking-tight">0 €</span>
              <span className="text-[14px] text-text-tertiary">/ {euros(result.montant_cible)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-sv-pill bg-white/[.08]">
              <div className="h-full w-[2%] rounded-sv-pill bg-sv-gradient-cotisation" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 rounded-sv border border-border-strong bg-surface px-4 py-3.5">
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] text-text-secondary">
            {link}
          </span>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(link)}
            className="flex h-9 flex-none items-center gap-1.5 rounded-sv bg-white/[.09] px-3.5 font-sora text-[13px] font-semibold hover:bg-white/[.16]"
          >
            <span className="material-symbols-rounded !text-[17px]" aria-hidden="true">content_copy</span>
            Copier
          </button>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Participez à notre cotisation « ${offre?.nom} » sur SportVision Connect : ${link}`)}`, "_blank")}
            className="flex h-[54px] items-center justify-center gap-2 rounded-sv bg-sv-gradient font-sora text-[16px] font-semibold text-white hover:brightness-[1.12]"
          >
            <span className="material-symbols-rounded !text-[21px]" aria-hidden="true">chat</span>
            Partager sur WhatsApp
          </button>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={async () => {
                if (navigator.share) {
                  try {
                    await navigator.share({ title: offre?.nom, url: link });
                  } catch {
                    /* partage annulé */
                  }
                } else {
                  navigator.clipboard?.writeText(link);
                }
              }}
              className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-sv border border-border-strong bg-white/[.06] font-sora text-[14px] font-semibold hover:bg-white/[.12]"
            >
              <span className="material-symbols-rounded !text-[19px]" aria-hidden="true">ios_share</span>
              Partager
            </button>
            <button
              type="button"
              onClick={() => {
                router.push(`${basePath}/${result.id}`);
                router.refresh();
              }}
              className="flex h-[50px] flex-1 items-center justify-center rounded-sv border border-border-strong bg-white/[.06] font-sora text-[14px] font-semibold hover:bg-white/[.12]"
            >
              Voir ma cotisation
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-[22px] pb-24 animate-sv-in lg:pb-0">
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={() => (step === 1 ? router.back() : setStep(((step as number) - 1) as 1 | 2 | 3 | 4))}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-sv border border-border bg-surface text-text-secondary hover:bg-surface-hover"
        >
          <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">arrow_back</span>
        </button>
        <div className="h-[5px] flex-1 overflow-hidden rounded-sv-pill bg-white/10">
          <div className="h-full rounded-sv-pill bg-sv-gradient-cotisation transition-[width] duration-300" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="flex-none font-mono text-[11px] text-text-faint">Étape {step}/4</span>
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-[18px]">
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[27px] font-bold tracking-tight">Quelle prestation souhaitez-vous financer ?</h1>
            <p className="text-[15px] text-text-tertiary">Seules les prestations compatibles avec le paiement collectif sont proposées.</p>
          </div>
          {offres.length === 0 ? (
            <div className="rounded-sv-card border border-dashed border-border-strong bg-surface p-6 text-[14px] text-text-tertiary">
              Aucune prestation à tarif fixe n&apos;est disponible pour le moment.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {offres.map((o) => {
                const selected = offreId === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOffreId(o.id)}
                    className={`flex items-center gap-3.5 rounded-sv-card border p-[17px] text-left transition-colors duration-150 ${
                      selected ? "border-[#8CA9FF]/60 bg-[rgba(79,125,255,.12)]" : "border-border bg-surface hover:bg-surface-hover"
                    }`}
                  >
                    <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-sv bg-prestations-bg">
                      <span className="material-symbols-rounded !text-[23px] text-prestations" aria-hidden="true">
                        {CATEGORY_ICON[o.categorie] || "camera_alt"}
                      </span>
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-sora text-[16px] font-semibold">{o.nom}</span>
                      {o.description && <span className="text-[13px] text-text-tertiary">{o.description}</span>}
                    </div>
                    <span className="ml-auto flex-none font-sora text-[15px] font-semibold">{euros(ttc(o))}</span>
                  </button>
                );
              })}
            </div>
          )}
          <Field
            label="Contexte · facultatif"
            placeholder="FC Montereau vs Sens"
            value={contexte}
            onChange={setContexte}
          />
          <NextButton disabled={!offreId} onClick={() => setStep(2)} />
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-[18px]">
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[27px] font-bold tracking-tight">Avec qui souhaitez-vous cotiser ?</h1>
            <p className="text-[15px] text-text-tertiary">
              {offre?.nom} · {euros(goal)}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setGroupId(null)}
              className={`flex items-center gap-3.5 rounded-sv-card border p-[17px] text-left transition-colors duration-150 ${
                groupId === null ? "border-[#8CA9FF]/60 bg-[rgba(79,125,255,.12)]" : "border-border bg-surface hover:bg-surface-hover"
              }`}
            >
              <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-sv bg-white/[.07]">
                <span className="material-symbols-rounded !text-[23px] text-text-secondary" aria-hidden="true">link</span>
              </span>
              <div className="flex flex-col gap-1">
                <span className="font-sora text-[16px] font-semibold">Partage libre</span>
                <span className="text-[13px] text-text-tertiary">Sans groupe : n&apos;importe qui avec le lien peut participer.</span>
              </div>
              {groupId === null && (
                <span className="material-symbols-rounded ml-auto !text-[22px] text-affiliations" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
                  check_circle
                </span>
              )}
            </button>
            {groups.map((g) => {
              const selected = groupId === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroupId(g.id)}
                  className={`flex items-center gap-3.5 rounded-sv-card border p-[17px] text-left transition-colors duration-150 ${
                    selected ? "border-[#8CA9FF]/60 bg-[rgba(79,125,255,.12)]" : "border-border bg-surface hover:bg-surface-hover"
                  }`}
                >
                  <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-sv bg-affiliations-bg">
                    <span className="material-symbols-rounded !text-[23px] text-affiliations" aria-hidden="true">groups</span>
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-sora text-[16px] font-semibold">{g.name}</span>
                  </div>
                  {selected && (
                    <span className="material-symbols-rounded ml-auto !text-[22px] text-affiliations" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
                      check_circle
                    </span>
                  )}
                </button>
              );
            })}
            {groups.length === 0 && (
              <p className="text-[13px] text-text-faint">
                Vous n&apos;avez pas encore d&apos;équipe — créez-en une depuis « Mes équipes », ou continuez en partage libre.
              </p>
            )}
          </div>
          <NextButton onClick={() => setStep(3)} />
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[27px] font-bold tracking-tight">Comment répartir le montant ?</h1>
            <p className="text-[15px] text-text-tertiary">Objectif total : {euros(goal)}</p>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <ModeCard
              icon="balance"
              label="Parts égales"
              sub="Le montant est divisé entre un nombre de participants."
              selected={mode === "egale"}
              onClick={() => setMode("egale")}
            />
            <ModeCard
              icon="volunteer_activism"
              label="Participation libre"
              sub="Chacun donne le montant qu'il souhaite."
              selected={mode === "libre"}
              onClick={() => setMode("libre")}
            />
          </div>

          {mode === "egale" ? (
            <div className="flex flex-col gap-[18px] rounded-sv-card border border-border-strong bg-surface p-[22px]">
              <span className="text-[13px] font-medium text-text-secondary">Combien de personnes ?</span>
              <div className="flex flex-wrap items-center gap-[18px]">
                <div className="flex items-center gap-3.5">
                  <button
                    type="button"
                    onClick={() => setCount((c) => Math.max(2, c - 1))}
                    className="flex h-12 w-12 items-center justify-center rounded-sv border border-border-strong bg-white/[.06] hover:bg-white/[.14]"
                  >
                    <span className="material-symbols-rounded !text-[22px]" aria-hidden="true">remove</span>
                  </button>
                  <span className="min-w-[52px] text-center font-sora text-[28px] font-bold tracking-tight">{count}</span>
                  <button
                    type="button"
                    onClick={() => setCount((c) => Math.min(100, c + 1))}
                    className="flex h-12 w-12 items-center justify-center rounded-sv border border-border-strong bg-white/[.06] hover:bg-white/[.14]"
                  >
                    <span className="material-symbols-rounded !text-[22px]" aria-hidden="true">add</span>
                  </button>
                </div>
                <div className="flex-1 rounded-sv p-px" style={{ minWidth: 180, background: "linear-gradient(120deg,rgba(168,85,247,.6),rgba(244,114,182,.4))" }}>
                  <div className="flex flex-col gap-1 rounded-[15px] bg-bg-elevated-accent px-[18px] py-4">
                    <span className="font-sora text-[26px] font-bold tracking-tight">{perPerson != null ? euros(perPerson) : "—"}</span>
                    <span className="text-[13px] text-text-tertiary">par personne · objectif {euros(goal)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-sv-card border border-border-strong bg-surface p-[22px]">
              <span className="font-sora text-[20px] font-semibold tracking-tight">Objectif : {euros(goal)}</span>
              <span className="text-[14px] leading-relaxed text-text-tertiary">
                Chacun participe du montant qu&apos;il souhaite jusqu&apos;à atteindre l&apos;objectif.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="cot-deadline" className="text-[13px] font-medium text-text-secondary">
              Fin de la cotisation
            </label>
            <input
              id="cot-deadline"
              type="date"
              min={minDeadline()}
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="h-[52px] max-w-[280px] rounded-sv border border-border-strong bg-surface px-4 text-[15px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.22)]"
              style={{ colorScheme: "dark" }}
            />
            <span className="text-[12px] text-text-faint">Proposez une date avant la prestation.</span>
          </div>

          <NextButton disabled={!deadline} onClick={() => setStep(4)} />
        </div>
      )}

      {step === 4 && offre && (
        <div className="flex flex-col gap-[18px]">
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[27px] font-bold tracking-tight">Votre cotisation</h1>
            <p className="text-[15px] text-text-tertiary">Vérifiez avant de créer le lien de partage.</p>
          </div>
          <div className="flex flex-col gap-3.5 rounded-sv-card border border-border-strong bg-surface p-[22px]">
            {beneficiary && <RecapLine label="Bénéficiaire" value={beneficiary.label} />}
            <RecapLine label="Prestation" value={offre.nom} />
            {contexte.trim() && <RecapLine label="Contexte" value={contexte.trim()} />}
            <RecapLine label="Groupe" value={selectedGroup ? selectedGroup.name : "Partage libre (sans groupe)"} />
            <RecapLine label="Répartition" value={mode === "egale" ? `Parts égales · ${count} participants` : "Participation libre"} />
            {mode === "egale" && perPerson != null && <RecapLine label="Part par personne" value={euros(perPerson)} />}
            <RecapLine label="Montant total" value={euros(goal)} />
            <RecapLine label="Date limite" value={deadline ? new Date(deadline).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—"} />
          </div>
          {error && (
            <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
              <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
              <span className="text-[13px] leading-relaxed text-[#FBCFE8]">{error}</span>
            </div>
          )}
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            className="hidden h-[54px] items-center justify-center gap-2 self-start rounded-sv bg-sv-gradient px-6 font-sora text-[16px] font-semibold text-white hover:brightness-[1.12] disabled:cursor-wait disabled:opacity-75 lg:flex"
          >
            {busy && <span className="h-[18px] w-[18px] animate-sv-spin rounded-full border-2 border-white/35 border-t-white" />}
            Créer la cotisation
          </button>
        </div>
      )}

      {/* CTA sticky mobile (README § Mobile : "création de cotisation") — reprend l'action du
          pas courant, au-dessus de la bottom nav de l'AppShell (safe-area incluse). */}
      <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 border-t border-border bg-bg/95 p-3.5 backdrop-blur-md lg:hidden">
        {step === 1 && (
          <button
            type="button"
            onClick={() => setStep(2)}
            disabled={!offreId}
            className="flex h-14 w-full items-center justify-center rounded-sv bg-sv-gradient font-sora text-[15px] font-semibold text-white hover:brightness-[1.12] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Continuer
          </button>
        )}
        {step === 2 && (
          <button
            type="button"
            onClick={() => setStep(3)}
            className="flex h-14 w-full items-center justify-center rounded-sv bg-sv-gradient font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]"
          >
            Continuer
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            onClick={() => setStep(4)}
            disabled={!deadline}
            className="flex h-14 w-full items-center justify-center rounded-sv bg-sv-gradient font-sora text-[15px] font-semibold text-white hover:brightness-[1.12] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Continuer
          </button>
        )}
        {step === 4 && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-sv bg-sv-gradient font-sora text-[15px] font-semibold text-white hover:brightness-[1.12] disabled:cursor-wait disabled:opacity-75"
          >
            {busy && <span className="h-[18px] w-[18px] animate-sv-spin rounded-full border-2 border-white/35 border-t-white" />}
            Créer la cotisation
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[13px] font-medium text-text-secondary">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-[52px] w-full rounded-sv border border-border-strong bg-surface px-4 text-[15px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.22)]"
      />
    </div>
  );
}

function NextButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="hidden h-[52px] items-center justify-center self-start rounded-sv bg-sv-gradient px-6 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12] disabled:cursor-not-allowed disabled:opacity-45 lg:flex"
    >
      Continuer
    </button>
  );
}

function ModeCard({
  icon,
  label,
  sub,
  selected,
  onClick,
}: {
  icon: string;
  label: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-2.5 rounded-sv-card border p-[19px] text-left transition-colors duration-150 ${
        selected ? "border-[#8CA9FF]/60 bg-[rgba(79,125,255,.12)]" : "border-border bg-surface hover:bg-surface-hover"
      }`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-sv bg-cotisations-bg">
        <span className="material-symbols-rounded !text-[22px] text-cotisations" aria-hidden="true">{icon}</span>
      </span>
      <span className="font-sora text-[17px] font-semibold tracking-tight">{label}</span>
      <span className="text-[13px] leading-relaxed text-text-tertiary">{sub}</span>
    </button>
  );
}

function RecapLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[14px] text-text-tertiary">{label}</span>
      <span className="ml-auto text-right text-[14px] font-medium">{value}</span>
    </div>
  );
}
