"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { gradientFor } from "@/lib/avatarGradients";
import { ATHLETE_STATUS_LABEL, ATHLETE_STATUS_COLOR, particulierSportifsLabel, type AthleteRow } from "@/lib/supabase/particulier";
import { AGENT_TIER_LABEL, type AgentSubscriptionInfo } from "@/lib/supabase/agentSubscription";

export function AthletesListView({
  athletes,
  agentInfo,
  profilParticulier,
  particulierLimit,
  particulierTotal,
}: {
  athletes: AthleteRow[];
  agentInfo: AgentSubscriptionInfo;
  // profil_particulier (migration-connect-v67-distinction-parent-agent.sql §1) — pilote le
  // libellé "Mes sportifs"/"Mes enfants"/"Mes sportifs suivis" ci-dessous, et la bannière de
  // plafond parent/tuteur/autre plus bas (jamais affichée pour un compte agent, qui a déjà sa
  // propre bannière palier Stripe ci-dessous, plus riche — voir son commentaire).
  profilParticulier: string | null;
  particulierLimit: number | null;
  particulierTotal: number | null;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return athletes;
    const q = query.trim().toLowerCase();
    return athletes.filter(
      (a) =>
        `${a.firstName} ${a.lastName}`.toLowerCase().includes(q) ||
        (a.sport || "").toLowerCase().includes(q) ||
        (a.clubNom || "").toLowerCase().includes(q),
    );
  }, [athletes, query]);

  const sportifsLabel = particulierSportifsLabel(profilParticulier);

  // Plafond dur parent/tuteur/autre (connect_particulier_limit/connect_particulier_total_
  // sportifs_count, migration-connect-v67 §2-3) — jamais affiché pour un compte agent : son
  // palier payant a déjà sa propre bannière ci-dessous (agentInfo, liée à Stripe), plus riche
  // (statut d'abonnement, CTA "Gérer mon abonnement"). 999 = pas de plafond réel (profil jamais
  // choisi, compte antérieur à la migration) — jamais de bannière dans ce cas non plus.
  const showParticulierLimitBanner =
    profilParticulier !== null &&
    profilParticulier !== "agent" &&
    particulierLimit !== null &&
    particulierLimit < 999 &&
    particulierTotal !== null;
  const particulierUsagePct =
    showParticulierLimitBanner && particulierLimit! > 0
      ? Math.min(100, Math.round((particulierTotal! / particulierLimit!) * 100))
      : 0;
  const particulierLimitReached = showParticulierLimitBanner && particulierTotal! >= particulierLimit!;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[33px] font-bold tracking-tight">{sportifsLabel}</h1>
          <p className="max-w-[560px] text-[15px] text-text-tertiary">
            Les sportifs que vous accompagnez et ce que vous êtes autorisé à consulter.
          </p>
        </div>
        <Link
          href="/particulier/sportifs/ajouter"
          className="flex h-[46px] flex-none items-center gap-2 rounded-sv bg-sv-gradient px-[18px] font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]"
        >
          <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">add</span>
          Ajouter un sportif
        </Link>
      </div>

      {/* Bannière plafond particulier (parent/tuteur/autre, migration-connect-v67) — même pattern
          visuel que la barre de progression de AbonnementView.tsx (usagePct), adapté au contexte
          "Mes sportifs" plutôt que "Mon abonnement" : pas de palier payant à proposer ici (plafond
          dur à 3), donc pas de CTA, juste "contactez SportVision" une fois la limite atteinte. */}
      {showParticulierLimitBanner && (
        <div
          className={`flex flex-col gap-2 rounded-sv-card border px-[18px] py-4 ${
            particulierLimitReached ? "border-attente/40 bg-attente-bg" : "border-border bg-white/[.04]"
          }`}
        >
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-text-secondary">
              {particulierTotal} / {particulierLimit} sportifs suivis
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[.08]">
            <div
              className="h-full rounded-full bg-sv-gradient transition-[width] duration-300"
              style={{ width: `${particulierUsagePct}%` }}
            />
          </div>
          {particulierLimitReached && (
            <span className="text-[12.5px] leading-relaxed text-attente">
              Vous avez atteint votre limite de sportifs suivis. Contactez SportVision pour en suivre davantage.
            </span>
          )}
        </div>
      )}

      {/* Bannière palier Agent — visible seulement si l'utilisateur suit au moins un sportif en
          tant qu'agent (athletesCount > 0) : un compte purement parent/proche n'a jamais besoin
          de voir son abonnement Agent, jamais un rappel décoratif hors contexte. Seul endroit de
          l'app où un CTA "Gérer mon abonnement" a du sens pour CE compte-là — voir le commentaire
          de RequestCard.tsx pour ce qui se passe côté propriétaire du profil. */}
      {agentInfo.athletesCount > 0 && (
        <div
          className={`flex flex-wrap items-center gap-3 rounded-sv-card border px-[18px] py-4 ${
            agentInfo.canAcceptMore ? "border-border bg-white/[.04]" : "border-attente/40 bg-attente-bg"
          }`}
        >
          <span className="material-symbols-rounded !text-[19px]" style={{ color: agentInfo.canAcceptMore ? undefined : "#FBBF24" }} aria-hidden="true">
            workspace_premium
          </span>
          <span className="text-[13px] leading-relaxed text-text-secondary">
            Palier {AGENT_TIER_LABEL[agentInfo.tier]} · {agentInfo.athletesCount} / {agentInfo.limit} sportifs suivis en tant qu&apos;agent
            {!agentInfo.canAcceptMore && " — limite atteinte, les nouvelles demandes ne pourront pas être acceptées"}
          </span>
          <Link href="/particulier/abonnement" className="ml-auto flex-none text-[13px] font-semibold text-affiliations hover:underline">
            Gérer mon abonnement
          </Link>
        </div>
      )}

      {athletes.length > 3 && (
        <div className="relative flex max-w-[420px]">
          <span className="material-symbols-rounded absolute left-4 top-3.5 !text-[21px] text-text-faint" aria-hidden="true">search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un sportif…"
            aria-label="Rechercher un sportif"
            className="h-[52px] w-full rounded-sv border border-border-strong bg-surface pl-[46px] pr-4 text-[16px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)]"
          />
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="flex flex-col gap-3">
          {filtered.map((a) => {
            const statusColor = ATHLETE_STATUS_COLOR[a.status];
            return (
              <Link
                key={`${a.kind}:${a.refId}`}
                href={`/particulier/sportifs/${a.kind}/${a.refId}`}
                className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-[18px] hover:bg-white/[.09]"
              >
                <span
                  className="flex h-12 w-12 flex-none items-center justify-center rounded-sv font-sora text-[16px] font-semibold text-white"
                  style={{ background: gradientFor(`${a.kind}:${a.refId}`) }}
                >
                  {(a.firstName[0] || "?").toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-sora text-[16px] font-semibold tracking-tight">
                    {a.firstName} {a.lastName}
                  </span>
                  <span className="text-[13px] text-text-tertiary">
                    {[a.sport, a.categorie].filter(Boolean).join(" · ") || "—"}
                  </span>
                  {a.clubNom && <span className="text-[12px] text-text-faint">{a.clubNom}</span>}
                </div>
                <div className="ml-auto flex flex-none flex-col items-end gap-1.5">
                  <span className="rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                    {a.relationLabel}
                  </span>
                  <span
                    className="rounded-sv-pill px-2.5 py-1 text-[11px] font-medium"
                    style={{ color: statusColor.fg, background: statusColor.bg }}
                  >
                    {ATHLETE_STATUS_LABEL[a.status]}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex max-w-[540px] flex-col gap-2.5 rounded-sv-card border border-dashed border-border-strong bg-white/[.04] p-7">
          <span className="flex h-[46px] w-[46px] items-center justify-center rounded-sv bg-affiliations-bg">
            <span className="material-symbols-rounded !text-[23px] text-affiliations" aria-hidden="true">group_add</span>
          </span>
          <span className="font-sora text-[18px] font-semibold">
            {query ? "Aucun résultat" : "Aucun sportif pour le moment"}
          </span>
          <p className="text-[14px] leading-relaxed text-text-tertiary">
            {query
              ? "Essayez un autre nom, un sport ou un club."
              : "Reliez votre compte à un joueur qui utilise déjà Connect, ou créez un profil géré."}
          </p>
          <Link
            href="/particulier/sportifs/ajouter"
            className="mt-1 self-start rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]"
          >
            Ajouter un sportif
          </Link>
        </div>
      )}
    </div>
  );
}
