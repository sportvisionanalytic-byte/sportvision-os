"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useModalA11y } from "@/lib/useModalA11y";
import { useFermetureEchap } from "@/lib/use-fermeture-echap";
import { createClient } from "@/lib/supabase/client";
import { fetchClubCalendrier } from "@/lib/data/club/calendar";
import {
  changerStatutContenu,
  creerContenu,
  dupliquerContenu,
  modifierContenu,
  supprimerContenu,
  type ContenuCm,
  type SaisieContenu,
} from "@/lib/data/club/planningEditorial";
import {
  CANAUX,
  STATUT_LIBELLE,
  STATUTS_MODIFIABLES,
  TYPES_CONTENU,
  ecrireCanaux,
  isoJour,
  lireCanaux,
  plusJours,
  depuisIso,
  statutsSuivants,
  suggestionsMatch,
  type StatutContenu,
} from "@/lib/communication/planning";
import type { CalendarEvent } from "@/lib/types/calendar";
import type { Team } from "@/lib/types/teams";

// La fiche d'un contenu du planning éditorial (11/09/2026) : créer, modifier, reprogrammer,
// dupliquer, faire avancer le statut selon le workflow de la base, supprimer un contenu non publié,
// ouvrir la fiche détaillée existante. Un contenu publié ne se réécrit pas : il s'archive ou se
// duplique. Rien n'est créé automatiquement : autour d'un match, les suggestions PRÉREMPLISSENT.

export const TON_STATUT: Record<StatutContenu, BadgeTone> = {
  brouillon: "neutral",
  a_valider_interne: "warning",
  a_valider_tuteur: "warning",
  corrections: "danger",
  pret: "info",
  a_valider_client: "warning",
  valide: "info",
  programme: "accent",
  publie: "success",
  archive: "neutral",
};

interface Props {
  clientId: string;
  clubId: string;
  cmId: string;
  peutModifier: boolean;
  teams: Team[];
  contenu?: ContenuCm;
  dateInitiale?: string;
  onFermer: () => void;
  onEnregistre: (message: string) => void;
}

