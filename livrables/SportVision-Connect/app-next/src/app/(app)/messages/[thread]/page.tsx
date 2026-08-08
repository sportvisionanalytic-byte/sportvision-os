"use client";

import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { LockedModule } from "@/components/ui/LockedModule";
import { MessagesShell } from "@/components/messaging/MessagesShell";

// /messages/:thread — voir ACTIONS.md § 22 et README.md § Arborescence des routes. Même coque
// que /messages, avec le fil demandé ouvert directement (lien profond depuis une prestation, une
// demande, une facture...).
export default function MessageThreadPage({ params }: { params: { thread: string } }) {
  const { ctx } = useSession();

  if (!canAccess(ctx, "messages")) return <LockedModule title="Messages" />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[29px] font-extrabold tracking-tight">Messages</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">Chaque conversation est rattachée à une demande, une prestation ou un échange avec SportVision.</p>
      </div>
      <MessagesShell activeThreadId={params.thread} />
    </div>
  );
}
