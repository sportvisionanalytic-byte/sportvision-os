"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Heart, MessageSquare, Shield } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import { fetchClubMatches } from "@/lib/data/club/matches";
import { fetchPlayerMediaAssets } from "@/lib/data/player/media";
import { fetchPlayerClubInfo, type PlayerClubInfo } from "@/lib/data/player/club-info";
import { fetchFavoriteIds } from "@/lib/data/shared/favorites";
import { fetchClientMessages, type ClientMessage } from "@/lib/data/shared/messages";
import type { Match } from "@/lib/types/studio";
import type { MediaAsset } from "@/lib/types/content";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Dashboard Joueur — refonte 11/08/2026, voir brief Fouka (test réel de l'espace Joueur) § 2, 3,
// 4, 9, 15, 21, et MASTER-CONNECT-V1.md § 18-20 (document de référence produit fourni par Fouka
// le même jour, cohérent avec le brief). Remplace la branche "player" générique de
// PersonaDashboard.tsx (dashboard/page.tsx route ici directement pour organization.type ===
// "player", même pattern que ClubPlusDashboard/FullCommunicationDashboard) : un joueur a besoin
// d'un dashboard personnel, pas d'une variante de plus dans un switch multi-persona générique.
//
// N'affiche JAMAIS : crédits, gestion d'offre, finances du club, contrats du club (brief § 18/21,
// MASTER § 19/61) — un joueur n'a ni offre ni crédits personnels.
export function PlayerDashboard() {
  const { ctx } = useSession();
  const router = useRouter();
  const clubId = ctx.organization.parentOrganizationId;

  const [matches, setMatches] = useState<Match[] | null>(null);
  const [contents, setContents] = useState<MediaAsset[] | null>(null);
  const [clubInfo, setClubInfo] = useState<PlayerClubInfo | null>(null);
  const [favoriteCount, setFavoriteCount] = useState<number | null>(null);
  const [lastMessage, setLastMessage] = useState<ClientMessage[] | null>(null);

  useEffect(() => {
    if (!clubId) return;
    const supabase = createClient();
    fetchClubMatches(supabase, clubId).then(setMatches).catch(() => setMatches([]));
    fetchPlayerMediaAssets(supabase, clubId).then(setContents).catch(() => setContents([]));
    fetchPlayerClubInfo(supabase, clubId, ctx.organization.id).then(setClubInfo).catch(() => setClubInfo(null));
  }, [clubId, ctx.organization.id]);

  useEffect(() => {
    const supabase = createClient();
    fetchFavoriteIds(supabase, ctx.user.id)
      .then((ids) => setFavoriteCount(ids.size))
      .catch(() => setFavoriteCount(0));
  }, [ctx.user.id]);

  // Dernier message — même résolution de client_id que /messages (useClientId), mais un seul
  // appel ponctuel ici (pas besoin de l'abonnement temps réel du fil complet pour un aperçu).
  useEffect(() => {
    const supabase = createClient();
    supabase
      .rpc("resolve_player_client_id", { p_player_id: ctx.organization.id })
      .then(({ data, error }) => {
        if (error || !data) {
          setLastMessage([]);
          return;
        }
        fetchClientMessages(supabase, data as string)
          .then((rows) => setLastMessage(rows.slice(-1)))
          .catch(() => setLastMessage([]));
      });
  }, [ctx.organization.id]);

  const nextMatch = (matches ?? [])
    .filter((m) => m.status === "upcoming" && m.kickoffAt)
    .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime())[0];

  const latestContentDay = (() => {
    if (!contents || contents.length === 0) return null;
    const sorted = [...contents].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const dayKey = sorted[0]!.createdAt.slice(0, 10);
    const dayAssets = sorted.filter((a) => a.createdAt.slice(0, 10) === dayKey);
    const photos = dayAssets.filter((a) => a.kind === "photo" || a.kind === "raw_photo").length;
    const videos = dayAssets.filter((a) => a.kind === "video" || a.kind === "raw_video" || a.kind === "highlight").length;
    const reels = dayAssets.filter((a) => a.kind === "reel" || a.kind === "story").length;
    return {
      label: new Date(`${dayKey}T00:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }),
      photos,
      videos,
      reels,
      total: dayAssets.length,
    };
  })();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[29px] font-extrabold leading-tight tracking-tight">Bonjour {ctx.user.firstName} 👋</h1>
        <p className="mt-1.5 max-w-xl text-[13.5px] text-text-soft">
          Retrouvez les contenus et les prochains événements de votre club.
        </p>
      </div>

      {/* Prochain événement — brief § 2 : "Là tu crées immédiatement de la valeur." */}
      <Card className="overflow-hidden border-brand-blue-pale/40 bg-gradient-to-br from-[rgba(36,75,255,.12)] to-[rgba(138,46,255,.08)] p-5">
        <div className="text-[11px] font-extrabold uppercase tracking-[.1em] text-brand-blue-electric">
          Prochainement
        </div>
        {matches === null ? (
          <div className="mt-3 text-[13px] text-text-soft">Chargement…</div>
        ) : nextMatch ? (
          <div className="mt-2.5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[18px] font-extrabold tracking-tight">
                ⚽ {nextMatch.teamName} vs {nextMatch.opponent}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-text-soft">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                {new Date(nextMatch.kickoffAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                {nextMatch.venue ? ` · ${nextMatch.venue}` : ""}
              </div>
            </div>
            <Button variant="dark" onClick={() => router.push("/calendar")}>
              Voir dans le calendrier
            </Button>
          </div>
        ) : (
          <div className="mt-2.5 text-[13.5px] text-text-soft">Aucun événement prévu pour le moment.</div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Nouveaux contenus — brief § 3 : "probablement LA section la plus importante". */}
        <Card className="flex flex-col gap-3 p-5">
          <div className="text-[13px] font-extrabold tracking-tight">Nouveaux contenus</div>
          {contents === null ? (
            <div className="text-[13px] text-text-soft">Chargement…</div>
          ) : latestContentDay ? (
            <>
              <div className="text-[14px] font-bold">Match du {latestContentDay.label}</div>
              <div className="text-[12.5px] text-text-soft">
                {[
                  latestContentDay.photos > 0 && `📸 ${latestContentDay.photos} photo${latestContentDay.photos > 1 ? "s" : ""}`,
                  latestContentDay.videos > 0 && `🎥 ${latestContentDay.videos} vidéo${latestContentDay.videos > 1 ? "s" : ""}`,
                  latestContentDay.reels > 0 && `🎬 ${latestContentDay.reels} reel${latestContentDay.reels > 1 ? "s" : ""}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || `${latestContentDay.total} contenu${latestContentDay.total > 1 ? "s" : ""}`}
              </div>
              <Button variant="secondary" className="mt-1 self-start" onClick={() => router.push("/content")}>
                Voir les contenus
              </Button>
            </>
          ) : (
            <div className="text-[13px] text-text-soft">Aucun contenu pour l&apos;instant.</div>
          )}
        </Card>

        {/* Mon club — brief § 4 et § 18 (remplace la carte offre/crédits). */}
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2 text-[13px] font-extrabold tracking-tight">
            <Shield className="h-4 w-4 text-brand-blue-electric" aria-hidden />
            Mon club
          </div>
          <div className="text-[14px] font-bold">{clubInfo?.clubName ?? "…"}</div>
          <div className="text-[12.5px] text-text-soft">
            {clubInfo?.teamName ? `${clubInfo.teamName}${clubInfo.categorie ? ` · ${clubInfo.categorie}` : ""} · ` : ""}Joueur
          </div>
          <Button variant="secondary" className="mt-1 self-start" onClick={() => router.push("/team-requests")}>
            Voir mon club
          </Button>
        </Card>

        {/* Mes favoris — brief § 9. */}
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2 text-[13px] font-extrabold tracking-tight">
            <Heart className="h-4 w-4 text-[#FF6B81]" aria-hidden />
            Mes favoris
          </div>
          <div className="text-[22px] font-extrabold tracking-tight">
            {favoriteCount === null ? "…" : favoriteCount}
          </div>
          <div className="text-[12.5px] text-text-soft">
            {favoriteCount ? `contenu${favoriteCount > 1 ? "s" : ""} favori${favoriteCount > 1 ? "s" : ""}` : "Aucun favori pour l'instant."}
          </div>
          <Button variant="secondary" className="mt-1 self-start" onClick={() => router.push("/content")}>
            Voir mes favoris
          </Button>
        </Card>

        {/* Messages — brief § 15/21. */}
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2 text-[13px] font-extrabold tracking-tight">
            <MessageSquare className="h-4 w-4 text-brand-blue-electric" aria-hidden />
            Messages
          </div>
          {lastMessage === null ? (
            <div className="text-[13px] text-text-soft">Chargement…</div>
          ) : lastMessage.length > 0 ? (
            <p className="line-clamp-2 text-[13px] leading-relaxed text-text-soft">{lastMessage[0]!.contenu}</p>
          ) : (
            <div className="text-[13px] text-text-soft">Aucun message pour le moment.</div>
          )}
          <Button variant="secondary" className="mt-1 self-start" onClick={() => router.push("/messages")}>
            Ouvrir Messages
          </Button>
        </Card>
      </div>
    </div>
  );
}
