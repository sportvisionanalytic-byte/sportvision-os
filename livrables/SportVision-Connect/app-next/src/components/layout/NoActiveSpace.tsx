"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { switchActiveSpace } from "@/lib/supabase/actions";
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
export function NoActiveSpace({ spaces }: { spaces: Space[] }) {
  const router = useRouter();
  const [activating, setActivating] = useState<string | null>(null);
  const clickableSpaces = spaces.filter((s) => s.clickable);
  const hasChoice = clickableSpaces.length > 0;

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  async function handleActivate(space: Space) {
    if (!space.clickable || activating) return;
    setActivating(`${space.kind}:${space.id}`);
    try {
      await switchActiveSpace(space);
      router.refresh();
    } catch (e) {
      console.error("switchActiveSpace failed", e);
      setActivating(null);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-alt p-8">
      <div className="w-full max-w-[480px]">
        <div className="flex items-center gap-3">
          <span className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[15px] font-extrabold text-white">
            SV
          </span>
          <span className="text-[17px] font-extrabold tracking-tight">
            SportVision<span className="font-medium text-brand-blue-pale"> Connect</span>
          </span>
        </div>

        <h1 className="mt-7 text-[22px] font-extrabold tracking-tight">
          {spaces.length === 0 ? "Aucun espace disponible" : hasChoice ? "Choisissez un espace" : "Espace pas encore disponible"}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-text-soft">
          {spaces.length === 0
            ? "Votre compte n'est rattaché à aucun espace pour le moment. Contactez votre interlocuteur SportVision."
            : hasChoice
              ? "Plusieurs espaces sont disponibles sur votre compte. Sélectionnez celui que vous voulez ouvrir."
              : "Cet espace n'est pas encore disponible sur SportVision Club+. Contactez votre interlocuteur SportVision."}
        </p>

        {spaces.length > 0 && (
          <Card className="mt-6 p-2">
            {spaces.map((space) => {
              const key = `${space.kind}:${space.id}`;
              if (!space.clickable) {
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
              }
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
