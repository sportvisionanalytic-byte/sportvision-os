"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, PlayCircle, Search, Send } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { mockSupportTickets, mockSupportTopics } from "@/lib/mock/settings";
import type { SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from "@/lib/types/settings";
import { mockThreads, mockMessages } from "@/lib/mock/messaging";
import { resetOnboardingProgress } from "@/components/onboarding/onboarding-storage";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { NewTicketModal } from "@/components/support/NewTicketModal";

// /support — voir ACTIONS.md § 24. Recherche, cartes de sujet, Nouveau ticket, Revoir le
// tutoriel de bienvenue, Le contacter (chargé de compte), indicateur d'état des services. Pour un
// client ponctuel (organisation « événement »), la relation avec SportVision passe surtout par un
// fil de messages plutôt qu'une file de tickets : on l'affiche directement sur cet écran plutôt
// que de le faire chercher dans une messagerie séparée.

const STATUS_LABEL: Record<SupportTicketStatus, { label: string; tone: "info" | "warning" | "success" | "neutral" }> = {
  open: { label: "Ouvert", tone: "info" },
  in_progress: { label: "En cours", tone: "warning" },
  waiting_client: { label: "En attente du client", tone: "warning" },
  resolved: { label: "Résolu", tone: "success" },
  closed: { label: "Fermé", tone: "neutral" },
};

export default function SupportPage() {
  const router = useRouter();
  const { ctx } = useSession();
  const [query, setQuery] = useState("");
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [tickets, setTickets] = useState(() => mockSupportTickets[ctx.organization.id] ?? []);

  if (!canAccess(ctx, "support")) return <LockedModule title="Aide" />;

  const topics = mockSupportTopics.filter(
    (t) => !query.trim() || t.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const isOneOffClient = ctx.organization.type === "event";
  const supportThread = (mockThreads[ctx.organization.id] ?? []).find((t) => t.contextType === "support");
  const supportMessages = supportThread ? mockMessages[supportThread.id] ?? [] : [];

  function handleReplayOnboarding() {
    resetOnboardingProgress();
    router.push("/dashboard");
  }

  function handleNewTicket(ticket: { subject: string; category: SupportTicketCategory; priority: SupportTicketPriority; description: string }) {
    setTickets((prev) => [
      {
        id: `tck-${Date.now()}`,
        reference: `TCK-2026-${Math.floor(1000 + Math.random() * 8999)}`,
        organizationId: ctx.organization.id,
        createdById: ctx.user.id,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        description: ticket.description,
        status: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
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

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((topic) => (
          <Card key={topic.id} className="flex flex-col gap-1.5 p-4 hover:-translate-y-0.5 hover:border-border-strong">
            <div className="text-[14px] font-extrabold tracking-tight">{topic.title}</div>
            <div className="text-[12.5px] leading-relaxed text-text-soft">{topic.description}</div>
            <div className="mt-1 text-[11.5px] font-bold text-text-faint">{topic.articleCount} articles</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setTicketModalOpen(true)}>Nouveau ticket</Button>
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
        <Card className="flex flex-col">
          <div className="border-b border-divider px-5 py-4 text-[15px] font-extrabold tracking-tight">
            Votre échange avec SportVision
          </div>
          <div className="flex flex-col gap-3 px-5 py-4">
            {supportMessages.length === 0 && (
              <p className="text-[13px] text-text-soft">Aucun message pour le moment. Envoyez-nous votre demande.</p>
            )}
            {supportMessages.map((m) => (
              <div key={m.id} className="flex items-start gap-2.5">
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-violet to-brand-blue-electric text-[10.5px] font-extrabold text-white">
                  {m.authorInitials}
                </span>
                <div>
                  <div className="text-[12.5px] font-bold">{m.authorName}</div>
                  <div className="text-[13px] text-text-soft">{m.body}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2.5 border-t border-divider px-5 py-3.5">
            <input
              placeholder="Écrire un message…"
              className="h-10 flex-1 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[13.5px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
            />
            <Button className="h-10 px-3.5">
              <Send className="h-4 w-4" aria-hidden />
              Envoyer
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="border-b border-divider px-5 py-4 text-[15px] font-extrabold tracking-tight">Mes tickets</div>
          {tickets.length === 0 ? (
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

      {ticketModalOpen && <NewTicketModal onClose={() => setTicketModalOpen(false)} onSubmit={handleNewTicket} />}
    </div>
  );
}
