"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Inbox } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { createClient } from "@/lib/supabase/client";
import { fetchContenuById, type Contenu } from "@/lib/data/shared/contenus";
import { fetchContenuStatsByIds, type ContenuStat } from "@/lib/data/shared/contenu-stats";
import { CONTENU_STATUT_LABEL, CONTENU_STATUT_TONE } from "@/components/communication/contenuStatusTone";

// /communication/publications/[id] — fiche détail d'un contenu réel (table `contenus`).
//
// 31/08/2026 (audit Communication & Contenu) — reconstruite de zéro. La version précédente lisait
// intégralement lib/mock/communication.ts (getPublicationById/getCommentsForPublication/
// getHistoryForPublication) et ne savait donc résoudre AUCUN id `contenus` réel : /analytics et
// FullCommunicationDashboard le documentaient déjà et avaient délibérément choisi de ne PAS
// pointer vers cette route pour ne pas produire un faux lien "introuvable" (voir leurs
// commentaires, laissés tels quels, désormais obsolètes — cette route fonctionne). Route
// entièrement injoignable jusqu'ici (aucun lien nulle part dans l'app), donc aucun risque de
// régression fonctionnelle à la reconstruire ; le vrai risque était qu'un lien direct (favori,
// partagé) affiche des données 100% fictives en se faisant passer pour réelles.
//
// Volontairement SANS commentaires/historique : aucune table réelle ne trace un fil de discussion
// ni un historique de transitions par contenu (contenus_transitions n'existe pas ; messages_client
// est un fil plat sans lien vers un contenu précis, voir data/shared/community-manager.ts). Plutôt
// que d'inventer cette UI comme le faisait le mock, la fiche affiche uniquement les colonnes
// réelles de `contenus` (+ contenu_stats si publié). La décision valider/corrections
// (a_valider_client) N'EST PAS dupliquée ici : c'est l'écran /validations (RPC
// client_valider_contenu) qui la porte déjà — cette fiche y renvoie plutôt que de réimplémenter la
// même écriture deux fois.
export default function PublicationDetailPage({ params }: { params: { id: string } }) {
  const resolution = useClientId();

  if (resolution.status === "locked") return <LockedModule />;
  if (resolution.status === "loading") return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;

  if (resolution.status === "not_linked") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[29px] font-extrabold tracking-tight">Publication</h1>
        <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
          <Inbox className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="max-w-md">
            <h2 className="text-[18px] font-extrabold tracking-tight">Communication pas encore reliée</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
              Contactez votre interlocuteur SportVision pour l&apos;activer.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return <PublicationDetail clientId={resolution.clientId} id={params.id} />;
}

function PublicationDetail({ clientId, id }: { clientId: string; id: string }) {
  const { ctx } = useSession();
  const router = useRouter();
  const [contenu, setContenu] = useState<Contenu | null | undefined>(undefined);
  const [stat, setStat] = useState<ContenuStat | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function reload() {
    setLoadError(false);
    setContenu(undefined);
    try {
      const supabase = createClient();
      const c = await fetchContenuById(supabase, clientId, id);
      setContenu(c);
      if (c && c.statut === "publie") {
        const statsById = await fetchContenuStatsByIds(supabase, [c.id]);
        setStat(statsById.get(c.id) ?? null);
      } else {
        setStat(null);
      }
    } catch {
      setLoadError(true);
      setContenu(null);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, id]);

  if (loadError) {
    return (
      <div className="flex flex-col gap-5">
        <BackLink />
        <Card className="flex flex-wrap items-center gap-3 border-danger-fg/30 bg-danger-bg px-5 py-4">
          <AlertTriangle className="h-[18px] w-[18px] flex-none text-danger-fg" aria-hidden />
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-danger-fg">Impossible de charger ce contenu.</span>
          <Button variant="secondary" className="h-8 flex-none px-3 text-[12px]" onClick={reload}>
            Réessayer
          </Button>
        </Card>
      </div>
    );
  }

  if (contenu === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <BackLink />
        <Card className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <div className="text-[13.5px] font-bold text-text-soft">Chargement…</div>
        </Card>
      </div>
    );
  }

  if (contenu === null) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-[15px] font-bold text-text-soft">Ce contenu est introuvable.</p>
        <Button variant="secondary" onClick={() => router.push("/communication")}>
          Retour au planning
        </Button>
      </div>
    );
  }

  const infoItems: { label: string; value: string }[] = [
    { label: "Plateforme", value: contenu.plateforme ?? "Non renseigné" },
    { label: "Type de contenu", value: contenu.typeContenu ?? "Non renseigné" },
    { label: "Date prévue", value: contenu.datePrevue ?? "Non renseigné" },
    { label: "Date de publication", value: contenu.datePublication ?? "Non renseigné" },
    { label: "Sponsor associé", value: contenu.sponsor ?? "Aucun" },
    { label: "Créé le", value: formatDateTime(contenu.createdAt) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-text-soft">{ctx.organization.name}</span>
            <Badge tone={CONTENU_STATUT_TONE[contenu.statut]}>{CONTENU_STATUT_LABEL[contenu.statut]}</Badge>
          </div>
          <h1 className="mt-1.5 text-[24px] font-extrabold tracking-tight">{contenu.titre}</h1>
        </div>
        {contenu.statut === "a_valider_client" && (
          <Link href="/validations">
            <Button variant="primary">Aller à la validation</Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Description</div>
            <p className="mt-2 text-[14px] leading-relaxed text-text">{contenu.description || "Aucune description renseignée pour ce contenu."}</p>
          </Card>

          {contenu.statut === "publie" && (
            <Card className="p-5">
              <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Statistiques</div>
              <p className="mt-1 text-[11.5px] text-text-faint">
                Saisies manuellement par votre Community Manager, jamais une synchronisation automatique.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <StatTile label="Portée" value={stat?.portee ?? null} />
                <StatTile label="Interactions" value={stat?.engagement ?? null} />
                <StatTile label="Vues" value={stat?.vues ?? null} />
              </div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="text-[13px] font-extrabold uppercase tracking-[.06em] text-text-faint">Informations</div>
            <dl className="mt-3 flex flex-col gap-2.5">
              {infoItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 border-b border-divider pb-2.5 last:border-0 last:pb-0">
                  <dt className="text-[12.5px] font-semibold text-text-soft">{item.label}</dt>
                  <dd className="text-[12.5px] font-bold text-text">{item.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-border bg-surface-alt p-3 text-center">
      <div className="text-[18px] font-extrabold text-text">{value != null ? value.toLocaleString("fr-FR") : "—"}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-text-soft">{label}</div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/communication" className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-text-soft hover:text-text">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      Retour au planning
    </Link>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
