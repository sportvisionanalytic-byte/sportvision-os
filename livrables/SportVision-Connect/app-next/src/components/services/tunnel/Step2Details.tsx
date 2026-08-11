import { useState } from "react";
import { resolveTravelFees } from "@/lib/types/services";
import type { TunnelState } from "./types";

const inputClass =
  "h-11 rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";
const labelClass = "text-[12.5px] font-bold text-text-soft";

// Frais de déplacement résolus au blur (pas à chaque frappe) via l'API Adresse du gouvernement —
// voir resolveTravelFees (lib/types/services.ts § Frais de déplacement réels). `resolvingFor`
// évite d'écraser le résultat d'une résolution en cours si l'adresse change avant qu'elle
// ne réponde (ignore la réponse si elle ne correspond plus à l'adresse actuelle du champ).
export function Step2Details({
  state,
  onChange,
}: {
  state: TunnelState;
  onChange: (patch: Partial<TunnelState>) => void;
}) {
  const [resolving, setResolving] = useState(false);

  async function handleAddressBlur() {
    const address = state.address.trim();
    if (!address) {
      onChange({ travelFees: 0, distanceKm: null });
      return;
    }
    setResolving(true);
    const result = await resolveTravelFees(address);
    setResolving(false);
    if (state.address.trim() === address) {
      onChange({ travelFees: result.travelFeesHT, distanceKm: result.distanceKm });
    }
  }

  return (
    <div>
      <h2 className="text-[18px] font-extrabold tracking-tight">Informations et lieu</h2>
      <p className="mt-1 text-[13.5px] text-text-soft">De quand, où et avec qui avons-nous besoin ?</p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Date</span>
          <input
            type="date"
            required
            value={state.date}
            onChange={(e) => onChange({ date: e.target.value })}
            className={inputClass}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Heure de début</span>
            <input
              type="time"
              required
              value={state.startTime}
              onChange={(e) => onChange({ startTime: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Heure de fin</span>
            <input
              type="time"
              required
              value={state.endTime}
              onChange={(e) => onChange({ endTime: e.target.value })}
              className={inputClass}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={labelClass}>Adresse</span>
          <input
            type="text"
            required
            placeholder="Stade Pierre-Bardin, 77300 Fontainebleau"
            value={state.address}
            onChange={(e) => onChange({ address: e.target.value, travelFees: 0, distanceKm: null })}
            onBlur={handleAddressBlur}
            className={inputClass}
          />
          {resolving && <span className="text-[11.5px] text-text-faint">Calcul du trajet…</span>}
          {!resolving && state.distanceKm !== null && (
            <span className="text-[11.5px] text-text-faint">
              {state.distanceKm === 0
                ? "Île-de-France : déplacement offert"
                : `Trajet estimé : ${state.distanceKm.toLocaleString("fr-FR")} km aller-retour`}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Équipe concernée (optionnel)</span>
          <input
            type="text"
            placeholder="Ex. Seniors A"
            value={state.teamLabel}
            onChange={(e) => onChange({ teamLabel: e.target.value })}
            className={inputClass}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Contact sur place</span>
            <input
              type="text"
              required
              placeholder="Nom et prénom"
              value={state.contactName}
              onChange={(e) => onChange({ contactName: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Téléphone</span>
            <input
              type="tel"
              required
              placeholder="06 12 34 56 78"
              value={state.contactPhone}
              onChange={(e) => onChange({ contactPhone: e.target.value })}
              className={inputClass}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={labelClass}>Besoins spécifiques (optionnel)</span>
          <textarea
            rows={3}
            placeholder="Contraintes, références, éléments à éviter…"
            value={state.needs}
            onChange={(e) => onChange({ needs: e.target.value })}
            className="resize-none rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
          />
        </label>
      </div>
    </div>
  );
}
