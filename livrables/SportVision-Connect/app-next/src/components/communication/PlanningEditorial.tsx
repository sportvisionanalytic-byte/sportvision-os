"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Toast, useToast } from "@/components/feedback/Toast";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import { fetchClubTeams } from "@/lib/data/club/teams";
import { fetchPlanning, type ContenuCm } from "@/lib/data/club/planningEditorial";
import {
  STATUT_LIBELLE,
  grilleMois,
  isoJour,
  libelleCanaux,
  ligneContenu,
  plusJours,
  resumePlanning,
  semaineDe,
  trierContenus,
} from "@/lib/communication/planning";
import type { Team } from "@/lib/types/teams";
import { FicheContenu, TON_STATUT } from "@/components/communication/FicheContenu";

// Le planning éditorial du club, cockpit du CM (11/09/2026, demande de Fouka). Le CM y construit
// et exploite la communication du club : Aujourd'hui | Cette semaine | À préparer en tête, un
// « + Ajouter au planning » toujours visible, des vues Semaine / Mois / Liste, un « + » sur chaque
// jour pour créer à cette date. Les autres rôles du club lisent (la base ne leur montre que ce qui
// est sorti du brouillon) et valident par le workflow existant.

type Vue = "semaine" | "mois" | "liste";
type Fiche = { contenu?: ContenuCm; date?: string } | null;

