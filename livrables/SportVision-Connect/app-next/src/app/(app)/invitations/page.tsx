"use client";

// /invitations — qui a été invité, qui a rejoint, qui n'a pas répondu.
//
// ── Pourquoi une page, et pas trois ──
// Un club invite des coachs, des joueurs et des parents. Trois tables en base, trois mécanismes
// différents (nominatif à jeton pour un encadrant, adresse pour une famille) — mais une seule
// question du côté du club : où en sont mes invitations ? Les répartir sur trois écrans reviendrait
// à lui faire porter notre découpage technique.
//
// ── Ce que la page NE fait pas ──
// Elle n'invite personne. Inviter demande un contexte — quelle équipe, quel enfant, quel rôle — et
// ce contexte vit dans la fiche de l'équipe ou dans « Coachs & dirigeants ». Une invitation lancée
// depuis un écran de suivi obligerait à redemander tout ce que l'écran d'origine sait déjà.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Inbox, RotateCw, X } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LockedModule } from "@/components/ui/LockedModule";
import { Toast, useToast } from "@/components/feedback/Toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import {
  GENRE_LABEL,
  annulerInvitationFamille,
  buildInvitationUrl,
  envoyerInvitationParEmail,
  fetchClubInvitations,
  fetchSuiviInvitations,
  messageErreurInvitation,
  peutOpererClub,
  revoquerInvitation,
  statutLisibleSuivi,
  type GenreInvitation,
  type LigneSuivi,
} from "@/lib/data/club/invitations";

const FILTRES: { cle: GenreInvitation | "tous"; label: string }[] = [
  { cle: "tous", label: "Toutes" },
  { cle: "encadrant", label: "Coachs & dirigeants" },
  { cle: "joueur", label: "Joueurs" },
  { cle: "parent", label: "Parents" },
];

