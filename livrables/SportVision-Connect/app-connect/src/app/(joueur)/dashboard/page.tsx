import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, getAccountType } from "@/lib/supabase/session";
import {
  getNextClubEvent,
  getNextPrestation,
  getUnreadMessagesCount,
  getCotisationEnCours,
  getRecentContentGroups,
  prestationStatusLabel,
} from "@/lib/supabase/dashboard";
import { formatEUR } from "@/lib/prestations/format";

// Accueil — voir design-connect-personnel-12-08/README.md § Espace joueur → Accueil, et
// Connect Espace Joueur.dc.html (bloc ACCUEIL) pour le texte exact de chaque carte. Cartes
// "club"/"prestation"/"événement" affichées UNIQUEMENT si pertinentes (principe du design) :
// chaque carte a une source de données réelle vérifiée avant d'être construite (voir
// src/lib/supabase/dashboard.ts). "Nouveaux contenus" (ci-dessous) est la seule carte TOUJOURS
// affichée, avec son propre état vide — voir getRecentContentGroups pour l'historique de cette
// carte (absente jusqu'au 15/08, ajoutée en comparant l'implémentation à la maquette réelle).
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Résolution du shell — voir migration-connect-v51-espace-particulier.sql §1 et
  // src/components/layout/ParticularShell.tsx. /dashboard est LE point d'entrée unique après
  // chaque connexion (auth/login, auth/confirming, signup/club redirigent tous ici), donc c'est
  // le bon (et seul) endroit pour brancher ce choix sans dupliquer la vérification sur chaque
  // route — voir le rapport final pour la limite documentée de cette approche (une route Espace
  // joueur ouverte directement par URL par un compte particulier n'est pas re-vérifiée ici).
  const accountType = await getAccountType(supabase, user.id);
  if (accountType === "particulier") redirect("/particulier");

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  const [nextEvent, nextPrestation, unreadMessages, cotisation, contentGroups] = await Promise.all([
    player?.club ? getNextClubEvent(supabase, player.club.id) : Promise.resolve(null),
    player?.clientId ? getNextPrestation(supabase, player.clientId) : Promise.resolve(null),
    player?.clientId ? getUnreadMessagesCount(supabase, player.clientId) : Promise.resolve(0),
    getCotisationEnCours(supabase),
    player?.club ? getRecentContentGroups(supabase, player.club.id) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Bonjour {firstName} 👋</h1>
            <p className="text-[15px] text-text-tertiary">Retrouvez votre univers SportVision en un coup d&apos;œil.</p>
          </div>
          <Link
            href="/prestations"
            className="hidden h-[46px] flex-none items-center gap-2 rounded-sv bg-sv-gradient px-5 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12] lg:flex"
          >
            <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">add</span>
            Réserver une prestation
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4.5 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)] lg:items-start">
          {/* Colonne gauche */}
          <div className="flex flex-col gap-4.5">
            {player?.club && player.club.status === "affilie" && (
              <ClubCard variant="affilie">
                <ClubHeader nom={player.club.nom} ville={player.club.ville} logoUrl={player.club.logoUrl} />
                <span className="mt-1 self-start rounded-sv-pill bg-affiliations-bg px-2.5 py-1 text-[12px] font-medium text-affiliations">
                  ✓ Affilié
                </span>
              </ClubCard>
            )}

            {player?.club && player.club.status === "attente" && (
              <ClubCard variant="attente">
                <ClubHeader nom={player.club.nom} ville={player.club.ville} logoUrl={player.club.logoUrl} />
                <span className="mt-1 self-start rounded-sv-pill bg-attente-bg px-2.5 py-1 text-[12px] font-medium text-attente">
                  En attente
                </span>
                <p className="mt-2 text-[14px] leading-relaxed text-text-tertiary lg:text-[13px]">
                  Votre demande d&apos;affiliation doit encore être confirmée par le club. Vous pouvez
                  utiliser Connect normalement pendant ce temps.
                </p>
              </ClubCard>
            )}

            {player?.club && player.club.status === "refuse" && (
              <ClubCard variant="refuse">
                <ClubHeader nom={player.club.nom} ville={player.club.ville} logoUrl={player.club.logoUrl} />
                <span className="mt-1 self-start rounded-sv-pill bg-danger-bg px-2.5 py-1 text-[12px] font-medium text-danger">
                  Demande refusée
                </span>
                <p className="mt-2 text-[14px] leading-relaxed text-text-tertiary lg:text-[13px]">
                  Ce club n&apos;a pas confirmé votre demande d&apos;affiliation. Vous pouvez réessayer
                  avec le bon club ou une autre structure.
                </p>
                <Link
                  href="/affiliations"
                  className="mt-1 self-start rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[14px] font-semibold text-white hover:brightness-[1.12]"
                >
                  Essayer un autre club
                </Link>
              </ClubCard>
            )}

            {!player?.club && (
              <div className="flex flex-col gap-3.5 rounded-sv-card border border-border bg-surface p-5">
                <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-affiliations-bg">
                  <span className="material-symbols-rounded !text-[24px] text-affiliations" aria-hidden="true">shield</span>
                </span>
                <div className="flex flex-col gap-2">
                  <span className="font-sora text-[18px] font-semibold">Rejoignez votre club</span>
                  <p className="text-[14px] leading-relaxed text-text-tertiary">
                    Associez votre profil à votre club ou académie pour retrouver les contenus et
                    événements liés à votre équipe.
                  </p>
                </div>
                <Link
                  href="/affiliations/ajouter"
                  className="self-start rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[14px] font-semibold text-white hover:brightness-[1.12]"
                >
                  Ajouter mon club
                </Link>
              </div>
            )}

            {/* Nouveaux contenus — voir Connect Espace Joueur.dc.html bloc ACCUEIL : seule
                section toujours affichée, avec son propre état vide (jamais masquée comme les
                cartes club/prestation/événement ci-dessus). */}
            <div className="flex flex-col gap-3.5">
              <div className="flex items-baseline justify-between gap-3.5">
                <h2 className="font-sora text-[20px] font-semibold tracking-tight">Nouveaux contenus</h2>
                {contentGroups.length > 0 && (
                  <Link href="/contenus" className="text-[14px] font-medium text-contenus hover:brightness-110 lg:text-[13px]">
                    Tout voir
                  </Link>
                )}
              </div>

              {contentGroups.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {contentGroups.map((g, i) => (
                    <Link
                      key={g.key}
                      href="/contenus"
                      className="flex flex-col overflow-hidden rounded-sv-card border border-border bg-surface transition-colors duration-150 hover:border-[rgba(192,132,252,.5)] animate-sv-in motion-reduce:animate-none"
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    >
                      <div className="relative h-[158px]" style={{ background: g.cover }}>
                        <span className="absolute right-3 top-3 rounded-sv-pill bg-black/45 px-2.5 py-1 text-[11px] font-medium text-text">
                          {g.count}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5 p-4.5">
                        <span className="font-sora text-[16px] font-semibold">{g.title}</span>
                        <span className="text-[13px] text-text-tertiary">
                          {[g.photoCount ? `${g.photoCount} photo${g.photoCount > 1 ? "s" : ""}` : null, g.videoCount ? `${g.videoCount} vidéo${g.videoCount > 1 ? "s" : ""}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 font-sora text-[14px] font-semibold text-contenus">
                          Découvrir
                          <span className="material-symbols-rounded !text-[17px]" aria-hidden="true">arrow_forward</span>
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-sv-card border border-dashed border-border-strong bg-white/[.04] p-6">
                  <span className="flex h-11 w-11 items-center justify-center rounded-sv bg-contenus-bg">
                    <span className="material-symbols-rounded !text-[22px] text-contenus" aria-hidden="true">photo_library</span>
                  </span>
                  <span className="font-sora text-[17px] font-semibold">Vos futurs contenus apparaîtront ici</span>
                  <p className="max-w-[460px] text-[14px] leading-relaxed text-text-tertiary">
                    Photos, vidéos et reels seront ajoutés automatiquement après les prestations SportVision
                    auxquelles vous avez accès.
                  </p>
                  <Link href="/prestations" className="self-start text-[14px] font-semibold text-[#8CA9FF]">
                    Découvrir les prestations
                  </Link>
                </div>
              )}
            </div>

            {nextEvent ? (
              <div className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-5">
                <div className="flex h-16 w-16 flex-none flex-col items-center justify-center rounded-sv" style={{ background: "linear-gradient(150deg,rgba(79,125,255,.32),rgba(34,211,238,.14))" }}>
                  <span className="font-sora text-[21px] font-bold leading-none">{nextEvent.day}</span>
                  <span className="text-[11px] font-medium uppercase tracking-[.06em] text-prestations">{nextEvent.month}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">Prochainement</span>
                  <span className="font-sora text-[18px] font-semibold tracking-tight">{nextEvent.title}</span>
                  <span className="text-[14px] text-text-tertiary lg:text-[13px]">
                    {nextEvent.date}
                    {nextEvent.time && ` · ${nextEvent.time}`}
                    {nextEvent.location && ` · ${nextEvent.location}`}
                  </span>
                </div>
                <div className="ml-auto flex flex-none flex-col items-end gap-2.5">
                  <span className="rounded-sv-pill bg-prestations-bg px-2.5 py-1 text-[12px] font-medium text-prestations">📸 SportVision présent</span>
                  <Link href="/calendrier" className="text-[14px] font-medium text-text-secondary hover:text-text lg:text-[13px]">
                    Voir l&apos;événement
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-sv border border-border bg-white/[.04] px-4.5 py-4">
                <span className="material-symbols-rounded !text-[20px] text-text-faint" aria-hidden="true">event_busy</span>
                <span className="text-[14px] text-text-tertiary">Aucun événement SportVision prévu pour le moment.</span>
                <Link href="/calendrier" className="ml-auto flex-none text-[14px] font-medium text-[#8CA9FF] lg:text-[13px]">
                  Calendrier
                </Link>
              </div>
            )}
          </div>

          {/* Colonne droite */}
          <div className="flex flex-col gap-4.5">
            {cotisation && cotisation.target > 0 && (
              <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(150deg,rgba(244,114,182,.6),rgba(168,85,247,.25) 55%,transparent)" }}>
                <div className="flex flex-col gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated-accent p-5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-[30px] w-[30px] items-center justify-center rounded-sv bg-cotisations-bg">
                      <span className="material-symbols-rounded !text-[18px] text-cotisations" aria-hidden="true">savings</span>
                    </span>
                    <span className="text-[11px] font-medium uppercase tracking-[.1em] text-cotisations">Cotisation en cours</span>
                  </div>
                  <span className="font-sora text-[19px] font-semibold tracking-tight">{cotisation.title}</span>
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-baseline justify-between gap-2.5">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-sora text-[27px] font-bold tracking-tight">{formatEUR(cotisation.collected)}</span>
                        <span className="text-[14px] text-text-tertiary">/ {formatEUR(cotisation.target)}</span>
                      </div>
                      <span className="text-[13px] font-medium text-cotisations">
                        {Math.round((cotisation.collected / cotisation.target) * 100)} %
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-sv-pill bg-white/[.08]">
                      <div
                        className="h-full rounded-sv-pill bg-sv-gradient-cotisation transition-[width] duration-300 motion-reduce:transition-none"
                        style={{ width: `${Math.min(100, Math.round((cotisation.collected / cotisation.target) * 100))}%` }}
                      />
                    </div>
                    <span className="text-[14px] text-text-tertiary lg:text-[13px]">
                      Plus que {formatEUR(Math.max(0, cotisation.target - cotisation.collected))} pour atteindre l&apos;objectif
                      {cotisation.participants > 0 && ` · ${cotisation.participants} participants`}
                    </span>
                  </div>
                  <Link
                    href={`/cotisations/${cotisation.id}`}
                    className="flex h-12 items-center justify-center rounded-sv border border-border-strong bg-white/5 font-sora text-[14px] font-semibold hover:bg-white/10"
                  >
                    Voir le paiement collectif
                  </Link>
                </div>
              </div>
            )}

            {nextPrestation ? (
              <div className="flex flex-col gap-3.5 rounded-sv-card border border-border bg-surface p-5">
                <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">Prochaine prestation</span>
                <div className="flex items-center gap-3">
                  <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-sv bg-prestations-bg">
                    <span className="material-symbols-rounded !text-[22px] text-prestations" aria-hidden="true">camera_alt</span>
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-sora text-[16px] font-semibold">{nextPrestation.type || nextPrestation.reference || "Prestation"}</span>
                    {nextPrestation.date && (
                      <span className="text-[14px] text-text-tertiary lg:text-[13px]">
                        {nextPrestation.date}
                        {nextPrestation.time && ` · ${nextPrestation.time}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2.5">
                  <span className="rounded-sv-pill bg-attente-bg px-2.5 py-1 text-[12px] font-medium text-attente">
                    {prestationStatusLabel(nextPrestation.statut)}
                  </span>
                  <Link href="/commandes" className="text-[14px] font-medium text-text-secondary hover:text-text lg:text-[13px]">
                    Voir ma commande
                  </Link>
                </div>
              </div>
            ) : (
              // "Aucune prestation prévue" (Connect Espace Joueur.dc.html) : la maquette liste
              // "Match Photo, Match Vidéo, Pack Match, Veo, Drone ou Highlight" — texte adapté ici
              // (Highlight omis) car aucune offre "Montage"/Highlight n'existe dans le catalogue
              // réel (voir src/lib/prestations/catalogue.ts, même principe déjà appliqué au
              // catalogue et aux filtres : jamais citer une offre qui n'existe pas réellement).
              <div className="flex flex-col gap-3 rounded-sv-card border border-dashed border-border-strong bg-white/[.04] p-5">
                <span className="flex h-11 w-11 items-center justify-center rounded-sv bg-prestations-bg">
                  <span className="material-symbols-rounded !text-[22px] text-prestations" aria-hidden="true">camera_alt</span>
                </span>
                <span className="font-sora text-[17px] font-semibold">Aucune prestation prévue</span>
                <p className="text-[14px] leading-relaxed text-text-tertiary">Match Photo, Match Vidéo, Pack Match, Veo, Drone.</p>
                <Link
                  href="/prestations"
                  className="self-start rounded-sv border border-border-strong bg-white/[.06] px-4 py-2.5 font-sora text-[14px] font-semibold hover:bg-white/[.12]"
                >
                  Découvrir les prestations
                </Link>
              </div>
            )}

            {unreadMessages > 0 && (
              <Link
                href="/messages"
                className="flex items-center gap-3.5 rounded-sv-card border border-border bg-surface p-4.5 hover:bg-white/[.06]"
              >
                <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-sv bg-affiliations-bg">
                  <span className="material-symbols-rounded !text-[20px] text-affiliations" aria-hidden="true">chat_bubble</span>
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="font-sora text-[15px] font-semibold">Messages</span>
                  <span className="text-[14px] text-text-tertiary lg:text-[13px]">
                    {unreadMessages} nouveau{unreadMessages > 1 ? "x" : ""} message{unreadMessages > 1 ? "s" : ""} SportVision
                  </span>
                </div>
                <span className="ml-auto flex-none text-[14px] font-medium text-affiliations lg:text-[13px]">Ouvrir</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    );
}

function ClubHeader({ nom, ville, logoUrl }: { nom: string; ville: string | null; logoUrl: string | null }) {
  return (
    <div className="flex items-center gap-3.5">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo club distant (bucket Storage clubplus-media), pas un asset local optimisable par next/image
        <img
          src={logoUrl}
          alt={`Logo ${nom}`}
          className="h-[52px] w-[52px] flex-none rounded-sv bg-white/5 object-cover"
        />
      ) : (
        <span className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-sv bg-white/5 font-mono text-[8px] text-text-faint">
          logo
        </span>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-[.1em] text-affiliations">Mon club</span>
        <span className="font-sora text-[20px] font-semibold tracking-tight">{nom}</span>
        {ville && <span className="text-[13px] text-text-tertiary">{ville}</span>}
      </div>
    </div>
  );
}

function ClubCard({
  variant,
  children,
}: {
  variant: "affilie" | "attente" | "refuse";
  children: React.ReactNode;
}) {
  const glow =
    variant === "affilie"
      ? "rgba(34,211,238,.55)"
      : variant === "attente"
        ? "rgba(251,191,36,.5)"
        : "rgba(244,114,182,.5)";
  return (
    <div className="rounded-sv-card p-px" style={{ background: `linear-gradient(130deg, ${glow}, rgba(79,125,255,.18) 60%, transparent)` }}>
      <div className="flex flex-col gap-3 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
        {children}
      </div>
    </div>
  );
}
