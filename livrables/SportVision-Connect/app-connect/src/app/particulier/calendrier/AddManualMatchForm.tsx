"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import type { AthleteRow } from "@/lib/supabase/particulier";

// Ajout manuel de match — migration-connect-v57-abonnement-agent.sql §3, droit "modifier"
// (right_modifier). Volontairement simple : adversaire, date, lieu, rien de plus élaboré — "pour
// pas se perdre" (consigne exacte de Fouka). Le droit est revérifié CÔTÉ SERVEUR par
// connect_add_manual_calendar_event (SECURITY DEFINER) : la liste `athletes` reçue ici est déjà
// filtrée sur rights.modifier côté appelant (CalendrierParticulierView), mais ce n'est qu'un
// confort d'affichage, jamais la source de vérité de l'autorisation.
export function AddManualMatchForm({
  athletes,
  onDone,
  onCancel,
}: {
  athletes: AthleteRow[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [athleteKey, setAthleteKey] = useState(athletes[0] ? `${athletes[0].kind}:${athletes[0].refId}` : "");
  const [adversaire, setAdversaire] = useState("");
  const [date, setDate] = useState("");
  const [heure, setHeure] = useState("");
  const [lieu, setLieu] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = !!athleteKey && !!date;

  async function submit() {
    setTouched(true);
    if (!valid || busy) return;
    const [kind, refId] = athleteKey.split(":") as ["linked" | "managed", string];
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("connect_add_manual_calendar_event", {
      p_athlete_kind: kind,
      p_athlete_ref_id: refId,
      p_adversaire: adversaire.trim() || null,
      p_event_date: date,
      p_event_time: heure || null,
      p_lieu: lieu.trim() || null,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message || "Impossible d'ajouter ce match pour le moment.");
      return;
    }
    onDone();
  }

  return (
    <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-5 animate-sv-in">
      <div className="flex items-center gap-3">
        <h2 className="font-sora text-[16px] font-semibold">Ajouter un match</h2>
        <span className="ml-auto rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[11px] font-medium text-text-faint">
          Ajouté manuellement — pas un événement SportVision officiel
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="amf-athlete" className="text-[13px] font-medium text-text-secondary">
          Sportif
        </label>
        <select
          id="amf-athlete"
          value={athleteKey}
          onChange={(e) => setAthleteKey(e.target.value)}
          className="h-[54px] w-full rounded-sv border border-border-strong bg-surface px-4 text-[15px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)]"
        >
          {athletes.map((a) => (
            <option key={`${a.kind}:${a.refId}`} value={`${a.kind}:${a.refId}`}>
              {a.firstName} {a.lastName}
            </option>
          ))}
        </select>
      </div>

      <Field id="amf-adversaire" label="Adversaire · facultatif" value={adversaire} onChange={(e) => setAdversaire(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Field id="amf-date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={touched && !date ? "Requise." : null} />
        <Field id="amf-heure" label="Heure · facultatif" type="time" value={heure} onChange={(e) => setHeure(e.target.value)} />
      </div>
      <Field id="amf-lieu" label="Lieu · facultatif" value={lieu} onChange={(e) => setLieu(e.target.value)} />

      {error && <span className="text-[13px] text-danger">{error}</span>}

      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex-1 rounded-sv border border-border-strong bg-surface py-2.5 font-sora text-[14px] font-semibold hover:bg-surface-hover"
        >
          Annuler
        </button>
        <Button onClick={submit} loading={busy} className="flex-1">
          Ajouter
        </Button>
      </div>
    </div>
  );
}
