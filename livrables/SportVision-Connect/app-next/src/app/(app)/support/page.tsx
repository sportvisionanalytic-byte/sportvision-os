"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LifeBuoy, PlayCircle, Search } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { mockSupportTopics } from "@/lib/mock/settings";
import type { SupportTicket, SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from "@/lib/types/settings";
import { fetchClubSupportTickets, createClubSupportTicket } from "@/lib/data/club/support";
import { createClient } from "@/lib/supabase/client";
import { resetOnboardingProgress } from "@/components/onboarding/onboarding-storage";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { NewTicketModal, type NewTicketInitialContext } from "@/components/support/NewTicketModal";

const CONTEXT_TYPES = new Set<NewTicketInitialContext["type"]>(["request", "invoice", "album", "visual"]);

/**
 * Contexte repris depuis une autre page — Bible §21 "Contexte automatiquement repris : référence
 * demande, facture, album ou visuel". Passé par query string (ctx_type/ctx_id/ctx_label) plutôt
 * que par état partagé entre pages, pour qu'un lien "Contacter le support" depuis
 * billing/page.tsx ou content/[id] (voir ces fichiers) reste un simple <Link>, sans dépendre d'un
 * contexte React global. Voir aussi useSearchParams ci-dessous.
 */
function readInitialContext(params: URLSearchParams): NewTicketInitialContext | undefined {
  const type = params.get("ctx_type");
  const id = params.get("ctx_id");
  const label = params.get("ctx_label");
  if (!type || !id || !label || !CONTEXT_TYPES.has(type as NewTicketInitialContext["type"])) return undefined;
  return { type: type as NewTicketInitialContext["type"], id, label };
}

// /support — voir ACTIONS.md § 24. Recherche, cartes de sujet, Nouveau ticket, Revoir le
// tutoriel de bienvenue, Le contacter (chargé de compte), indicateur d'état des services. Pour un
// client ponctuel (organisation « événement »), la relation avec SportVision passe surtout par un
// fil de messages plutôt qu'une file de tickets : on l'affiche directement sur cet écran plutôt
// que de le faire chercher dans une messagerie séparée.

const STATUS_LABEL: Record<SupportTicketStatus, { label: string; tone: "info" | "warning" | "success" | "neutral" }> = {
  open: { label: "Ouvert", tone: "info" },
  in_progress: { label: "En cours", tone: "warning" },
  waiting_client: { label: "En attente du client", tone: "warning" },
  // Réponse de SportVision disponible, à lire — Bible §21. Distinct de waiting_client
  // (l'inverse : SportVision attend une réponse du client), tone "info" pour signaler une
  // action utile mais non bloquante, comme "open".
  response_available: { label: "Réponse disponible", tone: "info" },
  resolved: { label: "Résolu", tone: "success" },
  closed: { label: "Fermé", tone: "neutral" },
};

// searchParams n'est disponible côté client qu'à l'intérieur d'un Suspense (Next.js App Router,
// même patron que requests/new/page.tsx) — d'où l'export par défaut qui ne fait que ce wrapping.
export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportPageContent />
    </Suspense>
  );
}

function SupportPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ctx } = useSession();
  const [query, setQuery] = useState("");
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [ticketContext, setTicketContext] = useState<NewTicketInitialContext | undefined>(undefined);
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);

  // Ouvre directement la modale, contexte pré-rempli, quand on arrive depuis "Contacter le
  // support" d'une facture/d'un contenu (?ctx_type=...&ctx_id=...&ctx_label=...).
  useEffect(() => {
    const initial = readInitialContext(searchParams);
    if (initial) {
      setTicketContext(initial);
      setTicketModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openNewTicket() {
    setTicketContext(undefined);
    setTicketModalOpen(true);
  }

  function closeNewTicket() {
    setTicketModalOpen(false);
    setTicketContext(undefined);
  }

  // club_support_tickets (voir data/club/support.ts) n'est lisible/écrivable que pour un vrai
  // club — RLS cst_member_select/cst_member_insert passent par is_club_member(club_id), qui ne
  // reconnaît que club_members (+ délégation cm_agency). Un compte non-club (cm_agency, académie,
  // coach, joueur, projet/generic, tournoi, stage) qui atteint quand même /support (tous dans leur
  // navigation respective, voir navigation.ts) obtenait un module "Nouveau ticket" entièrement
  // fonctionnel en apparence, mais dont la soumission échouait TOUJOURS avec un 403 RLS —
  // "Impossible d'envoyer le ticket. Réessayez." en boucle, jamais un vrai ticket possible.
  // Reproduit en réel (audit complet, 31/08/2026) avec un compte Espace Projet. Corrigé en
  // n'appelant fetchClubSupportTickets que pour un club (évite aussi une liste "vide" trompeuse
  // qui masquait en fait un accès refusé), et en étendant à tous les types non-club le même bloc
  // "Votre échange avec SportVision" déjà utilisé pour tournoi/stage ci-dessous — qui pointe vers
  // "Contacter mon conseiller" (bouton toujours visible plus bas, déjà branché sur /messages).
  const isClub = ctx.organization.type === "club";

  useEffect(() => {
    if (!isClub) return;
    let cancelled = false;
    const supabase = createClient();
    fetchClubSupportTickets(supabase, ctx.organization.id).then((rows) => {
      if (!cancelled) setTickets(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id, isClub]);

  if (!canAccess(ctx, "support")) return <LockedModule title="Aide" />;

  const topics = mockSupportTopics.filter(
    (t) => !query.trim() || t.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  // Bascule 2 org types séparés (migration-clubplus-v44, 17/08/2026) : le bloc "Votre échange
  // avec SportVision" ci-dessous n'est pas spécifique au tournoi, il concerne tout client
  // "one-off" — tournoi ET stage/camp partageaient déjà NAV_ONE_OFF (aujourd'hui
  // NAV_TOURNAMENT_ONE_OFF/NAV_CAMP_ONE_OFF) avant la bascule. Élargi (31/08/2026, voir
  // commentaire ci-dessus) à TOUT type non-club, pour la même raison : aucun n'a de file de
  // tickets réelle.
  const isOneOffClient = !isClub;

  function handleReplayOnboarding() {
    resetOnboardingProgress();
    router.push("/dashboard");
  }

  function handleNewTicket(ticket: { subject: string; category: SupportTicketCategory; priority: SupportTicketPriority; description: string }) {
    const supabase = createClient();
    const authorName = `${ctx.user.firstName} ${ctx.user.lastName}`.trim();
    return createClubSupportTicket(supabase, ctx.organization.id, authorName, ticket).then((created) => {
      setTickets((prev) => [created, ...(prev ?? [])]);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[29px] font-extrabold tracking-tight">Aide</h1>
          <p className="mt-1 text-[13.5px] text-text-soft">Trouvez une réponse ou contactez votre interlocuteur SportVision.</p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-border bg-surface-alt py-1.5 pl-1.5 pr-3 text-[11.5px] font-bold text-text-soft">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gradient-to-br from-brand-cyan to-brand-violet">
            <span className="h-1.5 w-1.5 animate-svpulse rounded-full bg-white" />
          </span>
          Tous les services fonctionnent
        </span>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher dans le centre d'aide…"
          className="h-11 w-full rounded-xl border border-border-strong bg-input-bg pl-9 pr-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
        />
      </div>

      {/* Cartes purement informatives (comptage d'articles mock, pas de fiche à ouvrir) — pas de
          hover "carte cliquable" ici pour ne pas promettre une interaction absente. */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((topic) => (
          <Card key={topic.id} className="flex flex-col gap-1.5 p-4">
            <div className="text-[14px] font-extrabold tracking-tight">{topic.title}</div>
            <div className="text-[12.5px] leading-relaxed text-text-soft">{topic.description}</div>
            <div className="mt-1 text-[11.5px] font-bold text-text-faint">{topic.articleCount} articles</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        {isClub && <Button onClick={openNewTicket}>Nouveau ticket</Button>}
        <Button variant="secondary" onClick={handleReplayOnboarding}>
          <PlayCircle className="h-4 w-4" aria-hidden />
          Revoir le tutoriel de bienvenue
        </Button>
        <Button variant="secondary" onClick={() => router.push("/messages")}>
          <LifeBuoy className="h-4 w-4" aria-hidden />
          Contacter mon conseiller
        </Button>
      </div>

      {isOneOffClient ? (
        // 25/08/2026, audit complet : l'ancien fil de messages ici était entièrement factice
        // (mockThreads/mockMessages, jamais réel) avec un bouton "Envoyer" sans onClick — une
        // coquille vide qui donnait l'illusion d'un canal fonctionnel. useClientId() (data/shared/
        // use-client-id.ts) traite délibérément tournament_organizer/camp comme "aucune donnée
        // réelle possible pour ces types à ce jour" — cohérent avec cette limite plutôt que de
        // construire un vrai fil de discussion en dehors de ce périmètre déjà décidé.
        //
        // 31/08/2026 — élargi à tout type non-club (voir commentaire plus haut) : le texte reste
        // volontairement générique ("passez par Contacter mon conseiller" plutôt que "par e-mail")
        // car /messages fonctionne réellement pour certains de ces types (Espace Projet, Joueur —
        // useClientId() le résout), pas seulement pour tournoi/stage. Le bouton "Contacter mon
        // conseiller" ci-dessus route déjà vers /messages pour tout le monde, y compris quand
        // celui-ci affiche lui-même un état "pas encore relié" honnête pour un type non couvert.
        <Card className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <div className="text-[15px] font-extrabold tracking-tight">Votre échange avec SportVision</div>
          <p className="max-w-sm text-[13px] text-text-soft">
            Il n&apos;y a pas de file de tickets pour ce type d&apos;espace. Pour toute question, utilisez « Contacter mon
            conseiller » ci-dessus.
          </p>
        </Card>
      ) : (
        <Card>
          <div className="border-b border-divider px-5 py-4 text-[15px] font-extrabold tracking-tight">Mes tickets</div>
          {tickets === null ? (
            <div className="px-5 py-8 text-center text-[13px] text-text-soft">Chargement…</div>
          ) : tickets.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-text-soft">
              Vous n&apos;avez encore ouvert aucun ticket. Créez-en un si vous avez besoin d&apos;aide.
            </div>
          ) : (
            tickets.map((ticket) => (
              <div
                key={ticket.id}
                className="flex items-center gap-3.5 border-b border-divider px-5 py-3.5 last:border-0 hover:bg-row-hover"
              >
                <span className="w-32 flex-none font-mono text-[11.5px] text-text-faint">{ticket.reference}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold">{ticket.subject}</span>
                  <span className="mt-0.5 block text-[12px] text-text-soft">
                    {ticket.assigneeName ? `Assigné à ${ticket.assigneeName}` : "En attente d'assignation"}
                  </span>
                </span>
                <Badge tone={STATUS_LABEL[ticket.status].tone}>{STATUS_LABEL[ticket.status].label}</Badge>
              </div>
            ))
          )}
        </Card>
      )}

      {ticketModalOpen && <NewTicketModal onClose={closeNewTicket} onSubmit={handleNewTicket} initialContext={ticketContext} />}
    </div>
  );
}
