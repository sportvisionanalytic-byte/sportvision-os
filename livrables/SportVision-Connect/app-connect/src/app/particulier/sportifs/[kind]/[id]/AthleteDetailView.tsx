"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDateLong, formatEUR } from "@/lib/prestations/format";
import { gradientFor } from "@/lib/avatarGradients";
import { ATHLETE_STATUS_LABEL, ATHLETE_STATUS_COLOR } from "@/lib/supabase/particulier";

export interface AthleteDetail {
  kind: "linked" | "managed";
  ref_id: string;
  first_name: string;
  last_name: string;
  sport: string | null;
  categorie: string | null;
  club_nom: string | null;
  club_id: string | null;
  relation_label: string;
  status: "actif" | "gere";
  client_id: string | null;
  relationship_id: string | null;
  rights: {
    voir: boolean;
    download: boolean;
    reserver: boolean;
    commandes: boolean;
    factures: boolean;
    payer: boolean;
    cotisation: boolean;
    calendrier: boolean;
    modifier: boolean;
  };
  next_prestation: { id: string; reference: string; statut: string; date: string | null; lieu: string | null } | null;
  next_event: { title: string; date: string; time: string | null; location: string | null } | null;
  funding: { id: string; titre: string; montant_cible: number; montant_collecte: number } | null;
}

const RIGHT_LABELS: { key: keyof AthleteDetail["rights"]; label: string; icon: string }[] = [
  { key: "voir", label: "Voir les contenus", icon: "photo_library" },
  { key: "download", label: "Télécharger les contenus", icon: "download" },
  { key: "reserver", label: "Réserver une prestation", icon: "camera_alt" },
  { key: "payer", label: "Effectuer des paiements", icon: "credit_card" },
  { key: "cotisation", label: "Créer ou participer à une cotisation", icon: "savings" },
  { key: "calendrier", label: "Voir le calendrier SportVision", icon: "calendar_month" },
  { key: "commandes", label: "Suivre les commandes", icon: "receipt_long" },
  { key: "modifier", label: "Modifier le profil", icon: "edit" },
  { key: "factures", label: "Voir les factures", icon: "receipt" },
];

type Tab = "apercu" | "contenus" | "prestations" | "calendrier" | "cotisations" | "acces";

const TABS: { id: Tab; label: string }[] = [
  { id: "apercu", label: "Aperçu" },
  { id: "contenus", label: "Contenus" },
  { id: "prestations", label: "Prestations" },
  { id: "calendrier", label: "Calendrier" },
  { id: "cotisations", label: "Cotisations" },
  { id: "acces", label: "Accès & autorisations" },
];

// Les onglets Contenus/Prestations/Calendrier/Cotisations sont des RENVOIS vers les listes
// multi-sportifs déjà filtrées par ce sportif (README, section "athTabLink" du prototype de
// référence : une carte icône+titre+texte+CTA, pas un module dupliqué) — évite de reconstruire
// une galerie/un calendrier/une liste de cotisations complète à l'intérieur de la fiche, cohérent
// avec le comportement du prototype lui-même.
const LINK_TABS: Record<"contenus" | "prestations" | "calendrier" | "cotisations", { icon: string; color: string; bg: string; title: string; text: string; href: string; cta: string }> = {
  contenus: {
    icon: "photo_library", color: "#C084FC", bg: "rgba(168,85,247,.16)",
    title: "Ses contenus", text: "Retrouvez les photos et vidéos livrées pour ce sportif, filtrées automatiquement.",
    href: "contenus", cta: "Voir les contenus",
  },
  prestations: {
    icon: "receipt_long", color: "#8CA9FF", bg: "rgba(79,125,255,.16)",
    title: "Ses commandes", text: "Suivez les prestations réservées pour ce sportif, quel que soit leur statut.",
    href: "commandes", cta: "Voir les commandes",
  },
  calendrier: {
    icon: "calendar_month", color: "#4F7DFF", bg: "rgba(79,125,255,.16)",
    title: "Son calendrier", text: "Les événements SportVision liés au club de ce sportif.",
    href: "calendrier", cta: "Voir le calendrier",
  },
  cotisations: {
    icon: "savings", color: "#F472B6", bg: "rgba(244,114,182,.14)",
    title: "Ses cotisations", text: "Les cotisations créées pour financer une prestation de ce sportif.",
    href: "cotisations", cta: "Voir les cotisations",
  },
};

