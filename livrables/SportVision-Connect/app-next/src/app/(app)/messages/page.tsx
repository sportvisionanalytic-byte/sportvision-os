"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { mockThreads } from "@/lib/mock/messaging";
import { LockedModule } from "@/components/ui/LockedModule";
import { MessagesShell } from "@/components/messaging/MessagesShell";

// /messages — voir ACTIONS.md § 22. Ouvre directement la conversation la plus récente si elle
// existe (l'écran à deux panneaux n'a de sens que fil sélectionné) ; sinon affiche l'état vide du
// panneau droit.
export default function MessagesPage() {
  const router = useRouter();
  const { ctx } = useSession();

  const threads = mockThreads[ctx.organization.id] ?? [];
  const mostRecent = [...threads]
    .filter((t) => !t.isArchived)
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())[0];

  useEffect(() => {
    if (mostRecent) router.replace(`/messages/${mostRecent.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostRecent?.id]);

  if (!canAccess(ctx, "messages")) return <LockedModule title="Messages" />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[29px] font-extrabold tracking-tight">Messages</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">Chaque conversation est rattachée à une demande, une prestation ou un échange avec SportVision.</p>
      </div>
      <MessagesShell />
    </div>
  );
}
