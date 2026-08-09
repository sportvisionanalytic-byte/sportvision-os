"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { fetchConfirmedChildren, type ConfirmedChild } from "@/lib/data/family/children";
import {
  AUTHORIZATION_STATUS_LABELS,
  AUTHORIZATION_STATUS_TONE,
  fetchChildAuthorizations,
  isSignable,
  isWithdrawable,
  signChildAuthorization,
  withdrawChildAuthorization,
  type ChildAuthorization,
} from "@/lib/data/family/authorizations";
import { fetchPlayerAuthorizations } from "@/lib/data/player/authorizations";
import { createClient } from "@/lib/supabase/client";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Toast, useToast } from "@/components/feedback/Toast";

// /authorizations — remodelé sur le vrai schéma (authorization_types × parental_authorizations,
// voir le plan Phase 2 § Décisions d'architecture n°5) : 12 types réels, 10 statuts, plus les 5
// interrupteurs booléens du mock. Écriture réservée au parent confirmé (RPC
// submit_parental_authorization/withdraw_parental_authorization) — côté joueur, lecture seule
// (voir data/player/authorizations.ts).
export default function AuthorizationsPage() {
  const { ctx } = useSession();
  const { toastMessage, toastTone, showToast } = useToast();
  const isParent = ctx.organization.type === "parent";

  const [children, setChildren] = useState<ConfirmedChild[]>([]);
  const [authsByChild, setAuthsByChild] = useState<Record<string, ChildAuthorization[]>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    const supabase = createClient();
    if (isParent) {
      const rows = await fetchConfirmedChildren(supabase, ctx.organization.id);
      setChildren(rows);
      const entries = await Promise.all(
        rows.map(async (child) => [child.playerId, await fetchChildAuthorizations(supabase, child.playerId)] as const),
      );
      setAuthsByChild(Object.fromEntries(entries));
    } else {
      const rows = await fetchPlayerAuthorizations(supabase, ctx.organization.id);
      setAuthsByChild({ [ctx.organization.id]: rows });
    }
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.organization.id, isParent]);

  if (!canAccess(ctx, "authorizations")) return <LockedModule />;

  if (loading) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  async function handleSign(authorizationId: string) {
    setBusyId(authorizationId);
    try {
      const supabase = createClient();
      await signChildAuthorization(supabase, authorizationId);
      await reload();
    } catch {
      showToast("Signature impossible, réessayez.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleWithdraw(authorizationId: string) {
    setBusyId(authorizationId);
    try {
      const supabase = createClient();
      await withdrawChildAuthorization(supabase, authorizationId);
      await reload();
    } catch {
      showToast("Retrait impossible, réessayez.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Autorisations</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] text-text-soft">
          {isParent
            ? "Droit à l'image et autres autorisations de vos enfants. Chaque autorisation peut être signée ou retirée indépendamment."
            : "Statut de vos autorisations. Seul un parent confirmé (ou votre club) peut les signer ou les retirer."}
        </p>
      </div>

      {isParent && children.length === 0 && (
        <Card className="p-8 text-center text-[13.5px] text-text-soft">Aucun enfant associé à votre espace.</Card>
      )}

      {isParent
        ? children.map((child) => (
            <Card key={child.playerId} className="p-5">
              <div className="border-b border-divider pb-4">
                <div className="text-[15px] font-extrabold tracking-tight">
                  {child.firstName} {child.lastName}
                </div>
                <div className="text-[12px] text-text-soft">
                  {child.teamName ?? "Équipe non renseignée"} · {child.clubName ?? "—"}
                </div>
              </div>
              <AuthorizationRows
                items={authsByChild[child.playerId] ?? []}
                canManage
                onSign={handleSign}
                onWithdraw={handleWithdraw}
                busyId={busyId}
              />
            </Card>
          ))
        : (
            <Card className="p-5">
              <AuthorizationRows items={authsByChild[ctx.organization.id] ?? []} canManage={false} />
            </Card>
          )}

      <Card className="p-5 text-[12.5px] leading-relaxed text-text-soft">
        <span className="font-bold text-text">RGPD</span> — le retrait d&apos;une autorisation entraîne le retrait
        des contenus déjà publiés sous 72 heures.
      </Card>

      <Toast message={toastMessage} tone={toastTone} />
    </div>
  );
}

function AuthorizationRows({
  items,
  canManage,
  onSign,
  onWithdraw,
  busyId,
}: {
  items: ChildAuthorization[];
  canManage: boolean;
  onSign?: (id: string) => void;
  onWithdraw?: (id: string) => void;
  busyId?: string | null;
}) {
  if (items.length === 0) {
    return <p className="pt-4 text-[13px] text-text-soft">Aucune autorisation enregistrée pour le moment.</p>;
  }
  return (
    <div className="mt-4 flex flex-col gap-2.5">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-text">{item.label}</span>
              {item.obligatoire && <ShieldCheck className="h-3.5 w-3.5 text-text-faint" aria-hidden />}
            </div>
            {item.description && <p className="mt-0.5 text-[11.5px] text-text-soft">{item.description}</p>}
          </div>
          <Badge tone={AUTHORIZATION_STATUS_TONE[item.statut] ?? "neutral"}>
            {AUTHORIZATION_STATUS_LABELS[item.statut] ?? item.statut}
          </Badge>
          {canManage && isSignable(item.statut) && (
            <Button
              variant="secondary"
              className="h-8 flex-none px-3 text-[12px]"
              disabled={busyId === item.id}
              loading={busyId === item.id}
              onClick={() => onSign?.(item.id)}
            >
              Signer
            </Button>
          )}
          {canManage && isWithdrawable(item.statut) && (
            <Button
              variant="secondary"
              className="h-8 flex-none px-3 text-[12px]"
              disabled={busyId === item.id}
              loading={busyId === item.id}
              onClick={() => onWithdraw?.(item.id)}
            >
              Retirer
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
