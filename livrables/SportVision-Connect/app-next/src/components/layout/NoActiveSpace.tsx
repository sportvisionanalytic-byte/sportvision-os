"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import type { Space } from "@/lib/supabase/session";

const VANILLA_APP_URL = "https://connectsportvisionfr.netlify.app";

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

// Affiché à la place de la coque applicative quand aucun espace club n'est disponible pour
// l'utilisateur connecté — soit il n'a que des espaces non-club/personnels (bascule progressive,
// voir le plan Phase 1 § Décisions d'architecture n°3), soit aucun espace du tout.
export function NoActiveSpace({ spaces }: { spaces: Space[] }) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
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
          {spaces.length === 0 ? "Aucun espace disponible" : "Vos espaces arrivent bientôt ici"}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-text-soft">
          {spaces.length === 0
            ? "Votre compte n'est rattaché à aucun espace pour le moment. Contactez votre interlocuteur SportVision."
            : "La nouvelle plateforme est déployée espace par espace. Vos espaces ci-dessous restent accessibles sur l'application actuelle en attendant leur tour."}
        </p>

        {spaces.length > 0 && (
          <Card className="mt-6 p-2">
            {spaces.map((space) => (
              <div
                key={`${space.kind}:${space.id}`}
                className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 opacity-60"
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[11px] font-extrabold text-white">
                  {initials(space.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{space.name}</span>
                  <span className="block truncate text-[11px] text-text-soft">{space.subtitle}</span>
                </span>
                <span className="flex-none rounded-full bg-surface-sunken px-2.5 py-1 text-[10.5px] font-bold text-text-soft">
                  Bientôt disponible
                </span>
              </div>
            ))}
          </Card>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <a href={VANILLA_APP_URL} target="_blank" rel="noreferrer">
            <Button variant="primary">Continuer sur l&apos;application actuelle</Button>
          </a>
          <Button variant="secondary" onClick={handleLogout}>
            Se déconnecter
          </Button>
        </div>
      </div>
    </div>
  );
}
