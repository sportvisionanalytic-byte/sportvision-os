"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Camera, ChevronRight, Rocket } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { construireActions, pluriel, type NiveauAction } from "@/lib/cockpit/actions";
import {
  fetchJournalClub,
  fetchSanteClub,
  fetchStatutLancement,
  fetchTableauDeBordCm,
  type LigneJournal,
  type SanteClub,
  type StatutLancementClub,
  type TableauDeBordCm,
} from "@/lib/data/club/cockpit";

// Le cockpit d'un CM SportVision sur un club qu'il accompagne.
//
// Refonte du 10/09/2026 (demande de Fouka) : l'écran doit dire d'abord ce qui demande une action,
// puis l'état réel du club, puis la journée et la semaine, puis ce qui a bougé. Quatre sources,
// toutes vérifiées côté base (`peut_operer_club`) : cm_tableau_de_bord, club_sante,
// club_statut_lancement, club_journal (migration v117).
//
// Règles tenues ici, héritées de la version précédente :
//   — aucun chiffre inventé : un bloc sans donnée disparaît plutôt que d'afficher « 0 / 0 » ;
//   — chaque alerte mène à l'écran où elle se résout.

const NIVEAU: Record<NiveauAction, { libelle: string; tone: BadgeTone }> = {
  urgent: { libelle: "Urgent", tone: "danger" },
  a_faire: { libelle: "À faire", tone: "warning" },
  information: { libelle: "Info", tone: "neutral" },
};

const STATUT_CLUB: Record<StatutLancementClub["statut"], { libelle: string; tone: BadgeTone; phrase: string }> = {
  en_preparation: {
    libelle: "En préparation",
    tone: "warning",
    phrase: "Aucune invitation ne part tant que vous ne lancez pas le club.",
  },
  pret: {
    libelle: "Prêt à être lancé",
    tone: "info",
    phrase: "La configuration obligatoire est complète. Le lancement enverra les invitations préparées.",
  },
  actif: { libelle: "Actif", tone: "success", phrase: "" },
};

const ACTIONS_VISIBLES = 5;

