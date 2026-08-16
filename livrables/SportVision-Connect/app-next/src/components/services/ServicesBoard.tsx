"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, List, Sparkles } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { getServicesForOrganization } from "@/lib/mock/services";
import { fetchClientServices } from "@/lib/data/projet/services";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/supabase/realtime";
import type { Service } from "@/lib/types/services";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { cn } from "@/lib/cn";
import { KanbanBoard } from "./KanbanBoard";
import { ServicesListTable } from "./ServicesListTable";

type ViewMode = "kanban" | "list";

// Écran /services — voir ACTIONS.md § 12. Une seule action principale : demander une
// prestation. Le kanban et la liste partagent le même jeu de données filtré par organisation
// active (rechargé au changement d'organisation, voir README.md § Les treize expériences).
//
// Espace Projet (client_prestations, réel) vs autres types d'organisation (encore mock, voir le
// plan Phase 1/3 — /services reste verrouillé pour le club faute de prix/statuts fiables côté
// club_bookings). Voir data/projet/services.ts pour le détail du branchement.
export function ServicesBoard() {
  const { ctx } = useSession();
  const [view, setView] = useState<ViewMode>("kanban");
  const isProjet = ctx.organization.type === "generic";
  const [realServices, setRealServices] = useState<Service[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const loadServices = useCallback(() => {
    if (!isProjet) return;
    setLoadError(false);
    const supabase = createClient();
    fetchClientServices(supabase, ctx.organization.id)
      .then(setRealServices)
      .catch(() => setLoadError(true));
  }, [isProjet, ctx.organization.id]);

  useEffect(() => loadServices(), [loadServices]);

  // Sync temps réel (migration-connect-v42-enable-realtime-sync.sql) : `prestations` change
  // dès que le staff avance une demande (devis envoyé, contrat à signer, planifiée…) — même
  // colonne de scoping que fetchClientServices (client_prestations filtre déjà sur
  // client_users.client_id, ici organization.id EST le client_id pour l'Espace Projet, voir
  // use-client-id.ts). Rejoue le même fetch existant, ne duplique aucune logique de requête.
  // Dégrade silencieusement tant que la migration v42 n'a pas été exécutée (voir realtime.ts).
  //
  // ATTENTION (constaté le 11/08/2026, non corrigé ici) : contrairement à club_bookings/
  // messages_client/contenus/member_notifications, `prestations` n'a AUCUNE policy RLS select
  // pour un rôle client — seule la vue client_prestations (créée avec les droits de son
  // propriétaire) lit la table pour un client, jamais prestations elle-même (voir le commentaire
  // de fetchClientServices/submitClientService dans data/projet/services.ts : un select direct
  // sur `prestations` échoue en 42501 pour un client). Supabase Realtime applique les policies
  // RLS de la TABLE SOURCE (jamais d'une vue) avec le rôle du client abonné : ce canal restera
  // donc probablement muet indéfiniment pour l'Espace Projet, même une fois la migration v42
  // exécutée, tant qu'aucune policy select client n'existe sur `prestations`. Ajouter une telle
  // policy n'est PAS anodin : Realtime diffuse la ligne complète (tous les champs, y compris
  // notes_internes/responsable_prod_id/responsable_prestation_id, volontairement absents de la
  // vue) — une simple policy scoping par client_id réglerait la visibilité par ligne mais pas
  // l'exposition de ces colonnes internes. Nécessite une vraie décision produit/sécurité avant
  // toute migration corrective ; le code ci-dessous reste branché et sans risque en l'état
  // (aucun événement ne peut fuiter tant qu'aucune policy select n'existe).
  useEffect(() => {
    if (!isProjet) return;
    const supabase = createClient();
    const channel = subscribeTable(
      supabase,
      `services-prestations-${ctx.organization.id}`,
      "prestations",
      `client_id=eq.${ctx.organization.id}`,
      () => {
        fetchClientServices(supabase, ctx.organization.id)
          .then(setRealServices)
          .catch(() => setLoadError(true));
      },
    );
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isProjet, ctx.organization.id]);

  const services = useMemo(
    () => (isProjet ? (realServices ?? []) : getServicesForOrganization(ctx.organization.id)),
    [isProjet, realServices, ctx.organization.id],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold text-text-soft">{ctx.organization.name}</div>
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">Prestations</h1>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex rounded-[11px] border border-border-strong bg-input-bg p-0.5">
            <ViewToggleButton active={view === "kanban"} onClick={() => setView("kanban")} label="Vue kanban">
              <LayoutGrid className="h-4 w-4" aria-hidden />
            </ViewToggleButton>
            <ViewToggleButton active={view === "list"} onClick={() => setView("list")} label="Vue liste">
              <List className="h-4 w-4" aria-hidden />
            </ViewToggleButton>
          </div>
          <Link href="/services/new">
            <Button variant="primary">Demander une prestation</Button>
          </Link>
        </div>
      </div>

      {isProjet && loadError ? (
        <Card>
          <ErrorState message="Impossible de charger vos prestations." onRetry={loadServices} />
        </Card>
      ) : isProjet && realServices === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} className="h-[120px]" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="Vous n'avez encore créé aucune prestation"
            description="Commencez par demander votre première prestation : match, entraînement, événement de club ou tout autre besoin de captation."
          >
            <Link href="/services/new">
              <Button variant="primary">Demander une prestation</Button>
            </Link>
          </EmptyState>
        </Card>
      ) : view === "kanban" ? (
        <KanbanBoard services={services} />
      ) : (
        <ServicesListTable services={services} />
      )}
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 w-9 items-center justify-center rounded-[9px] transition-colors duration-sv",
        active ? "bg-elevated text-text shadow-sv-card" : "text-text-faint hover:text-text-soft",
      )}
    >
      {children}
    </button>
  );
}
