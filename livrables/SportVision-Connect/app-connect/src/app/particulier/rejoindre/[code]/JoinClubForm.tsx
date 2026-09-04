"use client";

import { useState } from "react";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import type { AthleteRow } from "@/lib/supabase/particulier";

type Choice = { kind: "self" | "club" | "managed" | "new"; refId: string | null; label: string };

export function JoinClubForm({ code, athletes }: { code: string; athletes: AthleteRow[] }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"done" | "ambigu" | null>(null);

  const choices: Choice[] = [
    { kind: "self", refId: null, label: "Moi-même" },
    ...athletes.map((a) => ({ kind: a.kind as "club" | "managed", refId: a.refId, label: `${a.firstName} ${a.lastName}` })),
    { kind: "new", refId: null, label: "Ajouter un enfant" },
  ];

  // Un profil 'club' a déjà son identité (player_profiles) : aucune saisie complémentaire.
  // 'self'/'managed'/'new' n'ont pas de date de naissance fiable côté Connect — nécessaire pour
  // le rapprochement fort côté club (find_player_match_candidates), jamais devinée.
  const needsIdentity = choice && choice.kind !== "club";
  const prefillFromAthlete = choice ? athletes.find((a) => a.refId === choice.refId) : null;

  function pick(c: Choice) {
    setChoice(c);
    setError(null);
    if (c.kind === "managed" && prefillFromAthlete) {
      setFirstName(prefillFromAthlete.firstName);
      setLastName(prefillFromAthlete.lastName);
    } else if (c.kind === "self" || c.kind === "new") {
      setFirstName("");
      setLastName("");
    }
    setBirthDate("");
  }

  const valid = choice && (choice.kind === "club" || (firstName.trim() && lastName.trim() && birthDate));

  async function submit() {
    if (!choice || !valid || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("connect_join_club_via_smart_link", {
      p_code: code,
      p_kind: choice.kind,
      p_ref_id: choice.refId,
      p_prenom: choice.kind === "club" ? null : firstName.trim(),
      p_nom: choice.kind === "club" ? null : lastName.trim(),
      p_date_naissance: choice.kind === "club" ? null : birthDate,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message || "Impossible de traiter cette demande pour le moment.");
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setResult(row?.match_ambigu ? "ambigu" : "done");
  }

  if (result === "done") {
    return (
      <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-6">
        <span className="material-symbols-rounded !text-[32px] text-affiliations" aria-hidden="true">check_circle</span>
        <h2 className="font-sora text-[20px] font-bold tracking-tight">Demande envoyée</h2>
        <p className="text-[14px] leading-relaxed text-text-tertiary">
          Un coach ou un responsable du club doit encore valider cette affiliation. Vous retrouverez son statut dans
          Mes sportifs.
        </p>
        <Link href="/particulier/sportifs" className="self-start rounded-sv bg-sv-gradient px-5 py-3 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]">
          Mes sportifs
        </Link>
      </div>
    );
  }

  if (result === "ambigu") {
    return (
      <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-6">
        <span className="material-symbols-rounded !text-[32px] text-attente" aria-hidden="true">help</span>
        <h2 className="font-sora text-[20px] font-bold tracking-tight">Vérification nécessaire</h2>
        <p className="text-[14px] leading-relaxed text-text-tertiary">
          Plusieurs profils correspondent à ce nom dans ce club. Pour éviter un doublon, contactez le club ou
          SportVision afin de confirmer de qui il s&apos;agit.
        </p>
        <Link href="/particulier" className="self-start text-[14px] font-semibold text-affiliations hover:underline">
          Retour à l&apos;accueil
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <span className="text-[14px] font-medium text-text-secondary lg:text-[13px]">Qui rejoint ?</span>
        <div className="flex flex-col gap-2">
          {choices.map((c) => (
            <button
              key={`${c.kind}:${c.refId}`}
              type="button"
              onClick={() => pick(c)}
              className={`flex items-center justify-between rounded-sv-card border px-[18px] py-3.5 text-left text-[15px] font-semibold transition-colors duration-150 ${
                choice?.kind === c.kind && choice.refId === c.refId
                  ? "border-[rgba(140,169,255,.65)] bg-[rgba(79,125,255,.14)]"
                  : "border-border bg-surface hover:bg-white/[.06]"
              }`}
            >
              {c.label}
              {choice?.kind === c.kind && choice.refId === c.refId && (
                <span className="material-symbols-rounded !text-[20px] text-affiliations" aria-hidden="true">check</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {needsIdentity && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[160px] flex-1">
              <Field id="jc-fn" label="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="min-w-[160px] flex-1">
              <Field id="jc-ln" label="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <Field id="jc-dob" type="date" label="Date de naissance" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          <p className="text-[12.5px] leading-relaxed text-text-faint">
            Nécessaire pour retrouver ce profil dans l&apos;effectif du club sans créer de doublon.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
          <span className="text-[14px] leading-relaxed text-[#FBCFE8] lg:text-[13px]">{error}</span>
        </div>
      )}

      <Button onClick={submit} loading={busy} disabled={!valid} className="self-start">
        Confirmer
      </Button>
    </div>
  );
}
