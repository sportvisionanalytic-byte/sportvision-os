import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, getProfileSettings, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, ATHLETE_STATUS_LABEL, ATHLETE_STATUS_COLOR } from "@/lib/supabase/particulier";
import { PersonalInfoSection } from "@/app/(joueur)/profil/PersonalInfoSection";
import { NotificationsSection } from "@/app/(joueur)/profil/NotificationsSection";
import { SecuritySection } from "@/app/(joueur)/profil/SecuritySection";
import { gradientFor } from "@/lib/avatarGradients";
import { Avatar } from "@/components/ui/Avatar";

// Mon profil (variante particulier) — voir design-connect-personnel-12-08/README.md § Mon
// profil : "informations personnelles éditables, notifications, Mes sportifs, Sécurité. Pas de
// section « profil sportif »." Réutilise TELS QUELS PersonalInfoSection/NotificationsSection/
// SecuritySection (composants déjà bâtis côté Espace joueur, sans dépendance à AppShell ni à
// player_profiles au-delà d'un playerId facultatif) — seule SportProfileSection est exclue,
// conformément au README.
export default async function ProfilParticulierPage() {
  const supabase = await createClient();
  const { user, profilParticulier } = await requireParticulierAccount(supabase);

  const [player, settings, athletes] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    getProfileSettings(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
  ]);

  const identity = resolveDisplayIdentity(user, player);
  const fullName = `${identity.firstName} ${identity.lastName}`.trim() || identity.email;

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
        <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(130deg, rgba(168,85,247,.5), rgba(34,211,238,.24) 60%, transparent)" }}>
          <div className="flex flex-wrap items-center gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
            <Avatar url={settings.avatarUrl} label={identity.firstName} size={60} className="text-[20px]" />
            <div className="flex flex-col gap-1.5">
              <h1 className="font-sora text-[26px] font-bold tracking-tight">{fullName}</h1>
              <span className="text-[13px] text-text-tertiary">
                {athletes.length > 0 ? `Vous accompagnez ${athletes.length} sportif${athletes.length > 1 ? "s" : ""}` : "Espace personnel"}
              </span>
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
              isAgent={profilParticulier === "agent"}
              nomAgence={settings.nomAgence}
            />
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
              <div className="flex items-center gap-3">
                <h2 className="font-sora text-[17px] font-semibold">Mes sportifs</h2>
                <Link href="/particulier/sportifs/ajouter" className="ml-auto text-[13px] font-medium text-affiliations">
                  Ajouter
                </Link>
              </div>
              {athletes.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {athletes.slice(0, 4).map((a) => {
                    const statusColor = ATHLETE_STATUS_COLOR[a.status];
                    return (
                      <Link
                        key={`${a.kind}:${a.refId}`}
                        href={`/particulier/sportifs/${a.kind}/${a.refId}`}
                        className="flex items-center gap-3 rounded-sv px-1 py-1.5 hover:bg-white/[.04]"
                      >
                        <span
                          className="flex h-9 w-9 flex-none items-center justify-center rounded-full font-sora text-[12px] font-semibold text-white"
                          style={{ background: gradientFor(`${a.kind}:${a.refId}`) }}
                        >
                          {(a.firstName[0] || "?").toUpperCase()}
                        </span>
                        <span className="flex-1 truncate text-[14px] font-medium">{a.firstName} {a.lastName}</span>
                        <span className="flex-none rounded-sv-pill px-2 py-0.5 text-[11px] font-medium" style={{ color: statusColor.fg, background: statusColor.bg }}>
                          {ATHLETE_STATUS_LABEL[a.status]}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <span className="text-[13px] leading-relaxed text-text-tertiary">Aucun sportif ajouté pour le moment.</span>
              )}
              <Link
                href="/particulier/sportifs"
                className="self-start rounded-sv border border-border-strong bg-white/[.03] px-3.5 py-2.5 font-sora text-[13px] font-semibold hover:bg-white/[.08]"
              >
                Gérer mes sportifs
              </Link>
            </div>

            <SecuritySection email={identity.email} />
          </div>
        </div>
      </div>
    );
}