export function AthleteDetailView({ detail }: { detail: AthleteDetail }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("apercu");
  // Lecture seule ici (voir commentaire LINK_TABS ci-dessus) : rights ne provient que de detail,
  // aucune action de cette vue ne les modifie — un useState avec un setter jamais appelé était du
  // code mort.
  const rights = detail.rights;
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const isManaged = detail.kind === "managed";
  const sportifKey = `${detail.kind}:${detail.ref_id}`;
  const fullName = `${detail.first_name} ${detail.last_name}`.trim();
  // Statut dérivé des droits réels plutôt que de detail.status : même règle que la liste "Mes
  // sportifs" (deriveStatus dans lib/supabase/particulier.ts) — un sportif lié dont les 3 droits
  // les plus consultés (voir/commandes/calendrier) ne sont pas TOUS accordés doit afficher "Accès
  // limité" ici aussi. Avant ce correctif, cette fiche affichait toujours "Accès actif" pour tout
  // sportif lié, y compris ceux marqués "Accès limité" dans la liste — contradiction directe entre
  // les deux écrans pour la même donnée.
  const derivedStatus: "actif" | "limite" | "gere" = isManaged
    ? "gere"
    : rights.voir && rights.commandes && rights.calendrier
      ? "actif"
      : "limite";
  const statusLabel = ATHLETE_STATUS_LABEL[derivedStatus];
  const statusColor = ATHLETE_STATUS_COLOR[derivedStatus];

  async function removeAthlete() {
    setRemoving(true);
    setRemoveError(null);
    const supabase = createClient();
    if (isManaged) {
      const { error } = await supabase.from("managed_athlete_profiles").delete().eq("id", detail.ref_id);
      setRemoving(false);
      if (error) {
        setRemoveError("Impossible de retirer ce profil pour le moment.");
        return;
      }
    } else {
      const { error } = await supabase.rpc("connect_remove_athlete_relationship", { p_id: detail.relationship_id });
      setRemoving(false);
      if (error) {
        setRemoveError("Impossible de retirer ce sportif pour le moment.");
        return;
      }
    }
    router.push("/particulier/sportifs");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/particulier/sportifs" className="flex items-center gap-2 self-start text-[13px] font-medium text-text-tertiary hover:text-text">
        <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
        Mes sportifs
      </Link>

      <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(130deg,rgba(34,211,238,.5),rgba(168,85,247,.22) 60%,transparent)" }}>
        <div className="flex flex-col gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
          <div className="flex flex-wrap items-center gap-4">
            <span
              className="flex h-[62px] w-[62px] flex-none items-center justify-center rounded-sv font-sora text-[20px] font-semibold text-white"
              style={{ background: gradientFor(sportifKey) }}
            >
              {(detail.first_name[0] || "?").toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">{fullName}</h1>
              <span className="text-[14px] text-text-tertiary">{[detail.sport, detail.categorie].filter(Boolean).join(" · ") || "—"}</span>
              <div className="flex flex-wrap items-center gap-2">
                {detail.club_nom && <span className="text-[13px] text-text-secondary">{detail.club_nom}</span>}
                <span className="rounded-sv-pill px-2.5 py-1 text-[12px] font-medium" style={{ color: statusColor.fg, background: statusColor.bg }}>
                  {statusLabel}
                </span>
              </div>
            </div>
            <span className="ml-auto flex-none rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[12px] font-medium text-text-secondary">
              Vous êtes : {detail.relation_label}
            </span>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {rights.reserver && (
              <Link
                href={`/particulier/prestations?benefKind=${detail.kind}&benefId=${detail.ref_id}`}
                className="flex h-12 items-center gap-2 rounded-sv bg-sv-gradient px-5 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]"
              >
                <span className="material-symbols-rounded !text-[19px]" aria-hidden="true">camera_alt</span>
                Réserver pour {detail.first_name}
              </Link>
            )}
            {rights.voir && (
              <Link
                href={`/particulier/contenus?sportif=${sportifKey}`}
                className="flex h-12 items-center rounded-sv border border-border-strong bg-white/[.06] px-4 font-sora text-[14px] font-semibold hover:bg-white/[.12]"
              >
                Ses contenus
              </Link>
            )}
            {rights.commandes && (
              <Link
                href={`/particulier/commandes?sportif=${sportifKey}`}
                className="flex h-12 items-center rounded-sv border border-border-strong bg-white/[.06] px-4 font-sora text-[14px] font-semibold hover:bg-white/[.12]"
              >
                Ses commandes
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-sv-pill border px-[17px] py-[11px] text-[14px] font-medium transition-colors duration-150 ${
              tab === t.id ? "border-[rgba(140,169,255,.65)] bg-[rgba(79,125,255,.2)] text-text" : "border-border text-text-tertiary hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "apercu" && (
        <div className="grid grid-cols-1 gap-4.5 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)] lg:items-start">
          <div className="flex flex-col gap-3.5">
            {detail.next_prestation && (
              <OverviewCard
                kind="Prochaine prestation"
                icon="camera_alt" color="#8CA9FF" bg="rgba(79,125,255,.16)"
                title={detail.next_prestation.reference}
                sub={formatDateLong(detail.next_prestation.date)}
                href={`/particulier/commandes?sportif=${sportifKey}`}
              />
            )}
            {detail.next_event && (
              <OverviewCard
                kind="Prochain événement"
                icon="event" color="#22D3EE" bg="rgba(34,211,238,.14)"
                title={detail.next_event.title}
                sub={`${formatDateLong(detail.next_event.date)}${detail.next_event.time ? ` · ${detail.next_event.time}` : ""}`}
                href={`/particulier/calendrier?sportif=${sportifKey}`}
              />
            )}
            {detail.funding && (
              <OverviewCard
                kind="Cotisation en cours"
                icon="savings" color="#F472B6" bg="rgba(244,114,182,.14)"
                title={detail.funding.titre}
                sub={`${formatEUR(detail.funding.montant_collecte)} / ${formatEUR(detail.funding.montant_cible)}`}
                href={`/particulier/cotisations/${detail.funding.id}`}
              />
            )}
            {!detail.next_prestation && !detail.next_event && !detail.funding && (
              <div className="flex flex-col gap-2 rounded-sv-card border border-dashed border-border-strong bg-white/[.04] p-5">
                <span className="font-sora text-[17px] font-semibold">Rien à signaler pour le moment</span>
                <span className="text-[13.5px] leading-relaxed text-text-tertiary">
                  Les prestations, contenus et cotisations de {detail.first_name} apparaîtront ici.
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {detail.club_nom && (
              <div className="flex flex-col gap-3 rounded-sv-card border border-border bg-surface p-5">
                <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">Affiliation principale</span>
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-sv bg-white/5 font-mono text-[7px] text-text-faint">logo</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-sora text-[15px] font-semibold">{detail.club_nom}</span>
                    <span className="text-[12px] text-text-tertiary">{detail.categorie || ""}</span>
                  </div>
                  <span className="ml-auto flex-none rounded-sv-pill bg-affiliations-bg px-2.5 py-1 text-[11px] font-medium text-affiliations">✓ Affilié</span>
                </div>
                <span className="text-[12px] leading-relaxed text-text-faint">Vous consultez l&apos;affiliation, sans accès à la gestion du club.</span>
              </div>
            )}

            <div className="flex flex-col gap-2.5 rounded-sv-card border border-border bg-white/[.04] p-5">
              <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">Votre accès</span>
              {RIGHT_LABELS.filter((r) => rights[r.key]).slice(0, 3).map((r) => (
                <div key={r.key} className="flex items-center gap-2.5">
                  <span className="material-symbols-rounded !text-[18px] text-affiliations" aria-hidden="true">{r.icon}</span>
                  <span className="text-[13px] text-text-secondary">{r.label}</span>
                </div>
              ))}
              <button type="button" onClick={() => setTab("acces")} className="mt-0.5 self-start text-[13px] font-semibold text-prestations">
                Voir les autorisations
              </button>
            </div>
          </div>
        </div>
      )}

      {(tab === "contenus" || tab === "prestations" || tab === "calendrier" || tab === "cotisations") && (
        <div className="flex max-w-[600px] flex-col gap-3 rounded-sv-card border border-border bg-white/[.04] p-6">
          <span
            className="flex h-[46px] w-[46px] items-center justify-center rounded-sv"
            style={{ background: LINK_TABS[tab].bg }}
          >
            <span className="material-symbols-rounded !text-[23px]" style={{ color: LINK_TABS[tab].color }} aria-hidden="true">
              {LINK_TABS[tab].icon}
            </span>
          </span>
          <span className="font-sora text-[18px] font-semibold">{LINK_TABS[tab].title}</span>
          <p className="text-[14px] leading-relaxed text-text-tertiary">{LINK_TABS[tab].text}</p>
          <Link
            href={`/particulier/${LINK_TABS[tab].href}?sportif=${sportifKey}`}
            className="flex h-[46px] w-fit items-center gap-2 rounded-sv border border-border-strong bg-white/[.06] px-[18px] font-sora text-[14px] font-semibold hover:bg-white/[.12]"
          >
            {LINK_TABS[tab].cta}
            <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_forward</span>
          </Link>
        </div>
      )}

      {tab === "acces" && (
        <div className="flex max-w-[720px] flex-col gap-[18px]">
          <p className="text-[15px] leading-relaxed text-text-tertiary">
            Voici ce que {detail.first_name} (ou son responsable légal) vous a autorisé à faire. Ces droits ne
            dépendent pas du lien déclaré.
          </p>
          <div className="flex flex-col gap-2.5">
            {RIGHT_LABELS.map((r) => {
              const on = rights[r.key];
              return (
                <div key={r.key} className="flex items-center gap-3 rounded-sv border border-border bg-surface p-[15px]">
                  <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-sv bg-white/5">
                    <span className="material-symbols-rounded !text-[19px]" style={{ color: on ? "#22D3EE" : "#7A7A9C" }} aria-hidden="true">
                      {r.icon}
                    </span>
                  </span>
                  <span className="text-[14px] font-medium" style={{ color: on ? "#F7F7FB" : "#9A9AB8" }}>
                    {r.label}
                  </span>
                  <span
                    className="ml-auto flex-none rounded-sv-pill px-2.5 py-1 text-[12px] font-medium"
                    style={on ? { color: "#22D3EE", background: "rgba(34,211,238,.14)" } : { color: "#9A9AB8", background: "rgba(255,255,255,.07)" }}
                  >
                    {on ? "Autorisé" : "Non autorisé"}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-start gap-2.5 rounded-sv border border-border bg-white/[.04] px-[18px] py-4">
            <span className="material-symbols-rounded !text-[19px] text-text-faint" aria-hidden="true">info</span>
            <span className="text-[13px] leading-relaxed text-text-tertiary">
              Ces autorisations sont vérifiées côté serveur à chaque action. Pour les mineurs, leur application reste
              soumise à une validation juridique du responsable légal.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 rounded-sv-card border border-danger-border bg-danger-bg p-[18px]">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-sora text-[15px] font-semibold">Retirer {isManaged ? "ce profil" : "ce sportif"}</span>
              <span className="text-[13px] text-text-tertiary">
                {isManaged ? "Le profil géré est supprimé définitivement." : "La relation est supprimée. Le compte du sportif est conservé."}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="ml-auto flex h-11 flex-none items-center rounded-sv border border-danger-border bg-[rgba(244,114,182,.08)] px-4 font-sora text-[14px] font-semibold text-danger hover:bg-[rgba(244,114,182,.16)]"
            >
              Retirer
            </button>
          </div>
          {removeError && <span className="text-[13px] text-danger">{removeError}</span>}
        </div>
      )}

      {confirmingRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/66 p-6" onClick={() => !removing && setConfirmingRemove(false)}>
          <div className="flex max-h-[90vh] w-full max-w-[420px] flex-col gap-4 overflow-y-auto rounded-sv-modal border border-border bg-bg-elevated p-6" onClick={(e) => e.stopPropagation()}>
            <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-danger-bg">
              <span className="material-symbols-rounded !text-[24px] text-danger" aria-hidden="true">warning</span>
            </span>
            <div className="flex flex-col gap-2">
              <span className="font-sora text-[19px] font-semibold">Retirer {fullName} ?</span>
              <span className="text-[14px] leading-relaxed text-text-tertiary">
                {isManaged
                  ? "Ce profil géré sera supprimé. Cette action est définitive."
                  : "Vous ne pourrez plus consulter ses données. Il devra vous envoyer une nouvelle invitation pour vous redonner accès."}
              </span>
            </div>
            <div className="mt-1 flex gap-2.5">
              <button type="button" onClick={() => setConfirmingRemove(false)} disabled={removing} className="flex-1 rounded-sv border border-border-strong bg-surface py-2.5 font-sora text-[14px] font-semibold hover:bg-surface-hover">
                Annuler
              </button>
              <button type="button" onClick={removeAthlete} disabled={removing} className="flex-1 rounded-sv border border-danger-border bg-danger-bg py-2.5 font-sora text-[14px] font-semibold text-danger hover:bg-[rgba(244,114,182,.16)]">
                {removing ? "…" : "Retirer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewCard({ kind, icon, color, bg, title, sub, href }: { kind: string; icon: string; color: string; bg: string; title: string; sub: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-3.5 rounded-sv-card border border-border bg-surface p-[18px] hover:bg-white/[.09]">
      <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-sv" style={{ background: bg }}>
        <span className="material-symbols-rounded !text-[22px]" style={{ color }} aria-hidden="true">{icon}</span>
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">{kind}</span>
        <span className="font-sora text-[16px] font-semibold">{title}</span>
        <span className="text-[13px] text-text-tertiary">{sub}</span>
      </div>
    </Link>
  );
}
