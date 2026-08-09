"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock3 } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { fetchConfirmedChildren, type ConfirmedChild } from "@/lib/data/family/children";
import { fetchChildAuthorizations, isWithdrawable } from "@/lib/data/family/authorizations";
import { createClient } from "@/lib/supabase/client";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

// /children — profils associés du parent, une carte par enfant. ACTIONS.md § 20 « Parent —
// Profils associés ». Bandeau d'alerte si le droit à l'image manque ; « Réserver une prestation »
// n'apparaît que si l'autorisation est signée (voir data/family/authorizations.ts).

// Trois états réels d'une autorisation "droit_image", pas deux : une autorisation signée passe
// par `a_verifier` (submit_parental_authorization, migration-clubplus-v15.sql ~430) avant
// `valide` — la traiter comme "manquante" pendant cette période affiche une fausse alerte et un
// bouton "Régulariser" qui renvoie vers un écran qui ne propose rien à refaire (bug corrigé
// 09/08). "checking" tant que le statut réel n'est pas encore chargé (évite l'alerte prématurée
// affichée avant d'avoir la vraie réponse).
type AuthCategory = "checking" | "missing" | "pending" | "valid";

function categorizeAuth(statut: string | undefined, authLoading: boolean): AuthCategory {
  if (authLoading) return "checking";
  if (statut === "valide") return "valid";
  if (statut && isWithdrawable(statut)) return "pending";
  return "missing";
}

export default function ChildrenPage() {
  const { ctx } = useSession();
  const router = useRouter();
  const [children, setChildren] = useState<ConfirmedChild[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Statut réel de l'autorisation "droit_image" par enfant — vide tant que non chargé, voir
  // authLoading pour distinguer "pas encore chargé" de "chargé, aucune autorisation".
  const [imageRightByChild, setImageRightByChild] = useState<Record<string, string>>({});
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    setLoadError(false);
    setAuthLoading(true);
    fetchConfirmedChildren(supabase, ctx.organization.id)
      .then((rows) => {
        if (cancelled) return;
        setChildren(rows);
        return Promise.all(
          rows.map(async (child) => {
            const auths = await fetchChildAuthorizations(supabase, child.playerId);
            const droitImage = auths.find((a) => a.code === "droit_image");
            return [child.playerId, droitImage?.statut ?? "non_transmise"] as const;
          }),
        ).then((entries) => {
          if (cancelled) return;
          setImageRightByChild(Object.fromEntries(entries));
          setAuthLoading(false);
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
          setAuthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id]);

  if (!canAccess(ctx, "children")) return <LockedModule />;

  if (loadError) {
    return (
      <Card className="p-8 text-center text-[13.5px] font-semibold text-danger-fg">
        Impossible de charger vos profils associés. Réessayez plus tard.
      </Card>
    );
  }

  if (children === null) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  const categories = new Map(children.map((c) => [c.playerId, categorizeAuth(imageRightByChild[c.playerId], authLoading)]));
  const missingCount = children.filter((c) => categories.get(c.playerId) === "missing").length;
  const pendingCount = children.filter((c) => categories.get(c.playerId) === "pending").length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Profils associés</h1>
        <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
          Retrouvez vos enfants, leurs contenus et le statut de leur droit à l&apos;image.
        </p>
      </div>

      {missingCount > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-warning-fg/20 bg-warning-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-warning-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-warning-fg">
            Une autorisation manque pour au moins un enfant. Ses contenus ne sont pas publiables tant qu&apos;elle
            n&apos;est pas signée.
          </span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={() => router.push("/authorizations")}>
            Voir les autorisations
          </Button>
        </Card>
      )}

      {missingCount === 0 && pendingCount > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-brand-blue-pale/40 bg-info-bg px-5 py-4">
          <Clock3 className="h-[18px] w-[18px] flex-none text-info-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-info-fg">
            Une autorisation signée est en cours de vérification par notre équipe pour au moins un enfant. Ses
            contenus seront publiables dès validation.
          </span>
        </Card>
      )}

      {children.length === 0 && (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">
          Aucun enfant associé à votre espace pour le moment.
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {children.map((child) => {
          const category = categories.get(child.playerId) ?? "checking";
          const initials = `${child.firstName[0] ?? ""}${child.lastName[0] ?? ""}`.toUpperCase();
          return (
            <Card key={child.playerId} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[13px] font-extrabold text-white">
                    {initials}
                  </span>
                  <div>
                    <div className="text-[15px] font-extrabold tracking-tight">
                      {child.firstName} {child.lastName}
                    </div>
                    <div className="text-[12.5px] text-text-soft">
                      {child.teamName ?? "Équipe non renseignée"} · {child.clubName ?? "—"}
                    </div>
                  </div>
                </div>
                <Badge
                  tone={
                    category === "valid" ? "success" : category === "pending" ? "info" : category === "checking" ? "neutral" : "warning"
                  }
                >
                  {category === "valid"
                    ? "Autorisation signée"
                    : category === "pending"
                      ? "Vérification en cours"
                      : category === "checking"
                        ? "Vérification…"
                        : "Autorisation manquante"}
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-divider pt-4 text-[12.5px]">
                <InfoRow label="Numéro" value={child.numeroMaillot ?? "—"} />
                <InfoRow label="Licence" value={child.numeroLicence ?? "—"} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {category === "valid" && (
                  <Button
                    variant="dark"
                    className="h-9 flex-1 px-3 text-[12.5px]"
                    onClick={() => router.push("/services/new")}
                  >
                    Réserver une prestation
                  </Button>
                )}
                {category === "missing" && (
                  <Button
                    variant="dark"
                    className="h-9 flex-1 px-3 text-[12.5px]"
                    onClick={() => router.push("/authorizations")}
                  >
                    Régulariser l&apos;autorisation
                  </Button>
                )}
                {category === "pending" && (
                  <p className="flex-1 text-[12.5px] text-text-soft">
                    Signée, en cours de vérification par notre équipe.
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] font-bold uppercase tracking-[.04em] text-text-faint">{label}</div>
      <div className="mt-0.5 font-semibold text-text">{value}</div>
    </div>
  );
}