/** « 13:20 » aujourd'hui, « Hier » hier, « 8 sept. » avant. */
function horodatage(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(new Date()) - jour(d)) / 86_400_000);
  if (ecart <= 0) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (ecart === 1) return "Hier";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function dateCourte(ymd: string): string {
  const [a, m, j] = ymd.split("-").map(Number);
  if (!a || !m || !j) return ymd;
  return new Date(a, m - 1, j).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

const COUVERTURE_LB: Record<string, string> = { photo: "Photo", video: "Vidéo", photo_video: "Photo + vidéo" };

export function CmClubOverview() {
  const { ctx } = useSession();
  const [tableau, setTableau] = useState<TableauDeBordCm | null>(null);
  const [sante, setSante] = useState<SanteClub | null>(null);
  const [lancement, setLancement] = useState<StatutLancementClub | null>(null);
  const [journal, setJournal] = useState<LigneJournal[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const [toutesActions, setToutesActions] = useState(false);
  const [touteLaJournee, setTouteLaJournee] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let vivant = true;
    // Remise à zéro AVANT de charger : changer de club ne doit jamais laisser à l'écran, même un
    // instant, les chiffres du club précédent.
    setTableau(null);
    setSante(null);
    setLancement(null);
    setJournal(null);
    setErreur(false);
    setToutesActions(false);
    setTouteLaJournee(false);
    Promise.allSettled([
      fetchTableauDeBordCm(supabase, ctx.organization.id),
      fetchSanteClub(supabase, ctx.organization.id),
      fetchStatutLancement(supabase, ctx.organization.id),
      fetchJournalClub(supabase, ctx.organization.id, 12),
    ]).then(([t, s, l, j]) => {
      if (!vivant) return;
      if (t.status === "fulfilled") setTableau(t.value);
      if (s.status === "fulfilled") setSante(s.value);
      if (l.status === "fulfilled") setLancement(l.value);
      setJournal(j.status === "fulfilled" ? j.value : []);
      if (t.status === "rejected") setErreur(true);
    });
    return () => {
      vivant = false;
    };
  }, [ctx.organization.id]);

  const actions = useMemo(
    () => (tableau ? construireActions(tableau.a_faire, lancement, sante?.problemes ?? []) : []),
    [tableau, lancement, sante],
  );
  const parNiveau = (n: NiveauAction) => actions.filter((a) => a.niveau === n).length;
  const actionsAffichees = toutesActions ? actions : actions.slice(0, ACTIONS_VISIBLES);

  const statut = lancement ? STATUT_CLUB[lancement.statut] : null;

  return (
    <div className="flex flex-col gap-5">
      {/* ── En-tête : le club et son statut ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[.09em] text-brand-violet">Gestion SportVision</p>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-[24px] font-extrabold tracking-tight">{ctx.organization.name}</h1>
            {statut && <Badge tone={statut.tone}>{statut.libelle}</Badge>}
          </div>
          <p className="mt-1 text-[13px] text-text-soft">
            {lancement?.statut === "actif"
              ? `Club lancé le ${new Date(lancement.lance_at ?? "").toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}${lancement.lance_par ? ` par ${lancement.lance_par}` : ""}.`
              : statut?.phrase ?? "Vous accompagnez ce club pour SportVision."}
          </p>
        </div>
        {lancement?.statut === "pret" && (
          <Link
            href="/onboarding?section=lancement"
            className="inline-flex h-10 items-center gap-2 rounded-sv bg-gradient-to-r from-brand-blue to-brand-violet px-4 text-[13px] font-bold text-white shadow-sv-button"
          >
            <Rocket className="h-4 w-4" aria-hidden /> Lancer le club
          </Link>
        )}
      </div>

      {erreur && (
        <Card className="border-danger-fg/30 bg-danger-bg px-5 py-3.5 text-[13px] font-semibold text-danger-fg">
          Le tableau de bord n&apos;a pas pu être chargé. Rechargez la page.
        </Card>
      )}

      {/* ── Actions à traiter + Club opérationnel ─────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-0 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
            <h2 className="text-[13px] font-extrabold uppercase tracking-[.06em]">Actions à traiter</h2>
            {tableau && actions.length > 0 && (
              <span className="flex gap-1.5">
                {(["urgent", "a_faire", "information"] as const).map((n) =>
                  parNiveau(n) > 0 ? (
                    <Badge key={n} tone={NIVEAU[n].tone}>
                      {parNiveau(n)} {NIVEAU[n].libelle.toLowerCase()}
                    </Badge>
                  ) : null,
                )}
              </span>
            )}
          </div>
          {tableau === null ? (
            <p className="px-5 py-6 text-[13px] text-text-soft">{erreur ? "Indisponible." : "Chargement…"}</p>
          ) : actions.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-text-soft">Rien ne vous attend. Tout est à jour.</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {actionsAffichees.map((a) => (
                  <li key={a.cle}>
                    <Link
                      href={a.vers}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-row-hover"
                    >
                      <Badge tone={NIVEAU[a.niveau].tone} className="w-[68px] flex-none justify-center">
                        {NIVEAU[a.niveau].libelle}
                      </Badge>
                      <span className="min-w-0 flex-1 text-[13.5px] font-semibold">{a.texte}</span>
                      <ChevronRight className="h-4 w-4 flex-none text-text-faint" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              {actions.length > ACTIONS_VISIBLES && (
                <button
                  type="button"
                  onClick={() => setToutesActions((v) => !v)}
                  className="w-full border-t border-border px-5 py-2.5 text-left text-[12.5px] font-bold text-info-fg hover:bg-row-hover"
                >
                  {toutesActions ? "Afficher moins" : `Voir toutes les actions (${actions.length})`}
                </button>
              )}
            </>
          )}
        </Card>

        <Card className="flex flex-col p-0">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-[13px] font-extrabold uppercase tracking-[.06em]">Club opérationnel</h2>
          </div>
          {sante === null ? (
            <p className="px-5 py-6 text-[13px] text-text-soft">Chargement…</p>
          ) : (
            <div className="flex flex-1 flex-col gap-3.5 px-5 py-4">
              <div className="flex items-baseline gap-2">
                <span className="text-[34px] font-extrabold leading-none tabular-nums">{sante.score}</span>
                <span className="text-[16px] font-bold text-text-soft">%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet"
                  style={{ width: `${Math.max(3, sante.score)}%` }}
                />
              </div>
              {sante.problemes.length === 0 ? (
                <p className="text-[12.5px] text-text-soft">Aucune donnée manquante détectée.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {sante.problemes.slice(0, 5).map((p) => (
                    <li key={p.code}>
                      <Link
                        href={p.lien}
                        className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-row-hover"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "h-1.5 w-1.5 flex-none rounded-full",
                            p.niveau === "a_faire" ? "bg-warning-fg" : "bg-text-faint",
                          )}
                        />
                        <span className="min-w-0 flex-1">{p.texte}</span>
                        <span className="flex-none text-[11.5px] font-bold text-info-fg">Résoudre</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {tableau && (tableau.adoption.clubplus_total > 0 || tableau.adoption.connect_total > 0) && (
                <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-[12px] text-text-soft">
                  {tableau.adoption.clubplus_total > 0 && (
                    <span>
                      <b className="tabular-nums text-text">
                        {tableau.adoption.clubplus_actifs}/{tableau.adoption.clubplus_total}
                      </b>{" "}
                      coachs connectés
                    </span>
                  )}
                  {tableau.adoption.connect_total > 0 && (
                    <span>
                      <b className="tabular-nums text-text">
                        {tableau.adoption.connect_actifs}/{tableau.adoption.connect_total}
                      </b>{" "}
                      joueurs sur Connect
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ── Cette semaine : des cartes qui mènent à l'écran concerné ───────────── */}
      {tableau && (
        <section aria-label="Cette semaine">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-extrabold uppercase tracking-[.06em]">Cette semaine</h2>
            <span className="text-[12px] text-text-soft">
              du {dateCourte(tableau.semaine.du)} au {dateCourte(tableau.semaine.au)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { lb: "Matchs", n: tableau.semaine.matchs, vers: "/calendar?vue=semaine&filtre=matchs" },
              { lb: "Entraînements", n: tableau.semaine.entrainements, vers: "/calendar?vue=semaine&filtre=entrainements" },
              { lb: "Présences SportVision", n: tableau.semaine.presences, vers: "/calendar?vue=semaine&filtre=sportvision", accent: true },
              { lb: "Contenus prévus", n: tableau.semaine.contenus_a_publier, vers: "/content" },
              ...(tableau.semaine.demandes !== undefined
                ? [{ lb: "Demandes en attente", n: tableau.semaine.demandes, vers: "/requests" }]
                : []),
            ].map((c) => (
              <Link
                key={c.lb}
                href={c.vers}
                className={cn(
                  "rounded-sv-card border px-4 py-3.5 shadow-sv-card transition-colors",
                  "accent" in c && c.accent
                    ? "border-brand-violet/40 bg-accent-bg hover:border-brand-violet"
                    : "border-border bg-surface hover:border-border-strong",
                )}
              >
                <div className="text-[24px] font-extrabold leading-tight tabular-nums">{c.n}</div>
                <div className="mt-0.5 text-[12px] font-semibold text-text-soft">{c.lb}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Aujourd'hui + Activité récente ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Aujourdhui tableau={tableau} touteLaJournee={touteLaJournee} onToute={() => setTouteLaJournee(true)} />

        <Card className="p-0">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-[13px] font-extrabold uppercase tracking-[.06em]">Activité récente</h2>
          </div>
          {journal === null ? (
            <p className="px-5 py-6 text-[13px] text-text-soft">Chargement…</p>
          ) : journal.length === 0 ? (
            <p className="px-5 py-6 text-[13px] leading-relaxed text-text-soft">
              Les prochaines modifications du club apparaîtront ici : équipes, calendrier, invitations, droits à
              l&apos;image, présences SportVision.
            </p>
          ) : (
            <ol className="flex flex-col px-5 py-2">
              {journal.map((e, i) => (
                <li key={i} className="flex gap-3 py-2">
                  <span className="w-12 flex-none pt-px text-[11.5px] font-bold tabular-nums text-text-faint">
                    {horodatage(e.quand)}
                  </span>
                  <span className="min-w-0 text-[12.5px] leading-snug">
                    {e.qui && <b className="font-bold">{e.qui} </b>}
                    {e.lien ? (
                      <Link href={e.lien} className="hover:underline">
                        {e.texte}
                      </Link>
                    ) : (
                      e.texte
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

// Aujourd'hui, pour un club de 40 équipes : un résumé par type, puis ce qui compte en premier
// (présences SportVision, matchs, publications), et les entraînements repliés — c'est
// l'information la plus volumineuse et la moins décisive de la journée.
const ENTRAINEMENTS_VISIBLES = 3;

function Aujourdhui({
  tableau,
  touteLaJournee,
  onToute,
}: {
  tableau: TableauDeBordCm | null;
  touteLaJournee: boolean;
  onToute: () => void;
}) {
  const dateDuJour = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  if (tableau === null) {
    return (
      <Card className="p-0 lg:col-span-2">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-[13px] font-extrabold uppercase tracking-[.06em]">Aujourd&apos;hui</h2>
        </div>
        <p className="px-5 py-6 text-[13px] text-text-soft">Chargement…</p>
      </Card>
    );
  }

  const { matchs, entrainements } = tableau.aujourdhui;
  const autres = tableau.aujourdhui.autres ?? [];
  const publications = tableau.aujourdhui.publications ?? [];
  const presences =
    matchs.filter((m) => m.couverture).length +
    entrainements.filter((e) => e.couverture).length +
    autres.filter((a) => a.couverture).length;
  const total = matchs.length + entrainements.length + autres.length + publications.length;

  const matchsCouverts = matchs.filter((m) => m.couverture);
  const matchsSimples = matchs.filter((m) => !m.couverture);
  const entrainementsVisibles = touteLaJournee ? entrainements : entrainements.slice(0, ENTRAINEMENTS_VISIBLES);
  const entrainementsCaches = entrainements.length - entrainementsVisibles.length;

  const puces = [
    { n: matchs.length, lb: pluriel(matchs.length, "match", "matchs") },
    { n: entrainements.length, lb: pluriel(entrainements.length, "entraînement") },
    { n: presences, lb: pluriel(presences, "présence SportVision", "présences SportVision"), accent: true },
    { n: publications.length, lb: pluriel(publications.length, "publication") },
    { n: autres.length, lb: pluriel(autres.length, "autre événement", "autres événements") },
  ].filter((p) => p.n > 0);

  return (
    <Card className="p-0 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3.5">
        <h2 className="text-[13px] font-extrabold uppercase tracking-[.06em]">
          Aujourd&apos;hui <span className="ml-1 font-semibold normal-case tracking-normal text-text-soft">{dateDuJour}</span>
        </h2>
        <span className="text-[12px] font-semibold text-text-soft">{pluriel(total, "événement")}</span>
      </div>

      {total === 0 ? (
        <p className="px-5 py-6 text-[13px] text-text-soft">Ni match, ni entraînement, ni publication aujourd&apos;hui.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 px-5 pt-3.5">
            {puces.map((p) => (
              <span
                key={p.lb}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11.5px] font-bold",
                  p.accent ? "bg-accent-bg text-accent-fg" : "bg-surface-sunken text-text-soft",
                )}
              >
                {p.lb}
              </span>
            ))}
          </div>

          <ul className="flex flex-col gap-1 px-3 py-3">
            {matchsCouverts.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sv border border-brand-violet/40 bg-accent-bg px-3 py-2.5"
              >
                <span className="w-12 flex-none text-[13.5px] font-extrabold tabular-nums">{m.heure ?? "—"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold">
                    {m.equipe ?? "Équipe"} <span className="font-semibold text-text-soft">contre</span> {m.adversaire ?? "?"}
                  </span>
                  <span className="block text-[12px] text-text-soft">
                    {m.domicile === null ? "" : m.domicile ? "À domicile" : "À l'extérieur"}
                    {m.lieu ? ` · ${m.lieu}` : ""}
                  </span>
                </span>
                <span className="inline-flex flex-none items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-blue to-brand-violet px-2.5 py-1 text-[11.5px] font-bold text-white">
                  <Camera className="h-3.5 w-3.5" aria-hidden />
                  SportVision{m.type_couverture && COUVERTURE_LB[m.type_couverture] ? ` · ${COUVERTURE_LB[m.type_couverture]}` : ""}
                </span>
              </li>
            ))}
            {matchsSimples.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-12 flex-none text-[13.5px] font-extrabold tabular-nums">{m.heure ?? "—"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold">
                    {m.equipe ?? "Équipe"} <span className="text-text-soft">contre</span> {m.adversaire ?? "?"}
                  </span>
                  <span className="block text-[12px] text-text-soft">
                    {m.domicile === null ? "" : m.domicile ? "À domicile" : "À l'extérieur"}
                    {m.lieu ? ` · ${m.lieu}` : ""}
                    {m.competition ? ` · ${m.competition}` : ""}
                  </span>
                </span>
                <Badge tone="info">Match</Badge>
              </li>
            ))}
            {publications.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-12 flex-none text-[13.5px] font-extrabold tabular-nums">
                  {p.heure && p.heure !== "00:00" ? p.heure : "—"}
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold">{p.titre ?? "Publication"}</span>
                <Badge tone="cyan">Publication</Badge>
              </li>
            ))}
            {autres.map((a, i) => (
              <li key={`a${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-12 flex-none text-[13.5px] font-extrabold tabular-nums">{a.heure ?? "—"}</span>
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold">
                  {a.titre ?? a.equipe ?? "Événement"}
                  {a.lieu && <span className="block text-[12px] font-normal text-text-soft">{a.lieu}</span>}
                </span>
                {a.couverture && <Badge tone="accent">SportVision</Badge>}
              </li>
            ))}
            {entrainementsVisibles.map((e, i) => (
              <li key={`e${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-text-soft">
                <span className="w-12 flex-none text-[13px] font-bold tabular-nums">{e.debut ?? "—"}</span>
                <span className={cn("min-w-0 flex-1 text-[13px]", e.annule && "line-through")}>
                  Entraînement <span className="font-semibold text-text">{e.equipe ?? ""}</span>
                  {e.lieu ? ` · ${e.lieu}` : ""}
                </span>
                {e.annule && <Badge tone="neutral">Annulé</Badge>}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-2.5">
            {entrainementsCaches > 0 ? (
              <button type="button" onClick={onToute} className="text-[12.5px] font-bold text-info-fg hover:underline">
                + {pluriel(entrainementsCaches, "entraînement")}
              </button>
            ) : (
              <span />
            )}
            <Link href="/calendar?vue=jour" className="text-[12.5px] font-bold text-info-fg hover:underline">
              Voir toute la journée →
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}