export function PlanningEditorial({ clientId }: { clientId: string }) {
  const { ctx } = useSession();
  // Le CM SportVision opère le club : c'est lui qui construit le planning (un coach, non ; le
  // président lit et valide). La base décide aussi (RLS contenus, v141) : ce drapeau ne fait
  // qu'éviter de proposer un geste qu'elle refuserait.
  const peutModifier = ctx.membership.role === "external_cm";
  const [items, setItems] = useState<ContenuCm[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [erreur, setErreur] = useState(false);
  const [vue, setVue] = useState<Vue>("semaine");
  const [reference, setReference] = useState(() => new Date());
  const [fiche, setFiche] = useState<Fiche>(null);
  const { toastMessage, toastTone, showToast } = useToast();

  async function recharger() {
    setErreur(false);
    try {
      setItems(await fetchPlanning(createClient(), clientId));
    } catch {
      setErreur(true);
      setItems([]);
    }
  }

  useEffect(() => {
    void recharger();
    fetchClubTeams(createClient(), ctx.organization.id).then(setTeams).catch(() => setTeams([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, ctx.organization.id]);

  const maintenant = useMemo(() => new Date(), []);
  const resume = useMemo(() => resumePlanning(items ?? [], maintenant), [items, maintenant]);
  const parJour = useMemo(() => {
    const m = new Map<string, ContenuCm[]>();
    for (const c of trierContenus((items ?? []).filter((x) => x.statut !== "archive"))) {
      if (!c.datePrevue) continue;
      m.set(c.datePrevue, [...(m.get(c.datePrevue) ?? []), c]);
    }
    return m;
  }, [items]);
  const sansDate = (items ?? []).filter((c) => !c.datePrevue && c.statut !== "archive");

  const jours = vue === "mois" ? grilleMois(reference) : semaineDe(reference);
  const auj = isoJour(maintenant);
  const titrePeriode =
    vue === "mois"
      ? reference.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
      : `${jours[0]!.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${jours[6]!.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
  const decaler = (sens: number) =>
    setReference((r) => (vue === "mois" ? new Date(r.getFullYear(), r.getMonth() + sens, 1) : plusJours(r, 7 * sens)));

  const ouvrir = (contenu?: ContenuCm, date?: string) => setFiche({ contenu, date });

  function Pastille({ c, compacte }: { c: ContenuCm; compacte?: boolean }) {
    return (
      <button
        type="button"
        onClick={() => ouvrir(c)}
        className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:border-border-strong hover:bg-row-hover"
      >
        <span className="block truncate text-[12px] font-bold text-text">{ligneContenu(c)}</span>
        {!compacte && <span className="mt-0.5 block truncate text-[12.5px] text-text">{c.titre}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {c.plateforme && <span className="truncate text-[11px] text-text-soft">{libelleCanaux(c.plateforme)}</span>}
          <Badge tone={TON_STATUT[c.statut]} className="text-[10.5px]">{STATUT_LIBELLE[c.statut]}</Badge>
        </span>
      </button>
    );
  }

  const ajouterJour = (date: string) =>
    peutModifier ? (
      <button
        type="button"
        aria-label={`Ajouter un contenu le ${date}`}
        onClick={() => ouvrir(undefined, date)}
        className="flex h-7 w-7 items-center justify-center rounded-full text-text-faint hover:bg-accent-bg hover:text-accent-fg"
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    ) : null;

  const Resume = ({ titre, children }: { titre: string; children: React.ReactNode }) => (
    <Card className="flex min-w-0 flex-col gap-2 p-4">
      <span className="text-[11.5px] font-extrabold uppercase tracking-[.06em] text-text-soft">{titre}</span>
      {children}
    </Card>
  );
  const listeCourte = (l: ContenuCm[], vide: string) =>
    l.length === 0 ? (
      <span className="text-[13px] text-text-faint">{vide}</span>
    ) : (
      <span className="flex flex-col gap-1">
        {l.slice(0, 3).map((c) => (
          <button key={c.id} type="button" onClick={() => ouvrir(c)} className="truncate text-left text-[13px] text-text hover:underline">
            {c.heurePrevue && <b>{c.heurePrevue}</b>} {c.titre}
          </button>
        ))}
        {l.length > 3 && <span className="text-[12px] text-text-soft">+ {l.length - 3} autre{l.length - 3 > 1 ? "s" : ""}</span>}
      </span>
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Communication</div>
          <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight tracking-tight sm:text-[29px]">Planning éditorial de {ctx.organization.name}</h1>
        </div>
        {peutModifier && (
          <Button className="h-11 w-full px-5 sm:w-auto" onClick={() => ouvrir()}>
            <Plus className="h-4 w-4" aria-hidden /> Ajouter au planning
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Resume titre="Aujourd'hui">{listeCourte(resume.aujourdhui, "Rien aujourd'hui.")}</Resume>
        <Resume titre="Cette semaine">
          <span className="text-[26px] font-extrabold leading-none text-text">{resume.semaine}</span>
          <span className="text-[12.5px] text-text-soft">contenu{resume.semaine > 1 ? "s" : ""} prévu{resume.semaine > 1 ? "s" : ""}</span>
        </Resume>
        <Resume titre="À préparer">{listeCourte(resume.aPreparer, "Tout est prêt pour les 7 jours.")}</Resume>
      </div>

      {erreur && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger le planning éditorial.</span>
          <Button variant="secondary" className="h-8 px-3 text-[12px]" onClick={() => void recharger()}>
            Réessayer
          </Button>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl bg-surface-sunken p-1">
          {(["semaine", "mois", "liste"] as Vue[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={vue === v}
              onClick={() => setVue(v)}
              className={`h-9 rounded-lg px-4 text-[13px] font-bold ${vue === v ? "bg-surface text-text shadow-sv-card" : "text-text-soft hover:text-text"}`}
            >
              {v === "semaine" ? "Semaine" : v === "mois" ? "Mois" : "Liste"}
            </button>
          ))}
        </div>
        {vue !== "liste" && (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Période précédente" onClick={() => decaler(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-soft hover:bg-surface-sunken">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => setReference(new Date())} className="h-9 rounded-lg px-3 text-[13px] font-bold text-text-soft hover:bg-surface-sunken">
              Aujourd&apos;hui
            </button>
            <button type="button" aria-label="Période suivante" onClick={() => decaler(1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-soft hover:bg-surface-sunken">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            <span className="ml-1 text-[14px] font-extrabold capitalize text-text">{titrePeriode}</span>
          </div>
        )}
      </div>

      {items === null && <Card className="px-8 py-16 text-center text-[13.5px] font-bold text-text-soft">Chargement…</Card>}

      {items !== null && items.filter((c) => c.statut !== "archive").length === 0 && (
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div className="text-[16px] font-extrabold text-text">Aucun contenu programmé pour le moment.</div>
          <p className="max-w-md text-[13.5px] text-text-soft">
            {peutModifier
              ? "Commencez à construire le planning éditorial du club."
              : "Le planning se remplit au fil de la préparation par votre CM SportVision."}
          </p>
          {peutModifier && (
            <Button className="h-11 px-5" onClick={() => ouvrir()}>
              <Plus className="h-4 w-4" aria-hidden /> Ajouter un contenu
            </Button>
          )}
        </Card>
      )}

      {items !== null && vue === "semaine" && (
        <div className="grid gap-2 md:grid-cols-7">
          {jours.map((j) => {
            const iso = isoJour(j);
            const liste = parJour.get(iso) ?? [];
            return (
              <div key={iso} className={`flex min-w-0 flex-col gap-1.5 rounded-xl border p-2 ${iso === auj ? "border-brand-blue/60 bg-accent-bg/40" : "border-border bg-surface-sunken/40"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-extrabold capitalize text-text">
                    {j.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}
                  </span>
                  {ajouterJour(iso)}
                </div>
                {liste.map((c) => (
                  <Pastille key={c.id} c={c} />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {items !== null && vue === "mois" && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-7 border-b border-border bg-surface-sunken text-center text-[11px] font-extrabold uppercase tracking-[.05em] text-text-soft">
            {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
              <span key={d} className="py-2">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {jours.map((j) => {
              const iso = isoJour(j);
              const liste = parJour.get(iso) ?? [];
              const horsMois = j.getMonth() !== reference.getMonth();
              return (
                <div key={iso} className={`min-h-[88px] min-w-0 border-b border-r border-border p-1.5 ${horsMois ? "bg-surface-sunken/50 opacity-60" : ""} ${iso === auj ? "bg-accent-bg/40" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-text-soft">{j.getDate()}</span>
                    {ajouterJour(iso)}
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    {liste.slice(0, 2).map((c) => (
                      <button key={c.id} type="button" onClick={() => ouvrir(c)} className="truncate rounded-md bg-surface px-1.5 py-1 text-left text-[11px] font-bold text-text hover:bg-row-hover">
                        <span className="hidden sm:inline">{c.heurePrevue ? `${c.heurePrevue} · ` : ""}</span>
                        {c.titre}
                      </button>
                    ))}
                    {liste.length > 2 && <span className="text-[11px] font-bold text-accent-fg">+{liste.length - 2}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {items !== null && vue === "liste" && items.filter((c) => c.statut !== "archive").length > 0 && (
        <div className="flex flex-col gap-4">
          {[...parJour.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .filter(([d]) => d >= isoJour(plusJours(maintenant, -14)))
            .map(([d, liste]) => (
              <div key={d} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-extrabold capitalize text-text">
                    {new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                    {d === auj ? " · aujourd'hui" : ""}
                  </span>
                  {ajouterJour(d)}
                </div>
                {liste.map((c) => (
                  <Pastille key={c.id} c={c} />
                ))}
              </div>
            ))}
          {sansDate.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-extrabold text-text">Sans date</span>
              {sansDate.map((c) => (
                <Pastille key={c.id} c={c} />
              ))}
            </div>
          )}
        </div>
      )}

      {fiche && (
        <FicheContenu
          clientId={clientId}
          clubId={ctx.organization.id}
          cmId={ctx.user.id}
          peutModifier={peutModifier}
          teams={teams}
          contenu={fiche.contenu}
          dateInitiale={fiche.date}
          onFermer={() => setFiche(null)}
          onEnregistre={(message) => {
            setFiche(null);
            showToast(message);
            void recharger();
          }}
        />
      )}
      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}
