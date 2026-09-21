"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { confirmerMatch, fetchMatchsAConfirmer, type MatchAConfirmer } from "@/lib/data/club/match-confirmation";
import { PencilLine } from "lucide-react";
import { parseDateOnly } from "@/lib/date-only";

// Le rappel « ces matchs ne sont pas confirmés » (v241, 21/09/2026).
//
// Fouka a décidé le 21/09/2026 de ne rien envoyer automatiquement : pas d'e-mail de relance aux
// coachs tant qu'on n'a pas vu s'ils jouent le jeu. Ce bandeau est donc le seul rappel, et il doit
// suffire : visible en haut du calendrier, avec le bouton de confirmation directement dessus. Un
// coach ne devrait pas avoir à ouvrir trois matchs pour dire trois fois « oui c'est exact ».
//
// Il ne s'affiche pas quand il n'y a rien à confirmer. Un bandeau permanent qui annonce « 0 match à
// confirmer » est du décor, et il apprend au lecteur à ne plus regarder cette zone de l'écran.

interface RappelMatchsAConfirmerProps {
  clubId: string;
  /** Rappelé après chaque confirmation, pour recharger le calendrier derrière. */
  onConfirme?: () => void;
}

function quand(m: MatchAConfirmer): string {
  if (!m.date) return "date à préciser";
  const jour = parseDateOnly(m.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  return m.heure ? `${jour} à ${m.heure.slice(0, 5)}` : `${jour}, heure à préciser`;
}

export function RappelMatchsAConfirmer({ clubId, onConfirme }: RappelMatchsAConfirmerProps) {
  const [liste, setListe] = useState<MatchAConfirmer[]>([]);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  // 21/09/2026, Fouka : « dans les trucs horaires à confirmer, il peut mettre aussi : ce n'est
  // pas la bonne horaire, modifier l'horaire ». Le bandeau ne proposait que « c'est exact », et
  // celui qui savait que l'heure était fausse devait aller ouvrir la fiche du match pour le dire.
  // Or c'est précisément lui qu'on veut ne pas décourager : une correction en trois champs, ici.
  const [corrige, setCorrige] = useState<string | null>(null);
  const [fDate, setFDate] = useState("");
  const [fHeure, setFHeure] = useState("");
  const [fLieu, setFLieu] = useState("");

  function ouvrirCorrection(m: MatchAConfirmer) {
    setCorrige(m.id);
    setErreur(null);
    setFDate(m.date ?? "");
    setFHeure((m.heure ?? "").slice(0, 5));
    setFLieu(m.lieu ?? "");
  }

  const recharger = useCallback(() => {
    fetchMatchsAConfirmer(createClient(), clubId)
      .then(setListe)
      // Un club dont la lecture échoue n'a pas besoin d'un message d'erreur sur un bandeau
      // secondaire : le calendrier lui-même affichera son propre état.
      .catch(() => setListe([]));
  }, [clubId]);

  useEffect(() => recharger(), [recharger]);

  // Seuls les matchs que CE lecteur peut confirmer. Un président voit tout le club, un coach voit
  // ses équipes : c'est la base qui le dit (confirmable), pas ce composant.
  const miens = liste.filter((m) => m.confirmable);
  if (miens.length === 0) return null;

  async function confirmer(m: MatchAConfirmer, correction = false) {
    setEnCours(m.id);
    setErreur(null);
    try {
      await confirmerMatch(
        createClient(),
        m.id,
        correction ? { date: fDate || undefined, heure: fHeure || undefined, lieu: fLieu || undefined } : {},
      );
      setListe((prev) => prev.filter((x) => x.id !== m.id));
      setCorrige(null);
      onConfirme?.();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "La confirmation n'a pas pu être enregistrée.");
    } finally {
      setEnCours(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-sv-card border border-warning-fg/25 bg-warning-bg px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <CalendarClock className="mt-[2px] h-4 w-4 flex-none text-warning-fg" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-extrabold text-warning-fg">
            {miens.length === 1
              ? "Un match à confirmer"
              : `${miens.length} matchs à confirmer`}
          </span>
          <span className="text-[12px] text-warning-fg/80">
            Horaire et lieu viennent de la fédération ou d&apos;un import. Confirmez-les pour que
            l&apos;équipe SportVision se déplace au bon endroit, à la bonne heure.
          </span>
        </div>
      </div>

      {erreur && <span className="text-[11.5px] font-bold text-danger-fg">{erreur}</span>}

      <ul className="flex flex-col gap-1.5">
        {/* Cinq lignes au maximum : au-delà, le bandeau prendrait tout l'écran et cacherait le
            calendrier qu'il commente. Le reste se confirme depuis la fiche de chaque match. */}
        {miens.slice(0, 5).map((m) => {
          const champ =
            "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent";
          return (
            <li key={m.id} className="flex flex-col gap-2 rounded-lg bg-surface px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[12.5px] font-bold text-text">
                    {m.team ?? "Équipe"} — {m.opponent ?? "adversaire à préciser"}
                  </span>
                  <span className="truncate text-[11.5px] text-text-soft">
                    {quand(m)}
                    {m.lieu ? ` · ${m.lieu}` : ""}
                  </span>
                </div>
                {corrige !== m.id && (
                  <div className="flex flex-none items-center gap-1.5">
                    <button
                      type="button"
                      disabled={enCours === m.id}
                      onClick={() => confirmer(m)}
                      className="flex items-center gap-1.5 rounded-lg bg-success-bg px-2.5 py-1.5 text-[11.5px] font-extrabold text-success-fg hover:opacity-90 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      C&apos;est exact
                    </button>
                    <button
                      type="button"
                      disabled={enCours === m.id}
                      onClick={() => ouvrirCorrection(m)}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11.5px] font-extrabold text-text-soft hover:text-text disabled:opacity-50"
                    >
                      <PencilLine className="h-3.5 w-3.5" aria-hidden />
                      Ce n&apos;est pas la bonne heure
                    </button>
                  </div>
                )}
              </div>

              {corrige === m.id && (
                <div className="flex flex-col gap-2 border-t border-divider pt-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-[.05em] text-text-faint">Date</span>
                      <input type="date" className={champ} value={fDate} onChange={(e) => setFDate(e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-[.05em] text-text-faint">Heure</span>
                      <input type="time" className={champ} value={fHeure} onChange={(e) => setFHeure(e.target.value)} />
                    </label>
                    <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                      <span className="text-[10px] font-bold uppercase tracking-[.05em] text-text-faint">Lieu</span>
                      <input className={champ} value={fLieu} placeholder="Stade, gymnase…" onChange={(e) => setFLieu(e.target.value)} />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={enCours === m.id}
                      onClick={() => confirmer(m, true)}
                      className="rounded-lg bg-success-bg px-2.5 py-1.5 text-[11.5px] font-extrabold text-success-fg hover:opacity-90 disabled:opacity-50"
                    >
                      Enregistrer et confirmer
                    </button>
                    <button
                      type="button"
                      disabled={enCours === m.id}
                      onClick={() => { setCorrige(null); setErreur(null); }}
                      className="text-[11.5px] font-bold text-text-faint underline underline-offset-2 hover:text-text disabled:opacity-50"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {miens.length > 5 && (
        <span className="text-[11.5px] text-warning-fg/80">
          Et {miens.length - 5} autre{miens.length - 5 > 1 ? "s" : ""}, à confirmer depuis le calendrier.
        </span>
      )}
    </div>
  );
}
