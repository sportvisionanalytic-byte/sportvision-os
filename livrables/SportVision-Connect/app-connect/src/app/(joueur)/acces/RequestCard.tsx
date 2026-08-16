"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const RELATION_LABEL: Record<string, string> = {
  parent: "Parent",
  tuteur_legal: "Tuteur légal",
  proche: "Proche",
  agent: "Agent",
  autre: "Autre",
};

const PREVIEW_RIGHTS = ["Voir vos contenus", "Suivre vos prestations", "Voir vos commandes"];

// Accepter/refuser une demande — appelle connect_respond_profile_access_request (RPC SECURITY
// DEFINER, migration §2) : la vérification "c'est bien le propriétaire du profil qui répond" est
// faite CÔTÉ SERVEUR dans la fonction, jamais seulement parce que ce composant s'affiche.
export function RequestCard({
  id,
  name,
  email,
  relationType,
  message,
}: {
  id: string;
  name: string;
  email: string;
  relationType: string;
  message: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "refuse" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Paywall Agent (migration-connect-v57-abonnement-agent.sql) et paywall particulier générique
  // (migration-connect-v67-distinction-parent-agent.sql §4) : connect_respond_profile_access_
  // request lève une exception préfixée "PAYWALL_AGENT_LIMIT:" (compte demandeur "agent", palier
  // payant existant) ou "PAYWALL_PARTICULIER_LIMIT:" (compte demandeur parent/tuteur/autre, plafond
  // dur à 3, jamais payant) — ces préfixes sont le CONTRAT que ce composant lit pour distinguer ce
  // refus d'une erreur technique générique. Message volontairement sans CTA d'action dans LES DEUX
  // cas ici : c'est le compte DEMANDEUR qui doit agir (changer de palier pour un agent, contacter
  // SportVision pour un parent/tuteur/autre — aucun palier payant à lui proposer), pas vous — voir
  // la bannière côté /particulier/sportifs pour le CTA réel côté agent, affiché au bon endroit.
  async function respond(accept: boolean) {
    setBusy(accept ? "accept" : "refuse");
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("connect_respond_profile_access_request", {
      p_id: id,
      p_accept: accept,
    });
    setBusy(null);
    if (rpcError) {
      if (rpcError.message?.includes("PAYWALL_AGENT_LIMIT")) {
        setError(
          "Cette personne a atteint la limite de sportifs suivis pour son abonnement Agent actuel. Elle doit changer de palier depuis son propre espace avant que vous puissiez accepter.",
        );
      } else if (rpcError.message?.includes("PAYWALL_PARTICULIER_LIMIT")) {
        setError(
          "Cette personne a atteint sa limite de sportifs suivis. Elle doit contacter SportVision avant que vous puissiez accepter.",
        );
      } else {
        setError("Impossible de traiter cette demande pour le moment.");
      }
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(130deg, rgba(251,191,36,.5), rgba(168,85,247,.18) 60%, transparent)" }}>
      <div className="flex flex-col gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-sv bg-sv-gradient font-sora text-[15px] font-semibold text-white">
            {(name[0] || "?").toUpperCase()}
          </span>
          <div className="flex flex-col gap-1">
            <span className="font-sora text-[16px] font-semibold tracking-tight">{name} souhaite être lié à votre profil</span>
            <span className="text-[14px] text-text-tertiary lg:text-[13px]">
              Relation déclarée : {RELATION_LABEL[relationType] || relationType} · {email}
            </span>
          </div>
        </div>

        {message && (
          <span className="border-l-2 border-border-strong pl-3 text-[14px] leading-relaxed text-text-secondary">{message}</span>
        )}

        <div className="flex flex-col gap-2.5 rounded-sv border border-border bg-white/[.03] p-4">
          <span className="text-[12px] font-medium uppercase tracking-[.08em] text-text-label">Ce qu&apos;il pourra voir si vous acceptez</span>
          {PREVIEW_RIGHTS.map((r) => (
            <div key={r} className="flex items-center gap-2.5">
              <span className="material-symbols-rounded !text-[18px] text-affiliations" aria-hidden="true">check</span>
              <span className="text-[14px] text-text-secondary lg:text-[13px]">{r}</span>
            </div>
          ))}
          <span className="text-[13px] text-text-faint lg:text-[12px]">Vous ajusterez ces autorisations après acceptation.</span>
        </div>

        {error && <span className="text-[14px] text-danger lg:text-[13px]">{error}</span>}

        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => respond(true)}
            disabled={!!busy}
            className="h-12 rounded-sv bg-sv-gradient px-5 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12] disabled:opacity-60"
          >
            {busy === "accept" ? "…" : "Accepter"}
          </button>
          <button
            type="button"
            onClick={() => respond(false)}
            disabled={!!busy}
            className="h-12 rounded-sv border border-danger-border bg-danger-bg px-4.5 font-sora text-[15px] font-semibold text-danger hover:bg-[rgba(244,114,182,.16)] disabled:opacity-60"
          >
            {busy === "refuse" ? "…" : "Refuser"}
          </button>
        </div>
      </div>
    </div>
  );
}
