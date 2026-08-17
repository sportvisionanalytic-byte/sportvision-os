"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Check, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { switchActiveSpace } from "@/lib/supabase/actions";
import { acceptClubInvitation, declineClubInvitation } from "@/lib/data/club/invitations";
import { ROLE_LABELS } from "@/lib/types/settings";
import type { Space } from "@/lib/supabase/session";

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

// Affiché à la place de la coque applicative quand aucun espace n'a pu être sélectionné
// automatiquement pour l'utilisateur connecté (voir pickActiveSpace, src/lib/supabase/session.ts) :
// soit il n'a aucun espace du tout, soit — cas corrigé le 10-11/08 — il a PLUSIEURS espaces déjà
// cliquables (ex. admin de deux clubs, ou parent ET membre d'un club) sans qu'aucun ne soit
// mémorisé pour trancher l'ambiguïté. Ce dernier cas affichait auparavant TOUS les espaces comme
// « Bientôt disponible », y compris ceux réellement disponibles, sans aucun moyen de les activer :
// l'utilisateur restait bloqué dès sa première connexion. Réutilise switchActiveSpace (même Server
// Action que OrganizationSwitcher) pour que cet écran serve aussi de vrai sélecteur quand c'est le
// cas, honnêtement.
//
// Le lien vers l'ancienne app vanilla (connectsportvisionfr.netlify.app) a été retiré le
// 12/08/2026 : cette app est retirée, plus rien ne doit y renvoyer un utilisateur — trouvé en
// creusant un signalement de Fouka ("ça m'a redirigé vers l'ancien Connect"). Le vrai bug était
// en amont (event/cm_agency absents du calcul de `clickable`, session.ts) : un espace non
// cliquable ne devrait plus jamais arriver pour un type d'organisation réel désormais.
//
// 17/08/2026 — invitation/suspension : getSpaces() (session.ts) ne filtre plus par statut, un
// espace où l'utilisateur est seulement invité ou suspendu atterrit donc ici plutôt que d'être
// invisible. Trouvé en creusant le retour de Fouka sur les états à prévoir : le mécanisme
// d'invitation (edge function clubplus-invite) était cassé de bout en bout, un invité n'avait
// aucun moyen de voir NI d'accepter sa propre invitation — voir migration-clubplus-v45 (NON
// EXÉCUTÉE) pour le correctif RPC accept_club_invitation/decline_club_invitation.
export function NoActiveSpace({ spaces }: { spaces: Space[] }) {
  const router = useRouter();
  const [activating, setActivating] = useState<string | null>(null);
  const [decidingInvite, setDecidingInvite] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const eligibleSpaces = spaces.filter((s) => s.clickable && (s.status === undefined || s.status === "actif"));
  const invitedSpaces = spaces.filter((s) => s.kind === "organization" && s.status === "invitation");
  const suspendedSpaces = spaces.filter((s) => s.kind === "organization" && s.status === "suspendu");
  // Reste du panneau "sélecteur" existant : les espaces qui ne sont ni éligibles, ni une
  // invitation, ni une suspension — un type d'organisation pas encore construit côté Club+
  // (ex. event_kind hors périmètre), comportement "Bientôt disponible" inchangé.
  const notYetAvailableSpaces = spaces.filter(
    (s) => !eligibleSpaces.includes(s) && !invitedSpaces.includes(s) && !suspendedSpaces.includes(s),
  );
  const hasChoice = eligibleSpaces.length > 0;

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  async function handleActivate(space: Space) {
    if (activating) return;
    setActivating(`${space.kind}:${space.id}`);
    try {
      await switchActiveSpace(space);
      router.refresh();
    } catch (e) {
      console.error("switchActiveSpace failed", e);
      setActivating(null);
    }
  }

  async function handleAccept(space: Space) {
    if (decidingInvite) return;
    setInviteError(null);
    setDecidingInvite(`${space.kind}:${space.id}`);
    try {
      const supabase = createClient();
      await acceptClubInvitation(supabase, space.id);
      router.refresh();
    } catch (e) {
      console.error("acceptClubInvitation failed", e);
      setInviteError("Impossible d'accepter cette invitation. Réessayez ou contactez SportVision.");
      setDecidingInvite(null);
    }
  }

  async function handleDecline(space: Space) {
    if (decidingInvite) return;
    setInviteError(null);
    setDecidingInvite(`${space.kind}:${space.id}`);
    try {
      const supabase = createClient();
      await declineClubInvitation(supabase, space.id);
      router.refresh();
    } catch (e) {
      console.error("declineClubInvitation failed", e);
      setInviteError("Impossible de refuser cette invitation. Réessayez ou contactez SportVision.");
      setDecidingInvite(null);
    }
  }

  const showGenericEmptyState = spaces.length === 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-alt p-8">
      <div className="w-full max-w-[480px]">
        <div className="flex items-center gap-3">
          <span className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[15px] font-extrabold text-white">
            SV
          </span>
          <span className="text-[17px] font-extrabold tracking-tight">
            SportVision<span className="font-medium text-brand-blue-pale"> Club+</span>
          </span>
        </div>

        {showGenericEmptyState && (
          <>
            <h1 className="mt-7 text-[22px] font-extrabold tracking-tight">Aucun espace disponible</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-text-soft">
              Votre compte n&apos;est rattaché à aucun espace pour le moment. Contactez votre interlocuteur SportVision.
            </p>
          </>
        )}

        {invitedSpaces.length > 0 && (
          <div className="mt-7 flex flex-col gap-3">
            {invitedSpaces.length === 1 ? (
              <h1 className="text-[22px] font-extrabold tracking-tight">Vous avez été invité(e)</h1>
            ) : (
              <h1 className="text-[22px] font-extrabold tracking-tight">Vous avez {invitedSpaces.length} invitations</h1>
            )}
            {inviteError && (
              <p className="rounded-xl border border-[#FDA29B] bg-danger-bg px-3.5 py-2.5 text-[13px] font-semibold text-danger-fg">
                {inviteError}
              </p>
            )}
            {invitedSpaces.map((space) => {
              const key = `${space.kind}:${space.id}`;
              const deciding = decidingInvite === key;
              return (
                <Card key={key} className="p-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[12px] font-extrabold text-white">
                      {initials(space.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-bold leading-snug">
                        <strong className="text-text">{space.name}</strong> vous invite à rejoindre Club+
                      </p>
                      <p className="mt-0.5 text-[12px] text-text-soft">
                        {space.role ? (ROLE_LABELS[space.role] ?? space.role) : space.subtitle}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3.5 flex gap-2.5">
                    <Button
                      className="h-9 flex-1 gap-1.5 text-[13px]"
                      disabled={deciding}
                      onClick={() => handleAccept(space)}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      {deciding ? "Un instant…" : "Accepter"}
                    </Button>
                    <Button
                      variant="secondary"
                      className="h-9 flex-1 gap-1.5 text-[13px]"
                      disabled={deciding}
                      onClick={() => handleDecline(space)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      Refuser
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {suspendedSpaces.length > 0 && (
          <div className="mt-7 flex flex-col gap-3">
            <h1 className="text-[22px] font-extrabold tracking-tight">
              {suspendedSpaces.length === 1 ? "Accès suspendu" : "Accès suspendus"}
            </h1>
            {suspendedSpaces.map((space) => (
              <Card key={`${space.kind}:${space.id}`} className="p-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-[#8B93A6] to-[#5E6779] text-[12px] font-extrabold text-white opacity-70">
                    {initials(space.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-text">{space.name}</p>
                    <p className="mt-0.5 text-[12px] text-text-soft">
                      Votre accès à cette structure n&apos;est plus actif. Contactez votre interlocuteur SportVision.
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {hasChoice && (
          <>
            <h1 className="mt-7 text-[22px] font-extrabold tracking-tight">Choisissez un espace</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-text-soft">
              Plusieurs espaces sont disponibles sur votre compte. Sélectionnez celui que vous voulez ouvrir.
            </p>
          </>
        )}

        {(hasChoice || notYetAvailableSpaces.length > 0) && (
          <Card className="mt-6 p-2">
            {eligibleSpaces.map((space) => {
              const key = `${space.kind}:${space.id}`;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={activating !== null}
                  onClick={() => handleActivate(space)}
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left transition-colors hover:bg-surface-sunken disabled:cursor-wait"
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[11px] font-extrabold text-white">
                    {initials(space.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{space.name}</span>
                    <span className="block truncate text-[11px] text-text-soft">{space.subtitle}</span>
                  </span>
                  {activating === key ? (
                    <span className="flex-none text-[11px] font-bold text-text-soft">Ouverture…</span>
                  ) : (
                    <ChevronRight className="h-4 w-4 flex-none text-text-faint" aria-hidden />
                  )}
                </button>
              );
            })}
            {notYetAvailableSpaces.map((space) => {
              const key = `${space.kind}:${space.id}`;
              return (
                <div key={key} className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 opacity-60">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[11px] font-extrabold text-white">
                    {initials(space.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{space.name}</span>
                    <span className="block truncate text-[11px] text-text-soft">{space.subtitle}</span>
                  </span>
                  <span className="flex-none rounded-full bg-surface-sunken px-2.5 py-1 text-[10.5px] font-bold text-text-soft">
                    Pas encore disponible
                  </span>
                </div>
              );
            })}
          </Card>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <Button variant="secondary" onClick={handleLogout}>
            Se déconnecter
          </Button>
        </div>
      </div>
    </div>
  );
}
