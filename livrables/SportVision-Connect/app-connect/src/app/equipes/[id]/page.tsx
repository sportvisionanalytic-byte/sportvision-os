import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { gradientFor } from "@/lib/avatarGradients";
import { InviteGroupButton } from "./InviteGroupButton";

interface GroupMember {
  user_id: string;
  role: "createur" | "membre";
  name: string;
  initial: string;
}

interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  member_count: number;
  members: GroupMember[];
  active_funding: {
    id: string;
    titre: string;
    montant_cible: number;
    montant_collecte: number;
    statut: string;
  } | null;
}

function euros(n: number) {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
}

// Page de groupe — voir design-connect-personnel-12-08/README.md § Mes équipes. Backend :
// get_group_detail() (migration-connect-v50), retourne null si l'appelant n'est pas membre —
// traité comme "introuvable", jamais une page d'erreur technique (§35 du master doc).
//
// "Prestations" du groupe (design) n'a aucune table de liaison réelle aujourd'hui (aucune
// colonne group_id sur prestations/client_prestations) — affiché en état vide honnête plutôt
// qu'une liste inventée, voir rapport final.
export default async function EquipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  const { data } = await supabase.rpc("get_group_detail", { p_group_id: id });
  const group = data as GroupDetail | null;
  if (!group) notFound();

  const funding = group.active_funding;
  const pct = funding ? Math.min(100, Math.round((funding.montant_collecte / funding.montant_cible) * 100)) : 0;

  return (
    <AppShell firstName={firstName}>
      <div className="flex flex-col gap-[22px] animate-sv-in">
        <Link href="/equipes" className="flex items-center gap-2 self-start text-[13px] font-medium text-text-tertiary hover:text-text">
          <span className="material-symbols-rounded !text-[18px]">arrow_back</span>
          Mes équipes
        </Link>

        <div
          className="rounded-sv-card p-px"
          style={{ background: "linear-gradient(130deg,rgba(34,211,238,.5),rgba(168,85,247,.2) 60%,transparent)" }}
        >
          <div className="flex flex-col gap-[18px] rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-[22px]">
            <div className="flex flex-wrap items-center gap-4">
              <span
                className="flex h-[62px] w-[62px] flex-none items-center justify-center rounded-sv font-sora text-[20px] font-semibold text-white"
                style={{ background: gradientFor(group.id) }}
              >
                {group.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <h1 className="font-sora text-[26px] font-bold tracking-tight">{group.name}</h1>
                <span className="text-[13px] text-text-tertiary">{group.member_count} membres</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2.5">
              <InviteGroupButton groupId={group.id} groupName={group.name} />
              <Link
                href="/prestations"
                className="flex h-[46px] items-center gap-2 rounded-sv border border-border-strong bg-white/[.06] px-[18px] font-sora text-[14px] font-semibold hover:bg-white/[.12]"
              >
                <span className="material-symbols-rounded !text-[19px] text-[#8CA9FF]">camera_alt</span>
                Réserver une prestation
              </Link>
              <Link
                href={`/cotisations/creer?groupe=${group.id}`}
                className="flex h-[46px] items-center gap-2 rounded-sv border border-border-strong bg-white/[.06] px-[18px] font-sora text-[14px] font-semibold hover:bg-white/[.12]"
              >
                <span className="material-symbols-rounded !text-[19px] text-cotisations">savings</span>
                Créer une cotisation
              </Link>
            </div>
            <span className="text-[12px] leading-relaxed text-text-faint">
              Une cotisation sert uniquement à financer une prestation SportVision : vous choisissez d&apos;abord la
              prestation, puis la répartition entre les membres.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-[13px]">
            <div className="flex items-center gap-2.5">
              <h2 className="font-sora text-[18px] font-semibold tracking-tight">Membres</h2>
              <span className="rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[12px] font-medium text-text-tertiary">
                {group.member_count}
              </span>
            </div>
            <div className="flex flex-col gap-2.5">
              {group.members.map((m) => (
                <div
                  key={m.user_id}
                  className="flex items-center gap-3 rounded-sv border border-border bg-surface px-3.5 py-3"
                >
                  <span
                    className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full font-sora text-[13px] font-semibold text-white"
                    style={{ background: gradientFor(m.user_id) }}
                  >
                    {m.initial}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[14px] font-medium">{m.name}</span>
                    <span className="text-[12px] text-text-tertiary">{m.role === "createur" ? "Créateur" : "Membre"}</span>
                  </div>
                  {m.role === "createur" && (
                    <span className="ml-auto flex-none rounded-sv-pill bg-affiliations-bg px-2.5 py-1 text-[11px] font-medium text-affiliations">
                      Créateur
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-[18px]">
            <div className="flex flex-col gap-[13px]">
              <h2 className="font-sora text-[18px] font-semibold tracking-tight">Cotisations</h2>
              {funding ? (
                <Link
                  href={`/cotisations/${funding.id}`}
                  className="flex flex-col gap-3 rounded-sv border border-cotisations/30 bg-surface p-[18px] hover:bg-surface-hover"
                >
                  <div className="flex items-center justify-between gap-2.5">
                    <span className="font-sora text-[15px] font-semibold">{funding.titre}</span>
                    <span className="rounded-sv-pill bg-cotisations-bg px-2.5 py-1 text-[11px] font-medium text-cotisations">
                      {funding.statut === "objectif_atteint" ? "Objectif atteint" : "En cours"}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-sora text-[20px] font-bold tracking-tight">{euros(funding.montant_collecte)}</span>
                    <span className="text-[13px] text-text-tertiary">/ {euros(funding.montant_cible)}</span>
                  </div>
                  <div className="h-[7px] overflow-hidden rounded-sv-pill bg-white/[.08]">
                    <div className="h-full rounded-sv-pill bg-sv-gradient-cotisation" style={{ width: `${pct}%` }} />
                  </div>
                </Link>
              ) : (
                <div className="flex flex-col gap-2 rounded-sv border border-dashed border-border-strong bg-white/[.04] p-[18px]">
                  <span className="text-[14px] font-medium">Aucune cotisation en cours</span>
                  <span className="text-[13px] leading-relaxed text-text-tertiary">
                    Financez votre prochaine prestation avec ce groupe.
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-[13px]">
              <h2 className="font-sora text-[18px] font-semibold tracking-tight">Prestations</h2>
              <div className="flex flex-col gap-2 rounded-sv border border-dashed border-border-strong bg-white/[.04] p-[18px]">
                <span className="text-[13px] leading-relaxed text-text-tertiary">
                  Aucune prestation liée à ce groupe pour le moment.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
