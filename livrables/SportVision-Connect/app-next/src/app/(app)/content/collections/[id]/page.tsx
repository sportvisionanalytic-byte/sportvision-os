"use client";

import Link from "next/link";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { getCollectionById } from "@/lib/mock/content";
import { ContentLockedModule } from "@/components/content/LockedModule";
import { CollectionPanel } from "@/components/content/CollectionPanel";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// /content/collections/:id — panneau de collection, voir ACTIONS.md § 13.
export default function CollectionDetailPage({ params }: { params: { id: string } }) {
  const { ctx } = useSession();
  if (!canAccess(ctx, "content")) return <ContentLockedModule />;

  const collection = getCollectionById(params.id);

  if (!collection || collection.organizationId !== ctx.organization.id) {
    return (
      <Card className="mx-auto flex max-w-[480px] flex-col items-center gap-3 p-9 text-center">
        <div className="text-[16px] font-extrabold tracking-tight">Collection introuvable</div>
        <p className="text-[13.5px] text-text-soft">
          Cette collection n&apos;existe pas ou n&apos;est pas rattachée à {ctx.organization.name}.
        </p>
        <Link href="/content">
          <Button variant="primary">Retour à la bibliothèque</Button>
        </Link>
      </Card>
    );
  }

  return <CollectionPanel collection={collection} />;
}
