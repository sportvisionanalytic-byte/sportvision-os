"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { MediaAsset } from "@/lib/types/content";
import {
  fetchClubPlayersForVisibility,
  fetchMediaVisibilityDetail,
  setMediaVisibility,
  type ClubPlayerOption,
  type ContentVisibilityMode,
} from "@/lib/data/club/content";
import { fetchClubTeams } from "@/lib/data/club/teams";
import type { Team } from "@/lib/types/teams";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

// Fiche « Visibilité vers Connect » — Bible §17 : 4 options (Privé Club+ / Affiliés du groupe /
// Sportifs sélectionnés / Automatique pour tous, interdite par défaut). Écrit directement sur
// media_access_rules / media_access_selected_players (voir data/club/content.ts,
// setMediaVisibility) : le backend (RLS is_club_admin/is_team_educateur) reste la seule vraie
// barrière, cette modale ne fait qu'exposer un mécanisme déjà prévu côté joueur/famille sans UI
// jusqu'ici (migration-clubplus-v18.sql + v39.sql pour le mode "Sportifs sélectionnés").

const MODE_LABEL: Record<ContentVisibilityMode, string> = {
  organization: "Privé Club+",
  team: "Affiliés du groupe",
  player: "Sportifs sélectionnés",
};

const MODE_DESCRIPTION: Record<ContentVisibilityMode, string> = {
  organization: "Visible seulement par les membres Club+ autorisés. Jamais envoyé vers Connect.",
  team: "Visible aux sportifs Connect affiliés à l'équipe choisie, et à leurs parents.",
  player: "Visible uniquement aux sportifs Connect que vous sélectionnez ci-dessous.",
};

const SELECTABLE_MODES: ContentVisibilityMode[] = ["organization", "team", "player"];

interface VisibilityEditorProps {
  asset: MediaAsset;
  organizationId: string;
  onClose: () => void;
  onSaved: (mode: ContentVisibilityMode) => void;
}

export function VisibilityEditor({ asset, organizationId, onClose, onSaved }: VisibilityEditorProps) {
  const [mode, setMode] = useState<ContentVisibilityMode | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [players, setPlayers] = useState<ClubPlayerOption[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      fetchMediaVisibilityDetail(supabase, asset.id),
      fetchClubTeams(supabase, organizationId),
      fetchClubPlayersForVisibility(supabase, organizationId),
    ])
      .then(([detail, teamsRes, playersRes]) => {
        if (cancelled) return;
        setMode(detail.mode);
        setTeamId(detail.teamId ?? teamsRes[0]?.id ?? null);
        setSelectedPlayerIds(new Set(detail.selectedPlayerIds));
        setTeams(teamsRes);
        setPlayers(playersRes);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id, organizationId]);

  function togglePlayer(playerId: string) {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  function handleSave() {
    if (!mode) return;
    if (mode === "team" && !teamId) {
      setSaveError("Choisissez une équipe.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const write =
      mode === "organization"
        ? ({ mode: "organization" } as const)
        : mode === "team"
          ? ({ mode: "team", teamId: teamId as string } as const)
          : ({ mode: "player", playerIds: Array.from(selectedPlayerIds) } as const);

    setMediaVisibility(supabase, organizationId, asset.id, write)
      .then(() => {
        onSaved(mode);
        onClose();
      })
      .catch(() => {
        setSaving(false);
        setSaveError("Impossible d'enregistrer. Vous n'avez peut-être pas les droits pour modifier la visibilité de ce contenu.");
      });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
      <Card className="animate-svfade relative flex max-h-[85vh] w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div className="pr-8">
          <h2 className="text-[19px] font-extrabold tracking-tight">Visibilité vers Connect</h2>
          <p className="mt-1 truncate text-[12.5px] text-text-soft">{asset.name}</p>
        </div>

        {loading ? (
          <div className="py-8 text-center text-[13px] text-text-soft">Chargement…</div>
        ) : loadError ? (
          <p className="text-[12.5px] font-bold text-danger-fg">Impossible de charger la visibilité actuelle.</p>
        ) : (
          <>
            <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Visibilité vers Connect">
              {SELECTABLE_MODES.map((m) => (
                <label
                  key={m}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 transition-colors duration-sv",
                    mode === m ? "border-brand-blue bg-info-bg" : "border-border-strong hover:border-brand-blue-pale",
                  )}
                >
                  <input
                    type="radio"
                    name="visibility-mode"
                    className="mt-0.5"
                    checked={mode === m}
                    onChange={() => setMode(m)}
                  />
                  <span>
                    <span className="block text-[13.5px] font-bold text-text">{MODE_LABEL[m]}</span>
                    <span className="block text-[12px] leading-relaxed text-text-soft">{MODE_DESCRIPTION[m]}</span>
                  </span>
                </label>
              ))}

              {/* Bible §17 : "Automatique pour tous | Interdit par défaut." Toujours listée pour
                  que les 4 options existent visuellement, jamais sélectionnable ici. */}
              <div className="flex items-start gap-2.5 rounded-xl border border-border px-3.5 py-3 opacity-50">
                <input type="radio" disabled className="mt-0.5" aria-hidden />
                <span>
                  <span className="block text-[13.5px] font-bold text-text-soft">Automatique pour tous</span>
                  <span className="block text-[12px] leading-relaxed text-text-faint">
                    Interdit par défaut. Nécessite une validation SportVision, non disponible depuis Club+.
                  </span>
                </span>
              </div>
            </div>

            {mode === "team" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-bold text-text-soft">Équipe</span>
                {(teams ?? []).length === 0 ? (
                  <p className="text-[12.5px] text-text-soft">Aucune équipe créée pour ce club pour le moment.</p>
                ) : (
                  <select value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value)} className={fieldClass}>
                    {(teams ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            )}

            {mode === "player" && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-bold text-text-soft">
                  Sportifs {selectedPlayerIds.size > 0 ? `(${selectedPlayerIds.size} sélectionné${selectedPlayerIds.size > 1 ? "s" : ""})` : ""}
                </span>
                <div className="max-h-[220px] overflow-y-auto rounded-xl border border-border-strong">
                  {(players ?? []).length === 0 ? (
                    <div className="px-3.5 py-4 text-center text-[12.5px] text-text-soft">Aucun sportif actif dans ce club.</div>
                  ) : (
                    (players ?? []).map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2.5 border-b border-divider px-3.5 py-2.5 last:border-0 hover:bg-row-hover"
                      >
                        <input type="checkbox" checked={selectedPlayerIds.has(p.id)} onChange={() => togglePlayer(p.id)} />
                        <span className="text-[13px] font-semibold text-text">{p.name}</span>
                        {p.teamName && <span className="ml-auto text-[11.5px] text-text-faint">{p.teamName}</span>}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {saveError && <p className="text-[12.5px] font-bold text-danger-fg">{saveError}</p>}

        <div className="mt-1 flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button disabled={loading || loadError || saving || !mode} loading={saving} onClick={handleSave}>
            Enregistrer
          </Button>
        </div>
      </Card>
    </div>
  );
}

const fieldClass =
  "h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";
