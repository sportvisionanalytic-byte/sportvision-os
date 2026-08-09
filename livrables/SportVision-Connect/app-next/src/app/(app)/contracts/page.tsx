"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FileText } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, formatMonthlyAmount } from "@/components/contracts/format";
import { createClient } from "@/lib/supabase/client";
import { fetchClientContracts, type ClientContract } from "@/lib/data/projet/billing";
import { resolveClubPortailClientId } from "@/lib/data/club/portail-link";

// Écran Contrats — lecture seule (voir ACTIONS.md § 18 pour l'intention d'origine ; la
// bannière premium avec engagement/préavis/renouvellement a été retirée le 09/08 : ces trois
// valeurs n'ont jamais de colonne réelle dans `contrats`, seuls le statut, les dates et le
// montant mensuel le sont — voir fetchClientContracts, src/lib/data/projet/billing.ts).
export default function ContractsPage() {
  const { ctx } = useSession();

  if (ctx.organization.type === "generic") return <ContractsView clientId={ctx.organization.id} />;
  if (ctx.organization.type === "club") return <ClubContractsView />;

  return <LockedModule />;
}

function ClubContractsView() {
  const { ctx } = useSession();
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = createClient();
    resolveClubPortailClientId(supabase, ctx.organization.id).then(setClientId);
  }, [ctx.organization.id]);

  if (clientId === undefined) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  if (clientId === null) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <FileText className="h-6 w-6 text-text-faint" aria-hidden />
        <div className="max-w-md">
          <h2 className="text-[18px] font-extrabold tracking-tight">Contrats pas encore reliés</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
            SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Contrats. Contactez votre
            interlocuteur SportVision pour l&apos;activer.
          </p>
        </div>
      </Card>
    );
  }

  return <ContractsView clientId={clientId} />;
}

function ContractsView({ clientId }: { clientId: string }) {
  const { ctx } = useSession();
  const [contracts, setContracts] = useState<ClientContract[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function reload() {
    setLoadError(false);
    setContracts(null);
    try {
      const supabase = createClient();
      setContracts(await fetchClientContracts(supabase, clientId));
    } catch {
      setLoadError(true);
      setContracts([]);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[12px] font-bold text-text-soft">Contrats</div>
        <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
          Contrats de {ctx.organization.name}
        </h1>
      </div>

      {loadError && (
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">
            Impossible de charger vos contrats.
          </span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      )}

      {contracts === null ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="text-[13.5px] font-bold text-text-soft">Chargement…</div>
        </Card>
      ) : contracts.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <FileText className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="mt-1 text-[15px] font-extrabold">Aucun contrat pour le moment.</div>
        </Card>
      ) : (
        <Card>
          {contracts.map((c) => (
            <div key={c.id} className="flex flex-col gap-1.5 border-b border-divider px-5 py-3.5 last:border-0">
              <div className="flex flex-wrap items-center gap-3.5">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-text">{c.name}</span>
                {c.monthlyAmount !== null && c.monthlyAmount !== undefined && (
                  <span className="text-[12.5px] font-bold text-text-soft">{formatMonthlyAmount(c.monthlyAmount)}</span>
                )}
                <Badge tone={CONTRACT_STATUS_TONE[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Badge>
              </div>
              <div className="text-[12px] text-text-soft">
                Du {c.startsAt}
                {c.endsAt ? ` au ${c.endsAt}` : ""}
              </div>
              {c.awaitingSignature && (
                <p className="text-[12px] text-text-soft">
                  Signature demandée — vous avez reçu un e-mail de notre partenaire de signature électronique
                  (Youtrust) avec un lien pour signer. Vérifiez votre boîte mail, y compris les spams.
                </p>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
