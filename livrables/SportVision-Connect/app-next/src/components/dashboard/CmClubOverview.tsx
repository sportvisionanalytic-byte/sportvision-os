"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";

// Le tableau de bord d'un Community Manager SportVision sur un club qu'il accompagne.
//
// Hiérarchie voulue par Fouka (08/09/2026) : Aujourd'hui → À faire → Cette semaine → Activité.
// Elle répond dans l'ordre aux questions d'une journée de travail : qu'est-ce qui se passe
// maintenant, sur quoi dois-je agir, à quoi ressemble la semaine, et que s'est-il passé sans moi.
//
// Tout vient de `cm_tableau_de_bord()` : un seul aller-retour, un seul endroit où le périmètre du
// CM est vérifié, et aucun risque que deux écrans comptent différemment la même chose.
//
// Deux règles de lecture tenues ici :
//   — aucun chiffre inventé. Quand une donnée n'existe pas, le bloc disparaît au lieu d'afficher
//     « 0 / 0 », qui a l'air d'une mesure alors que ce n'est qu'une absence ;
//   — « À faire » ne contient que des choses sur lesquelles le CM peut agir tout de suite, chacune
//     menant à l'écran où l'action se fait.

interface LignePreparation {
  section: string;
  etat: string;
  detail: string | null;
}

interface Evenement {
  action: string;
  detail: string | null;
  created_at: string;
  profiles: { prenom: string | null } | null;
}

interface MatchDuJour {
  id: string;
  equipe: string | null;
  adversaire: string | null;
  heure: string | null;
  domicile: boolean | null;
  lieu: string | null;
  competition: string | null;
  couverture: boolean;
}

interface EntrainementDuJour {
  equipe: string | null;
  debut: string | null;
  fin: string | null;
  lieu: string | null;
}

interface TableauDeBord {
  aujourdhui: { matchs: MatchDuJour[]; entrainements: EntrainementDuJour[] };
  a_faire: {
    demandes_du_club: number;
    resultats_manquants: number;
    prochaine_sans_couverture: { id: string; equipe: string | null; adversaire: string | null; date: string; heure: string | null } | null;
    equipes_sans_coach: number;
    sections_mise_en_place: number;
  };
  semaine: {
    du: string;
    au: string;
    matchs: number;
    entrainements: number;
    presences: number;
    contenus_a_publier: number;
  };
  adoption: {
    clubplus_total: number;
    clubplus_actifs: number;
    connect_total: number;
    connect_actifs: number;
  };
}

const ETAT_LB: Record<string, string> = {
  complet: "Prêt",
  a_completer: "À compléter",
  manquant: "Manquant",
  a_faire: "À faire",
};

/** « Aujourd'hui, 09:42 », « Hier », « Il y a 4 jours ». Un CM lit une date pour savoir s'il doit
 *  s'en occuper, pas pour connaître l'heure à la seconde près. */
