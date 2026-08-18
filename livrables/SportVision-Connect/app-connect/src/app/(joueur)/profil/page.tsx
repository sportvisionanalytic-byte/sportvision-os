import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  buildPlayerContext,
  resolveDisplayIdentity,
  getProfileSettings,
  getClubPlusAccess,
  requireJoueurAccount,
} from "@/lib/supabase/session";
import { PersonalInfoSection } from "./PersonalInfoSection";
import { SportProfileSection } from "./SportProfileSection";
import { NotificationsSection } from "./NotificationsSection";
import { SecuritySection } from "./SecuritySection";

// Mon profil — voir design-connect-personnel-12-08/README.md § Mon profil. Header compact +
// sections éditables en modale (Informations personnelles, Profil sportif, Notifications,
// Sécurité), raccourcis réels vers Mes affiliations et Accès à mon profil, "Mes espaces"
// uniquement si un accès Club+ existe réellement (club_members, jamais un cadenas décoratif).
export default async function ProfilPage() {
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const [player, settings, clubPlus] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    getProfileSettings(supabase, user.id),
    getClubPlusAccess(supabase, user.id),
  ]);

  const identity = resolveDisplayIdentity(user, player);
  const monogram = (identity.firstName[0] || "?").toUpperCase();
  const fullName = `${identity.firstName} ${identity.lastName}`.trim() || identity.email;

  // pendingCount et grantedCount sont deux comptages indépendants (statuts différents), ni l'un
  // ni l'autre ne dépend du Promise.all ci-dessus — voir rapport fluidité perçue 15/08.
  const [{ count: pendingCount }, { count: grantedCount }] = await Promise.all([
    supabase
      .from("connect_access_relationships")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", user.id)
      .eq("status", "en_attente"),
    supabase
      .from("connect_access_relationships")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", user.id)
      .eq("status", "acceptee"),
  ]);

  const pending = pendingCount || 0;
  const granted = grantedCount || 0;
  const accesSummary =
    pending > 0
      ? `${pending} demande${pending > 1 ? "s" : ""} en attente`
      : granted > 0
        ? `${granted} personne${granted > 1 ? "s" : ""} autorisée${granted > 1 ? "s" : ""}`
        : "Personne n'a accès à votre profil";

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
        <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(130deg, rgba(168,85,247,.5), rgba(34,211,238,.24) 60%, transparent)" }}>
          <div className="flex flex-wrap items-center gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
            <span className="flex h-[60px] w-[60px] flex-none items-center justify-center rounded-full bg-sv-gradient font-sora text-[20px] font-semibold text-white">
              {monogram}
            </span>
            <div className="flex flex-col gap-1.5">
              <h1 className="font-sora text-[26px] font-bold tracking-tight">{fullName}</h1>
              {settings.sport && <span className="text-[14px] text-text-tertiary">{settings.sport}{settings.poste ? ` · ${settings.poste}` : ""}</span>}
              {player?.club ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-text-secondary">{player.club.nom}</span>
                  <span
                    className="rounded-sv-pill px-2.5 py-1 text-[12px] font-medium"
                    style={
                      player.club.status === "affilie"
                        ? { color: "#22D3EE", background: "rgba(34,211,238,.14)" }
                        : { color: "#C7C7DE", background: "rgba(255,255,255,.08)" }
                    }
                  >
                    {player.club.status === "affilie" ? "✓ Affilié" : player.club.status === "attente" ? "En attente" : "Demande refusée"}
                  </span>
                </div>
              ) : (
                <span className="text-[13px] text-text-tertiary">Aucun club associé</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <PersonalInfoSection
              firstName={identity.firstName}
              lastName={identity.lastName}
              email={identity.email}
              telephone={settings.telephone}
              playerId={player?.playerId ?? null}
              avatarUrl={settings.avatarUrl}
            />
            <SportProfileSection sport={settings.sport} poste={settings.poste} categorie={settings.categorie} ville={settings.ville} />
            <NotificationsSection
              initial={{
                notif_contenus: settings.notifContenus,
                notif_cotisations: settings.notifCotisations,
                notif_prestations: settings.notifPrestations,
                notif_messages: settings.notifMessages,
                notif_affiliations: settings.notifAffiliations,
              }}
            />
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3.5 rounded-sv-card border border-border bg-surface p-5">
              <h2 className="font-sora text-[17px] font-semibold">Mes affiliations</h2>
              {player?.club ? (
                <div className="flex items-center gap-3">
                  {player.club.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- logo club distant (bucket Storage clubplus-media), pas un asset local optimisable par next/image
                    <img
                      src={player.club.logoUrl}
                      alt={`Logo ${player.club.nom}`}
                      className="h-[42px] w-[42px] flex-none rounded-sv bg-white/5 object-cover"
                    />
                  ) : (
                    <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-sv bg-white/5 font-mono text-[7px] text-text-faint">
                      logo
                    </span>
                  )}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[14px] font-medium">{player.club.nom}</span>
                    {player.club.ville && <span className="text-[12px] text-text-tertiary">{player.club.ville}</span>}
                  </div>
                </div>
              ) : (
                <span className="text-[14px] leading-relaxed text-text-tertiary lg:text-[13px]">Aucune structure associée pour le moment.</span>
              )}
              <Link
                href="/affiliations"
                className="self-start rounded-sv border border-border-strong bg-white/[.03] px-3.5 py-2.5 font-sora text-[14px] font-semibold hover:bg-white/[.08] lg:text-[13px]"
              >
                Gérer mes affiliations
              </Link>
            </div>

            <Link
              href="/acces"
              className="flex items-center gap-3.5 rounded-sv-card border p-5 hover:bg-white/[.03]"
              style={{ borderColor: pending > 0 ? "rgba(251,191,36,.3)" : "rgba(255,255,255,.09)" }}
            >
              <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-sv bg-affiliations-bg">
                <span className="material-symbols-rounded !text-[20px] text-affiliations" aria-hidden="true">lock_person</span>
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="font-sora text-[15px] font-semibold">Accès à mon profil</span>
                <span className="text-[14px] text-text-tertiary lg:text-[13px]">{accesSummary}</span>
              </div>
              {pending > 0 && (
                <span className="ml-auto flex-none rounded-sv-pill bg-attente px-2.5 py-1 text-[11px] font-semibold text-[#0B0B18]">{pending}</span>
              )}
            </Link>

            <SecuritySection email={identity.email} />

            {clubPlus && (
              <div className="flex flex-col gap-3 rounded-sv-card border border-border bg-surface p-5">
                <h2 className="font-sora text-[17px] font-semibold">Mes espaces</h2>
                <div className="rounded-sv p-px" style={{ background: "linear-gradient(120deg,#A855F7,#4F7DFF 55%,#22D3EE)" }}>
                  <div className="flex items-center gap-2.5 rounded-[15px] bg-bg-elevated-accent px-3.5 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-sora text-[14px] font-semibold">SportVision Connect</span>
                      <span className="text-[12px] text-text-tertiary">Espace personnel · actuel</span>
                    </div>
                    <span className="material-symbols-rounded ml-auto !text-[20px] text-affiliations" aria-hidden="true">check_circle</span>
                  </div>
                </div>
                <a
                  href="https://clubplus.sportvision-an.fr/"
                  className="flex items-center gap-2.5 rounded-sv border border-border bg-white/[.03] px-3.5 py-3 hover:bg-white/[.06]"
                >
                  <span className="h-[28px] w-[28px] flex-none rounded-sv bg-white/5" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-sora text-[14px] font-semibold">{clubPlus.clubNom}</span>
                    <span className="text-[12px] text-text-tertiary">Club+ · {clubPlus.role}</span>
                  </div>
                  <span className="material-symbols-rounded ml-auto !text-[18px] text-text-tertiary" aria-hidden="true">arrow_forward</span>
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    );
}
