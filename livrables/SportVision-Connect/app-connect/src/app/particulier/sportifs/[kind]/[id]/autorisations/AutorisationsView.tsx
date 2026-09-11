"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import {
  STATUT_AUTORISATION,
  fetchAutorisations,
  retirerAutorisation,
  signerAutorisation,
  type Autorisation,
} from "@/lib/supabase/autorisations";
import type { AthleteDetail } from "../AthleteDetailView";

// Les autorisations parentales, signées ici et nulle part ailleurs (v176).
// Une autorisation accordée s'affiche avec sa date ; un refus se corrige en accordant, un accord se
// retire sans justification. Rien n'est écrit par cet écran : trois fonctions serveur s'en chargent.
const COULEUR_STATUT: Record<string, string> = {
  valide: "text-affiliations",
  refusee: "text-danger",
  retiree: "text-danger",
  expiree: "text-danger",
};

export function AutorisationsView({
  detail,
  initiales,
}: {
  detail: AthleteDetail;
  initiales: Autorisation[];
}) {
  const [liste, setListe] = useState(initiales);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);

  async function rafraichir() {
    try {
      setListe(await fetchAutorisations(createClient(), detail.ref_id));
    } catch {
      /* la liste affichée reste celle qu'on avait */
    }
  }

  async function agir(code: string, action: "accorder" | "refuser" | "retirer") {
    setEnCours(code);
    setErreur(null);
    try {
      const supabase = createClient();
      if (action === "retirer") await retirerAutorisation(supabase, detail.ref_id, code);
      else await signerAutorisation(supabase, detail.ref_id, code, action === "accorder");
      await rafraichir();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "L'enregistrement n'a pas abouti.");
    } finally {
      setEnCours(null);
    }
  }

  const aSigner = liste.filter((a) => !["valide", "refusee"].includes(a.statut));

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div>
        <Link
          href={`/particulier/sportifs/${detail.kind}/${detail.ref_id}`}
          className="flex min-h-11 w-fit items-center gap-2 text-[14px] font-medium text-text-tertiary hover:text-text"
        >
          <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
          {detail.first_name}
        </Link>
        <h1 className="mt-3 font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">
          Autorisations de {detail.first_name}
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-text-tertiary">
          Ce que vous autorisez, et ce que vous refusez. Sans le droit à l&apos;image, les photos et
          vidéos où {detail.first_name} apparaît restent masquées, y compris pour vous. Vous pouvez
          revenir sur chaque décision à tout moment.
        </p>
      </div>

      {erreur && (
        <p role="alert" className="rounded-sv border border-danger-border bg-danger-bg px-4 py-3 text-[14px] text-danger">
          {erreur}
        </p>
      )}

      {aSigner.length > 0 && (
        <p className="rounded-sv border border-border-strong bg-white/[.06] px-4 py-3 text-[14px] text-text-secondary">
          {aSigner.length === 1
            ? "1 autorisation attend votre réponse."
            : `${aSigner.length} autorisations attendent votre réponse.`}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {liste.map((a) => {
          const accordee = a.statut === "valide";
          return (
            <section key={a.code} className="rounded-sv border border-border bg-white/[.04] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-sora text-[16px] font-semibold">
                    {a.label}
                    {a.obligatoire && (
                      <span className="ml-2 rounded-sv-pill bg-white/[.08] px-2 py-0.5 text-[11px] font-medium text-text-tertiary">
                        nécessaire au compte
                      </span>
                    )}
                  </h2>
                  <p className={`mt-1 text-[13px] ${COULEUR_STATUT[a.statut] ?? "text-text-tertiary"}`}>
                    {STATUT_AUTORISATION[a.statut] ?? a.statut}
                    {accordee && a.dateSignature
                      ? ` le ${new Date(a.dateSignature).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {accordee ? (
                    <Button
                      variant="danger"
                      className="h-11 text-[14px]"
                      disabled={enCours === a.code}
                      onClick={() => void agir(a.code, "retirer")}
                    >
                      Retirer
                    </Button>
                  ) : (
                    <>
                      <Button
                        className="h-11 text-[14px]"
                        loading={enCours === a.code}
                        disabled={enCours !== null}
                        onClick={() => void agir(a.code, "accorder")}
                      >
                        J&apos;accorde
                      </Button>
                      {a.statut !== "refusee" && (
                        <button
                          type="button"
                          disabled={enCours !== null}
                          onClick={() => void agir(a.code, "refuser")}
                          className="flex h-11 items-center rounded-sv border border-border-strong bg-white/[.06] px-4 font-sora text-[14px] font-semibold hover:bg-white/[.12] disabled:opacity-50"
                        >
                          Je refuse
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {a.texte && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setOuvert(ouvert === a.code ? null : a.code)}
                    className="text-[13px] font-medium text-text-tertiary underline hover:text-text-secondary"
                  >
                    {ouvert === a.code ? "Masquer le texte" : "Lire le texte"}
                  </button>
                  {ouvert === a.code && (
                    <p className="mt-2 max-w-[70ch] whitespace-pre-line text-[13.5px] leading-relaxed text-text-secondary">
                      {a.texte}
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {liste.length === 0 && (
          <p className="text-[14px] leading-relaxed text-text-tertiary">
            Aucune autorisation n&apos;est demandée pour {detail.first_name} pour le moment.
          </p>
        )}
      </div>
    </div>
  );
}