function depuis(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const jours = Math.round((jour(new Date()) - jour(d)) / 86_400_000);
  if (jours <= 0) return `Aujourd'hui, ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  if (jours === 1) return "Hier";
  if (jours < 30) return `Il y a ${jours} jours`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/** « samedi 19 septembre », sans passer par un fuseau : la date arrive déjà en AAAA-MM-JJ. */
function dateLongue(ymd: string): string {
  const [a, m, j] = ymd.split("-").map(Number);
  if (!a || !m || !j) return ymd;
  return new Date(a, m - 1, j).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export function CmClubOverview() {
  const { ctx } = useSession();
  const [tableau, setTableau] = useState<TableauDeBord | null>(null);
  const [preparation, setPreparation] = useState<LignePreparation[] | null>(null);
  const [journal, setJournal] = useState<Evenement[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let vivant = true;
    // Remise a zero AVANT de charger : sans ca, changer de club laisse les compteurs du club
    // precedent a l'ecran le temps de la requete. Ce n'est pas une fuite de donnees — la base
    // refuserait — mais l'utilisateur lit pendant un instant des chiffres qui ne sont pas ceux
    // du club affiche, ce qui est pire qu'un ecran vide.
    setTableau(null);
    setPreparation(null);
    setJournal([]);
    (async () => {
      const [bord, prep, events] = await Promise.all([
        supabase.rpc("cm_tableau_de_bord", { p_club_id: ctx.organization.id }),
        supabase.rpc("club_preparation", { p_club_id: ctx.organization.id }),
        supabase
          .from("club_onboarding_events")
          .select("action, detail, created_at, profiles:auteur_id(prenom)")
          .eq("club_id", ctx.organization.id)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      if (!vivant) return;
      setTableau((bord.data as TableauDeBord | null) ?? null);
      setPreparation((prep.data as LignePreparation[] | null) ?? []);
      setJournal((events.data as unknown as Evenement[]) ?? []);
    })();
    return () => {
      vivant = false;
    };
  }, [ctx.organization.id]);

  const lignes = preparation ?? [];
  const pretes = lignes.filter((l) => l.etat === "complet").length;
  const aFaireSections = lignes.filter((l) => l.etat !== "complet");

  const t = tableau;
  const rienAujourdhui = t !== null && t.aujourdhui.matchs.length === 0 && t.aujourdhui.entrainements.length === 0;
  const taches = t
    ? [
        t.a_faire.demandes_du_club > 0 && {
          cle: "demandes",
          texte: `${t.a_faire.demandes_du_club} demande${t.a_faire.demandes_du_club > 1 ? "s" : ""} du club à traiter`,
          vers: "/requests",
        },
        t.a_faire.resultats_manquants > 0 && {
          cle: "resultats",
          texte: `${t.a_faire.resultats_manquants} résultat${t.a_faire.resultats_manquants > 1 ? "s" : ""} à renseigner`,
          vers: "/matchcenter",
        },
        t.a_faire.prochaine_sans_couverture && {
          cle: "couverture",
          texte: `${t.a_faire.prochaine_sans_couverture.equipe ?? "Rencontre"} contre ${
            t.a_faire.prochaine_sans_couverture.adversaire ?? "?"
          } le ${dateLongue(t.a_faire.prochaine_sans_couverture.date)} : couverture SportVision à décider`,
          vers: "/calendar",
        },
        t.a_faire.equipes_sans_coach > 0 && {
          cle: "coachs",
          texte: `${t.a_faire.equipes_sans_coach} équipe${t.a_faire.equipes_sans_coach > 1 ? "s" : ""} sans coach renseigné`,
          vers: "/teams",
        },
        t.a_faire.sections_mise_en_place > 0 && {
          cle: "onboarding",
          texte: `${t.a_faire.sections_mise_en_place} section${
            t.a_faire.sections_mise_en_place > 1 ? "s" : ""
          } de mise en place à compléter`,
          vers: "/onboarding",
        },
      ].filter((x): x is { cle: string; texte: string; vers: string } => Boolean(x))
    : [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[.09em] text-brand-violet">Gestion SportVision</p>
        <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">{ctx.organization.name}</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">
          Vous accompagnez ce club pour SportVision.{" "}
          <span className="font-semibold text-text">Aucun message n&apos;est envoyé</span> tant que vous ne lancez pas
          les invitations.
        </p>
      </div>

      {/* ── Aujourd'hui ───────────────────────────────────────────────────────── */}
      <Card className="p-0">
        <h2 className="border-b border-border px-5 py-3.5 text-[13px] font-bold">Aujourd&apos;hui</h2>
        {t === null ? (
          <p className="px-5 py-6 text-[13px] text-text-soft">Chargement…</p>
        ) : rienAujourdhui ? (
          <p className="px-5 py-6 text-[13px] text-text-soft">Ni match ni entraînement aujourd&apos;hui.</p>
        ) : (
          <ul className="divide-y divide-border">
            {t.aujourdhui.matchs.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                <span className="w-14 flex-none text-[13.5px] font-extrabold tabular-nums">{m.heure ?? "—"}</span>
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
                <span
                  className={
                    m.couverture
                      ? "flex-none rounded-full bg-success-bg px-2.5 py-1 text-[11.5px] font-bold text-success-fg"
                      : "flex-none rounded-full bg-surface-sunken px-2.5 py-1 text-[11.5px] font-bold text-text-faint"
                  }
                >
                  {m.couverture ? "SportVision présent" : "Couverture à décider"}
                </span>
              </li>
            ))}
            {t.aujourdhui.entrainements.map((e, i) => (
              <li key={`e${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                <span className="w-14 flex-none text-[13.5px] font-extrabold tabular-nums">{e.debut ?? "—"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold">Entraînement {e.equipe ?? ""}</span>
                  <span className="block text-[12px] text-text-soft">
                    {e.debut && e.fin ? `${e.debut} – ${e.fin}` : ""}
                    {e.lieu ? ` · ${e.lieu}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── À faire : uniquement ce qui est actionnable, chaque ligne mène à l'écran ── */}
      <Card className="p-0">
        <h2 className="border-b border-border px-5 py-3.5 text-[13px] font-bold">À faire</h2>
        {t === null ? (
          <p className="px-5 py-6 text-[13px] text-text-soft">Chargement…</p>
        ) : taches.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-text-soft">Rien ne vous attend. Tout est à jour.</p>
        ) : (
          <ul className="divide-y divide-border">
            {taches.map((tache) => (
              <li key={tache.cle}>
                <Link
                  href={tache.vers}
                  className="flex items-center justify-between gap-4 px-5 py-3 text-[13.5px] font-semibold hover:bg-surface-sunken"
                >
                  <span className="min-w-0">{tache.texte}</span>
                  <span aria-hidden className="flex-none text-text-faint">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Cette semaine ─────────────────────────────────────────────────────── */}
      {t !== null && (
        <Card className="p-0">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3.5">
            <h2 className="text-[13px] font-bold">Cette semaine</h2>
            <span className="text-[12px] text-text-soft">
              du {dateLongue(t.semaine.du)} au {dateLongue(t.semaine.au)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            {[
              { lb: "Matchs", n: t.semaine.matchs },
              { lb: "Entraînements", n: t.semaine.entrainements },
              { lb: "Présences SportVision", n: t.semaine.presences },
              { lb: "Contenus à publier", n: t.semaine.contenus_a_publier },
            ].map((c) => (
              <div key={c.lb} className="bg-surface px-5 py-4">
                <div className="text-[22px] font-extrabold tabular-nums">{c.n}</div>
                <div className="mt-0.5 text-[12px] text-text-soft">{c.lb}</div>
              </div>
            ))}
          </div>
          {/* Le bloc adoption n'apparaît que s'il y a quelque chose à compter : « 0 / 0 » aurait
              l'air d'une mesure alors que ce n'est qu'une absence de donnée. */}
          {(t.adoption.clubplus_total > 0 || t.adoption.connect_total > 0) && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-5 py-3 text-[12.5px] text-text-soft">
              {t.adoption.clubplus_total > 0 && (
                <span>
                  Club+ ·{" "}
                  <span className="font-bold tabular-nums text-text">
                    {t.adoption.clubplus_actifs} / {t.adoption.clubplus_total}
                  </span>{" "}
                  coachs actifs
                </span>
              )}
              {t.adoption.connect_total > 0 && (
                <span>
                  Connect ·{" "}
                  <span className="font-bold tabular-nums text-text">
                    {t.adoption.connect_actifs} / {t.adoption.connect_total}
                  </span>{" "}
                  joueurs inscrits
                </span>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ── Mise en place ─────────────────────────────────────────────────────── */}
      <Card className="p-0">
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 className="text-[13px] font-bold">Préparation du club</h2>
          {preparation !== null && lignes.length > 0 && (
            <span className="text-[12px] tabular-nums text-text-soft">
              {pretes} section{pretes > 1 ? "s" : ""} sur {lignes.length} prête{pretes > 1 ? "s" : ""}
            </span>
          )}
        </div>
        {preparation === null ? (
          <p className="px-5 py-6 text-[13px] text-text-soft">Chargement…</p>
        ) : aFaireSections.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-text-soft">La mise en place est complète.</p>
        ) : (
          <ul className="divide-y divide-border">
            {aFaireSections.map((l) => (
              <li key={l.section} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">{l.section}</span>
                  {l.detail && <span className="block text-[12px] text-text-soft">{l.detail}</span>}
                </span>
                <span className="flex-none text-[12px] font-bold text-text-faint">{ETAT_LB[l.etat] ?? l.etat}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Activité récente ──────────────────────────────────────────────────── */}
      <Card className="p-0">
        <h2 className="border-b border-border px-5 py-3.5 text-[13px] font-bold">Activité récente</h2>
        {journal.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-text-soft">Rien ne s&apos;est encore passé sur ce club.</p>
        ) : (
          <ul className="divide-y divide-border">
            {journal.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-5 py-3">
                <span className="min-w-0 text-[13.5px]">
                  {e.profiles?.prenom ? <span className="font-semibold">{e.profiles.prenom} </span> : null}
                  {e.detail ?? e.action}
                </span>
                <span className="flex-none text-[12px] text-text-faint">{depuis(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
