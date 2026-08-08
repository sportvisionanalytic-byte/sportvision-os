"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { fetchClubMediaAssets } from "@/lib/data/club/content";
import { createClient } from "@/lib/supabase/client";
import type { MediaAsset } from "@/lib/types/content";
import { LockedModule } from "@/components/ui/LockedModule";
import { MediaDetail } from "@/components/content/MediaDetail";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// /content/:id — fiche média, voir ACTIONS.md § 13.
export default function MediaDetailPage({ params }: { params: { id: string } }) {
  const { ctx } = useSession();
  const [asset, setAsset] = useState<MediaAsset | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    fetchClubMediaAssets(supabase, ctx.organization.id).then((rows) => {
      if (!cancelled) setAsset(rows.find((a) => a.id === params.id) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx.organization.id, params.id]);

  if (!canAccess(ctx, "content")) return <LockedModule />;

  if (asset === undefined) {
    return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;
  }

  // Sécurité — voir DATA_MODEL.md § Sécurité : vérification d'organisation avant d'afficher la
  // ressource (filtrage déjà scopé par organisation active côté requête, revérifié ici).
  if (!asset || asset.organizationId !== ctx.organization.id) {
    return (
      <Card className="mx-auto flex max-w-[480px] flex-col items-center gap-3 p-9 text-center">
        <div className="text-[16px] font-extrabold tracking-tight">Contenu introuvable</div>
        <p className="text-[13.5px] text-text-soft">
          Ce contenu n&apos;existe pas ou n&apos;est pas rattaché à {ctx.organization.name}.
        </p>
        <Link href="/content">
          <Button variant="primary">Retour à la bibliothèque</Button>
        </Link>
      </Card>
    );
  }

  return <MediaDetail asset={asset} />;
}