export default function InvitationsPage() {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();
  const [lignes, setLignes] = useState<LigneSuivi[] | null>(null);
  const [jetons, setJetons] = useState<Record<string, string>>({});
  const [peutGerer, setPeutGerer] = useState<boolean | null>(null);
  const [filtre, setFiltre] = useState<GenreInvitation | "tous">("tous");
  const [occupe, setOccupe] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const clubId = ctx.organization.id;
  const estClub = ctx.organization.type === "club";

  const charger = useCallback(() => {
    if (!estClub) return;
    const supabase = createClient();
    fetchSuiviInvitations(supabase, clubId)
      .then(setLignes)
      .catch(() => setLignes([]));
    // Les jetons des invitations d'encadrants sont lus à part : `suivi_invitations_club` ne les
    // rend pas, et c'est voulu — un suivi n'a pas à faire circuler des jetons d'activation.
    // On les récupère depuis la table, que seul un opérateur du club peut lire.
    fetchClubInvitations(supabase, clubId)
      .then((inv) => setJetons(Object.fromEntries(inv.map((i) => [i.id, i.token]))))
      .catch(() => setJetons({}));
  }, [clubId, estClub]);

  useEffect(() => {
    if (!estClub) {
      setPeutGerer(false);
      return;
    }
    peutOpererClub(createClient(), clubId).then(setPeutGerer);
    charger();
  }, [charger, clubId, estClub]);

  if (!estClub) return <LockedModule title="Invitations" />;

  const visibles = (lignes ?? []).filter((l) => filtre === "tous" || l.genre === filtre);
  const enAttente = (lignes ?? []).filter((l) => l.statut === "envoyee" || l.statut === "preparee").length;

  function agir(cle: string, action: Promise<unknown>, succes: string) {
    setOccupe(cle);
    setErreur(null);
    action
      .then(() => {
        showToast(succes);
        charger();
      })
      .catch((e) => setErreur(messageErreurInvitation(e, "Action impossible.")))
      .finally(() => setOccupe(null));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">Club+</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Invitations</h1>
          <p className="mt-1.5 text-[13.5px] text-text-soft">
            {enAttente > 0
              ? `${enAttente} invitation${enAttente > 1 ? "s" : ""} en attente de réponse.`
              : "Personne n'attend de réponse."}
          </p>
        </div>
        {/* Inviter demande un contexte : on renvoie là où il existe, plutôt que de le redemander. */}
        <div className="flex flex-wrap gap-2">
          <Link href="/users">
            <Button variant="secondary" className="h-10 px-4 text-[13px]">
              Inviter un encadrant
            </Button>
          </Link>
          <Link href="/teams">
            <Button variant="secondary" className="h-10 px-4 text-[13px]">
              Inviter depuis une équipe
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-divider pb-3">
        {FILTRES.map((f) => {
          const n = f.cle === "tous" ? (lignes ?? []).length : (lignes ?? []).filter((l) => l.genre === f.cle).length;
          return (
            <button
              key={f.cle}
              onClick={() => setFiltre(f.cle)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition-colors duration-sv",
                filtre === f.cle
                  ? "border-transparent bg-gradient-to-br from-brand-blue to-brand-violet text-white"
                  : "border-border-strong bg-transparent text-text-soft hover:border-brand-blue-electric",
              )}
            >
              {f.label}
              {n > 0 && <span className="opacity-80">· {n}</span>}
            </button>
          );
        })}
      </div>

      {lignes === null ? (
        <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>
      ) : visibles.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-14 text-center">
          <Inbox className="h-7 w-7 text-text-faint" aria-hidden />
          <div className="text-[14px] font-extrabold">Aucune invitation</div>
          <p className="max-w-[420px] text-[12.5px] leading-relaxed text-text-soft">
            Les invitations partent d&apos;une fiche équipe pour les joueurs et les parents, et de
            « Coachs &amp; dirigeants » pour l&apos;encadrement.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {visibles.map((l) => {
            const s = statutLisibleSuivi(l.statut);
            const modifiable = l.statut === "preparee" || l.statut === "envoyee" || l.statut === "expiree";
            const jeton = jetons[l.id];
            return (
              <div
                key={`${l.genre}-${l.id}`}
                className="flex flex-wrap items-center gap-3 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold">{l.personne || l.email}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-text-soft">{l.email}</span>
                </span>
                <span className="w-40 flex-none text-[12px] font-semibold text-text-soft">
                  {GENRE_LABEL[l.genre]}
                  <span className="block text-[11.5px] text-text-faint">{l.roleOuEquipe}</span>
                </span>
                <Badge tone={s.ton}>{s.label}</Badge>

                {peutGerer && modifiable && (
                  <div className="flex flex-none flex-wrap items-center gap-2">
                    {l.genre === "encadrant" ? (
                      <>
                        <Button
                          variant="secondary"
                          className="h-8 px-3 text-[12px]"
                          disabled={occupe !== null}
                          onClick={() =>
                            agir(l.id, envoyerInvitationParEmail(createClient(), l.id), "Invitation envoyée.")
                          }
                        >
                          <RotateCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                          {l.statut === "preparee" ? "Envoyer" : "Renvoyer"}
                        </Button>
                        {jeton && (
                          <Button
                            variant="secondary"
                            className="h-8 px-3 text-[12px]"
                            onClick={() => {
                              navigator.clipboard.writeText(buildInvitationUrl(jeton));
                              showToast("Lien copié.");
                            }}
                          >
                            <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
                            Lien
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          className="h-8 px-3 text-[12px]"
                          disabled={occupe !== null}
                          onClick={() => agir(l.id, revoquerInvitation(createClient(), l.id), "Invitation révoquée.")}
                        >
                          <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                          Révoquer
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        className="h-8 px-3 text-[12px]"
                        disabled={occupe !== null}
                        onClick={() =>
                          agir(
                            l.id,
                            annulerInvitationFamille(createClient(), l.id, l.genre as "joueur" | "parent"),
                            "Invitation annulée.",
                          )
                        }
                      >
                        <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                        Annuler
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {erreur && <p className="text-[12.5px] font-bold text-danger-fg">{erreur}</p>}
      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}
