"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";

// La vue d'ensemble d'un Community Manager SportVision sur un club qu'il gère.
//
// Elle répond aux trois questions qu'il se pose en ouvrant un club : où en est la mise en place,
// que reste-t-il à faire, et que s'est-il passé depuis la dernière fois. Rien d'autre — le
// tableau de bord du président montre la vie du club, celui-ci montre le travail du CM.
//
// Tout vient de la base : club_preparation() calcule chaque état depuis les données réelles, et
// club_onboarding_events porte le journal. Aucun pourcentage global n'est affiché : additionner
// des sections qui n'ont pas le même poids donne un chiffre qui a l'air précis et ne veut rien
// dire. « 4 sections sur 6 » se lit mieux et ne ment pas.

interface LignePreparation {
  section: string;
  etat: string;
  detail: string | null;
  calcule: boolean;
}

interface Evenement {
  action: string;
  detail: string | null;
  created_at: string;
  profiles: { prenom: string | null } | null;
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

export function CmClubOverview() {
  const { ctx } = useSession();
  const [preparation, setPreparation] = useState<LignePreparation[] | null>(null);
  const [journal, setJournal] = useState<Evenement[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let vivant = true;
    (async () => {
      const [prep, events] = await Promise.all([
        supabase.rpc("club_preparation", { p_club_id: ctx.organization.id }),
        supabase
          .from("club_onboarding_events")
          .select("action, detail, created_at, profiles:auteur_id(prenom)")
          .eq("club_id", ctx.organization.id)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      if (!vivant) return;
      setPreparation((prep.data as LignePreparation[] | null) ?? []);
      setJournal((events.data as unknown as Evenement[]) ?? []);
    })();
    return () => {
      vivant = false;
    };
  }, [ctx.organization.id]);

  const lignes = preparation ?? [];
  const pretes = lignes.filter((l) => l.etat === "complet").length;
  const aFaire = lignes.filter((l) => l.etat !== "complet");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[.09em] text-brand-violet">Gestion SportVision</p>
        <h1 className="mt-1 text-[24px] font-extrabold tracking-tight">{ctx.organization.name}</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">
          Vous préparez ce club pour SportVision.{" "}
          <span className="font-semibold text-text">Aucun message n&apos;est envoyé</span> tant que vous ne lancez pas
          les invitations.
        </p>
      </div>

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
        ) : lignes.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-text-soft">
            Aucune information de préparation pour ce club.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {lignes.map((l) => (
              <li key={l.section} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">{l.section}</span>
                  {l.detail && <span className="block text-[12px] text-text-soft">{l.detail}</span>}
                </span>
                <span
                  className={
                    l.etat === "complet"
                      ? "flex-none text-[12px] font-semibold text-success"
                      : "flex-none text-[12px] font-semibold text-warning"
                  }
                >
                  {ETAT_LB[l.etat] ?? l.etat}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border px-5 py-3.5">
          <Link
            href="/onboarding"
            className="inline-flex min-h-[40px] items-center rounded-sv-pill bg-sv-gradient px-5 text-[13.5px] font-bold text-white"
          >
            Continuer la mise en place
          </Link>
        </div>
      </Card>

      {aFaire.length > 0 && (
        <Card className="p-0">
          <h2 className="border-b border-border px-5 py-3.5 text-[13px] font-bold">À faire</h2>
          <ul className="divide-y divide-border">
            {aFaire.map((l) => (
              <li key={l.section} className="px-5 py-3 text-[13.5px]">
                <span className="text-warning">⚠</span> {l.section}
                {l.detail ? <span className="text-text-soft"> — {l.detail}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-0">
        <h2 className="border-b border-border px-5 py-3.5 text-[13px] font-bold">Activité récente</h2>
        {journal.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-text-soft">
            Rien pour l&apos;instant. Vos actions sur ce club apparaîtront ici.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {journal.map((e, i) => (
              <li key={`${e.created_at}-${i}`} className="px-5 py-3">
                <span className="block text-[13px]">{e.detail ?? e.action}</span>
                <span className="block text-[11.5px] text-text-soft">
                  {e.profiles?.prenom ?? "SportVision"} · {depuis(e.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
