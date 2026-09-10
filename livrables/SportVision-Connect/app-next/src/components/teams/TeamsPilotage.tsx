"use client";

// Les équipes, vues par qui pilote le club (CM, Owner, président).
//
// Demande de Fouka, 10/09/2026 : « 42 équipes est beaucoup. Il faut pouvoir identifier
// immédiatement les équipes qui nécessitent une action. » Chaque équipe tient sur une ligne qui
// dit ce qui lui manque ; des filtres les isolent. Les données viennent toutes de
// `club_equipes_etat` (une seule source, la même que le tableau de bord et l'onboarding), la
// règle des filtres de `lib/teams/pilotage.ts`, le classement par catégorie de
// `lib/teams/groupes.ts` — le même que partout ailleurs.
//
// Le coach garde sa propre vue (« Mon équipe ») : ce composant n'est monté que pour qui opère
// le club.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchEquipesEtat, type EtatEquipe } from "@/lib/data/club/cockpit";
import { grouperEquipes } from "@/lib/teams/groupes";
import {
  FILTRES_EQUIPES,
  compterParFiltre,
  filtreDepuisParam,
  filtrerEquipes,
  imageIncomplete,
  problemes,
  type FiltreEquipes,
} from "@/lib/teams/pilotage";

function dateCourte(ymd: string | null): string {
  if (!ymd) return "";
  const [a, m, j] = ymd.split("-").map(Number);
  if (!a || !m || !j) return ymd;
  return new Date(a, m - 1, j).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

const ENCADRANT: Record<string, { tone: "success" | "info" | "warning" | "neutral"; prefixe: string }> = {
  actif: { tone: "success", prefixe: "Coach" },
  invite: { tone: "info", prefixe: "Invité" },
  prepare: { tone: "info", prefixe: "Préparé" },
  renseigne: { tone: "neutral", prefixe: "Renseigné" },
};

export function TeamsPilotage({ clubId }: { clubId: string }) {
  const [etats, setEtats] = useState<EtatEquipe[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const [filtre, setFiltre] = useState<FiltreEquipes>("toutes");
  const [categorie, setCategorie] = useState("");
  const [section, setSection] = useState("");
  const [recherche, setRecherche] = useState("");

  useEffect(() => {
    // Un lien du tableau de bord (« 42 équipes sans coach ») arrive ici déjà filtré.
    setFiltre(filtreDepuisParam(new URLSearchParams(window.location.search).get("filtre")));
  }, []);

  function charger() {
    setErreur(false);
    fetchEquipesEtat(createClient(), clubId)
      .then(setEtats)
      .catch(() => setErreur(true));
  }
  useEffect(charger, [clubId]);

  function choisirFiltre(f: FiltreEquipes) {
    setFiltre(f);
    try {
      window.history.replaceState(null, "", f === "toutes" ? window.location.pathname : `?filtre=${f}`);
    } catch {
      /* l'adresse ne suit pas : sans conséquence */
    }
  }

  const compteurs = useMemo(() => compterParFiltre(etats ?? []), [etats]);
  const categories = useMemo(
    () => Array.from(new Set((etats ?? []).map((e) => e.categorie).filter((c): c is string => Boolean(c)))),
    [etats],
  );
  const sections = useMemo(
    () => Array.from(new Set((etats ?? []).map((e) => e.section).filter((s): s is string => Boolean(s)))).sort(),
    [etats],
  );
  const visibles = useMemo(
    () => filtrerEquipes(etats ?? [], { filtre, categorie, section, recherche }),
    [etats, filtre, categorie, section, recherche],
  );
  // Le classement par catégorie est celui du reste de l'application.
  const groupes = useMemo(() => {
    const parNom = new Map(visibles.map((e) => [e.nom, e]));
    return grouperEquipes(visibles.map((e) => ({ name: e.nom, categorie: e.categorie, section: e.section })))
      .map((g) => ({ ...g, lignes: g.equipes.map((x) => parNom.get(x.name)).filter((x): x is EtatEquipe => Boolean(x)) }))
      .filter((g) => g.lignes.length > 0);
  }, [visibles]);

  if (erreur) {
    return (
      <Card>
        <ErrorState message="Impossible de charger l'état des équipes." onRetry={charger} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Filtres ── */}
      <div className="flex flex-wrap gap-1.5">
        {FILTRES_EQUIPES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => choisirFiltre(f.id)}
            aria-pressed={filtre === f.id}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[12.5px] font-bold transition-colors",
              filtre === f.id
                ? "border-brand-blue-electric bg-brand-blue-electric/10 text-brand-blue-electric"
                : "border-border-strong text-text-soft hover:border-brand-blue",
            )}
          >
            {f.libelle} <span className="tabular-nums opacity-70">{etats === null ? "…" : compteurs[f.id]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border-strong bg-input-bg px-3 py-2">
          <Search className="h-4 w-4 flex-none text-text-faint" aria-hidden />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher une équipe…"
            aria-label="Rechercher une équipe"
            className="min-w-0 flex-1 bg-transparent text-[13px] font-bold text-text outline-none placeholder:font-normal placeholder:text-text-faint"
          />
          {recherche && (
            <button onClick={() => setRecherche("")} aria-label="Effacer la recherche" className="flex-none text-text-faint hover:text-text">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        <select
          value={categorie}
          onChange={(e) => setCategorie(e.target.value)}
          aria-label="Catégorie"
          className="h-10 rounded-xl border border-border-strong bg-input-bg px-3 text-[13px] font-bold"
        >
          <option value="">Toutes les catégories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {sections.length > 1 && (
          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            aria-label="Sexe"
            className="h-10 rounded-xl border border-border-strong bg-input-bg px-3 text-[13px] font-bold"
          >
            <option value="">Tous</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── Les équipes ── */}
      {etats === null ? (
        <Card className="px-5 py-8 text-center text-[13px] text-text-soft">Chargement…</Card>
      ) : visibles.length === 0 ? (
        <Card className="px-5 py-8 text-center text-[13px] text-text-soft">
          {filtre === "toutes" && !categorie && !section && !recherche
            ? "Aucune équipe."
            : "Aucune équipe ne correspond. Bonne nouvelle si c'est le filtre d'un problème."}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {groupes.map((g) => (
            <div key={g.id}>
              <div className="flex items-center justify-between border-b border-divider bg-surface-alt px-5 py-2">
                <span className="text-[11.5px] font-extrabold uppercase tracking-[.06em] text-text-faint">{g.label}</span>
                <span className="text-[11.5px] font-bold tabular-nums text-text-faint">{g.lignes.length}</span>
              </div>
              {g.lignes.map((e) => {
                const soucis = problemes(e);
                const enc = ENCADRANT[e.encadrant_statut];
                return (
                  <Link
                    key={e.team_id}
                    href={`/teams/${e.team_id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-divider px-5 py-3 transition-colors last:border-0 hover:bg-row-hover"
                  >
                    <span className="min-w-[140px] flex-1">
                      <span className="block text-[13.5px] font-extrabold">{e.nom}</span>
                      <span className="block text-[11.5px] text-text-soft">
                        {[e.categorie, e.section].filter(Boolean).join(" · ")}
                        {e.prochain_match_date &&
                          ` · Prochain match ${dateCourte(e.prochain_match_date)}${e.prochain_match_adversaire ? ` contre ${e.prochain_match_adversaire}` : ""}`}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={e.joueurs > 0 ? "neutral" : "warning"}>
                        {e.joueurs > 0 ? `${e.joueurs} joueur${e.joueurs > 1 ? "s" : ""}` : "Effectif non renseigné"}
                      </Badge>
                      {enc ? (
                        <Badge tone={enc.tone}>
                          {enc.prefixe}
                          {e.encadrant ? ` · ${e.encadrant}` : ""}
                        </Badge>
                      ) : (
                        <Badge tone="warning">Coach manquant</Badge>
                      )}
                      {e.joueurs > 0 && (
                        <Badge tone={imageIncomplete(e) ? "warning" : "success"}>
                          Image {e.image_valides}/{e.joueurs}
                        </Badge>
                      )}
                      {e.creneaux === 0 && <Badge tone="warning">Sans entraînement</Badge>}
                      {soucis.length === 0 && <Badge tone="success">Complète</Badge>}
                    </span>
                    <ChevronRight className="h-4 w-4 flex-none text-text-faint" aria-hidden />
                  </Link>
                );
              })}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