export function FicheContenu({ clientId, clubId, cmId, peutModifier, teams, contenu, dateInitiale, onFermer, onEnregistre }: Props) {
  useFermetureEchap(true, onFermer);
  const ref = useRef<HTMLDivElement>(null);
  useModalA11y(ref, onFermer);
  const creation = !contenu;
  const modifiable = peutModifier && (!contenu || STATUTS_MODIFIABLES(contenu.statut));

  const [titre, setTitre] = useState(contenu?.titre ?? "");
  const [type, setType] = useState<string | null>(contenu?.typeContenu ?? "publication");
  const [date, setDate] = useState(contenu?.datePrevue ?? dateInitiale ?? isoJour(new Date()));
  const [heure, setHeure] = useState(contenu?.heurePrevue ?? "");
  // Instagram est proposé pour un nouveau contenu seulement : une fiche existante sans réseau le
  // reste, sinon l'enregistrer pour changer l'heure lui attribuerait Instagram en silence.
  const [canaux, setCanaux] = useState<string[]>(contenu ? lireCanaux(contenu.plateforme) : ["instagram"]);
  const [teamId, setTeamId] = useState(contenu?.teamId ?? "");
  const [evenement, setEvenement] = useState(
    contenu?.matchId ? `match:${contenu.matchId}` : contenu?.calendarEventId ? `evenement:${contenu.calendarEventId}` : contenu?.occurrenceRef ?? "",
  );
  const [brief, setBrief] = useState(contenu?.description ?? "");
  const [evenements, setEvenements] = useState<CalendarEvent[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmeSuppression, setConfirmeSuppression] = useState(false);

  useEffect(() => {
    const avant = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = avant;
    };
  }, []);

  // Les événements du club autour de la date : matchs, séances, événements, pour rattacher le contenu.
  useEffect(() => {
    if (!date) return;
    const j = depuisIso(date);
    fetchClubCalendrier(createClient(), clubId, isoJour(plusJours(j, -3)), isoJour(plusJours(j, 7)))
      .then((l) => setEvenements(l.filter((e) => e.kind === "match" || e.kind === "training" || e.kind === "event")))
      .catch(() => setEvenements([]));
  }, [clubId, date]);

  const choisi = useMemo(() => evenements.find((e) => e.id === evenement), [evenements, evenement]);
  const suggestions = useMemo(
    () =>
      choisi && choisi.kind === "match"
        ? suggestionsMatch({ date: choisi.startsAt.slice(0, 10), heure: choisi.allDay ? null : choisi.startsAt.slice(11, 16), equipe: choisi.teamName, adversaire: choisi.opponent })
        : [],
    [choisi],
  );

  function saisie(): SaisieContenu {
    return {
      titre,
      typeContenu: type,
      plateforme: ecrireCanaux(canaux),
      datePrevue: date || null,
      heurePrevue: heure || null,
      teamId: teamId || null,
      description: brief,
      evenement: evenement || null,
    };
  }

  async function agir(action: () => Promise<string>) {
    setEnvoi(true);
    setErreur(null);
    try {
      const message = await action();
      onEnregistre(message);
    } catch (e) {
      setErreur((e as { message?: string } | null)?.message || "L'action n'a pas abouti.");
    } finally {
      setEnvoi(false);
    }
  }

  const supabase = () => createClient();
  const libelleEvenement = (e: CalendarEvent) =>
    `${new Date(e.startsAt).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} · ${e.title}`;

  const champ = "h-11 w-full rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] text-text outline-none focus-visible:border-brand-blue disabled:opacity-70";
  const etiquette = "mb-1.5 block text-[12px] font-extrabold uppercase tracking-[.05em] text-text-soft";

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fiche-contenu-titre"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-[rgba(7,10,23,.65)] sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFermer();
      }}
    >
      <div className="animate-svfade flex h-[100dvh] w-full flex-col overflow-hidden bg-surface shadow-sv-modal sm:h-auto sm:max-h-[90vh] sm:max-w-[620px] sm:rounded-sv-modal">
        <header className="flex flex-none items-start gap-3 border-b border-border px-5 pb-4 pt-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id="fiche-contenu-titre" className="text-[19px] font-extrabold tracking-tight text-text">
              {creation ? "Ajouter au planning" : contenu.titre}
            </h2>
            {contenu && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge tone={TON_STATUT[contenu.statut]}>{STATUT_LIBELLE[contenu.statut]}</Badge>
                {!modifiable && peutModifier && (
                  <span className="text-[12px] text-text-soft">Publié : il s&apos;archive ou se duplique, il ne se réécrit plus.</span>
                )}
              </div>
            )}
          </div>
          <button type="button" aria-label="Fermer" onClick={onFermer} className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text">
            <X className="h-4.5 w-4.5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <fieldset disabled={!modifiable} className="flex flex-col gap-5">
            <div>
              <span className={etiquette}>Type</span>
              <div className="flex flex-wrap gap-1.5">
                {TYPES_CONTENU.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={type === t.id}
                    onClick={() => setType(t.id)}
                    className={`h-9 rounded-full px-3.5 text-[13px] font-bold transition-colors ${
                      type === t.id ? "bg-text text-surface" : "border border-border-strong text-text-soft hover:text-text"
                    }`}
                  >
                    {t.emoji} {t.libelle}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className={etiquette}>Titre / sujet</span>
              <input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Ex. : Matchday Seniors R2" className={champ} />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={etiquette}>Date</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={champ} />
              </label>
              <label className="block">
                <span className={etiquette}>Heure</span>
                <input type="time" value={heure} onChange={(e) => setHeure(e.target.value)} className={champ} />
              </label>
            </div>

            <div>
              <span className={etiquette}>Réseaux</span>
              <div className="flex flex-wrap gap-1.5">
                {CANAUX.map((c) => {
                  const actif = canaux.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={actif}
                      onClick={() => setCanaux((prev) => (actif ? prev.filter((x) => x !== c.id) : [...prev, c.id]))}
                      className={`h-9 rounded-full px-3.5 text-[13px] font-bold transition-colors ${
                        actif ? "border border-brand-blue bg-accent-bg text-accent-fg" : "border border-border-strong text-text-soft hover:text-text"
                      }`}
                    >
                      {c.libelle}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={etiquette}>Équipe (facultatif)</span>
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={champ}>
                  <option value="">Tout le club</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={etiquette}>Événement associé (facultatif)</span>
                <select value={evenement} onChange={(e) => setEvenement(e.target.value)} className={champ}>
                  <option value="">Aucun</option>
                  {evenement && !choisi && <option value={evenement}>Événement déjà rattaché</option>}
                  {evenements.map((e) => (
                    <option key={e.id} value={e.id}>
                      {libelleEvenement(e)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {modifiable && suggestions.length > 0 && (
              <div className="rounded-xl border border-border bg-surface-sunken p-3.5">
                <span className="block text-[12.5px] font-extrabold text-text">Préparer autour de ce match</span>
                <span className="mt-0.5 block text-[12px] text-text-soft">Un clic préremplit ce contenu. Rien n&apos;est créé tant que vous n&apos;enregistrez pas.</span>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s.cle}
                      type="button"
                      onClick={() => {
                        setTitre(s.titre);
                        setType(s.typeContenu);
                        setDate(s.datePrevue);
                        setHeure(s.heurePrevue);
                        const eq = teams.find((t) => t.name === choisi?.teamName);
                        if (eq) setTeamId(eq.id);
                      }}
                      className="h-8 rounded-full border border-border-strong bg-surface px-3 text-[12.5px] font-bold text-text-soft hover:text-text"
                    >
                      {s.titre.split(" · ")[0]} · {new Date(`${s.datePrevue}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short" })} {s.heurePrevue}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="block">
              <span className={etiquette}>Brief / note</span>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={4}
                placeholder="Angle, joueurs à mettre en avant, sponsor, visuel attendu…"
                className="w-full resize-none rounded-xl border border-border-strong bg-input-bg px-3.5 py-3 text-[14px] text-text outline-none focus-visible:border-brand-blue disabled:opacity-70"
              />
            </label>
          </fieldset>

          {contenu && peutModifier && statutsSuivants(contenu.statut).length > 0 && (
            <div className="mt-5 rounded-xl border border-border p-3.5">
              <span className="block text-[12.5px] font-extrabold text-text">Faire avancer</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {statutsSuivants(contenu.statut).map((s) => (
                  <Button
                    key={s}
                    variant="secondary"
                    className="h-9 px-3 text-[12.5px]"
                    disabled={envoi}
                    onClick={() => void agir(async () => {
                      await changerStatutContenu(supabase(), contenu.id, s);
                      return `« ${contenu.titre} » : ${STATUT_LIBELLE[s].toLowerCase()}.`;
                    })}
                  >
                    → {STATUT_LIBELLE[s]}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="flex flex-none flex-col gap-2.5 border-t border-border bg-surface px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-6">
          {erreur && <p className="text-[12.5px] font-bold text-danger-fg">{erreur}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {contenu && peutModifier && STATUTS_MODIFIABLES(contenu.statut) && (
              confirmeSuppression ? (
                <Button
                  variant="danger"
                  className="h-11"
                  loading={envoi}
                  onClick={() => void agir(async () => {
                    await supprimerContenu(supabase(), contenu.id);
                    return `« ${contenu.titre} » supprimé.`;
                  })}
                >
                  Confirmer la suppression
                </Button>
              ) : (
                <button type="button" onClick={() => setConfirmeSuppression(true)} className="h-11 px-2 text-[13px] font-bold text-danger-fg hover:underline">
                  Supprimer
                </button>
              )
            )}
            <span className="flex-1" />
            {contenu && (
              <Link href={`/communication/publications/${contenu.id}`} className="h-11 px-2 text-[13px] font-bold leading-[44px] text-text-soft hover:text-text">
                Ouvrir le contenu
              </Link>
            )}
            {contenu && peutModifier && (
              <Button
                variant="secondary"
                className="h-11"
                disabled={envoi}
                onClick={() => void agir(async () => {
                  const copie = await dupliquerContenu(supabase(), clientId, cmId, contenu);
                  return `Copie créée : « ${copie.titre} ».`;
                })}
              >
                Dupliquer
              </Button>
            )}
            {contenu && peutModifier && contenu.statut === "publie" && (
              <Button
                variant="secondary"
                className="h-11"
                disabled={envoi}
                onClick={() => void agir(async () => {
                  await changerStatutContenu(supabase(), contenu.id, "archive");
                  return `« ${contenu.titre} » archivé.`;
                })}
              >
                Archiver
              </Button>
            )}
            {modifiable && (
              <Button
                className="h-11"
                loading={envoi}
                disabled={!titre.trim() || !date}
                onClick={() => void agir(async () => {
                  if (creation) {
                    const c = await creerContenu(supabase(), clientId, cmId, saisie());
                    return `« ${c.titre} » ajouté au planning.`;
                  }
                  const c = await modifierContenu(supabase(), contenu.id, saisie());
                  return `« ${c.titre} » enregistré.`;
                })}
              >
                {creation ? "Ajouter au planning" : "Enregistrer"}
              </Button>
            )}
            {!peutModifier && (
              <Button variant="secondary" className="h-11" onClick={onFermer}>
                Fermer
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
