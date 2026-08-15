import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems, ATHLETE_STATUS_LABEL, ATHLETE_STATUS_COLOR } from "@/lib/supabase/particulier";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { gradientFor } from "@/lib/avatarGradients";
import { formatDateLong } from "@/lib/prestations/format";
import type { PlayerOrder } from "@/lib/prestations/types";

// Accueil Espace particulier — voir design-connect-personnel-12-08/README.md § Espace
// particulier → Accueil. "Bonjour [Prénom]" + cartes sportifs + activité filtrée par le contexte
// actif. Le README décrit un filtrage par sportif sélectionné dans le sélecteur de contexte de
// la sidebar ; ce module affiche ici l'activité agrégée de TOUS les sportifs accessibles (chaque
// carte indique "Pour qui") plutôt que de dupliquer un état de filtrage global côté serveur —
// voir ParticularShell.tsx pour la décision documentée sur le sélecteur de contexte (navigation
// directe vers la fiche du sportif plutôt qu'un filtre in-place).
//
// Les 5 types de cartes d'activité du README (prestation, contenus, événement, cotisation,
// messages) sont TOUTES représentées ici (contenus/événement ajoutés le 14/08 — absents de la
// première passe) en réutilisant connect_list_contents_for_athletes()/
// connect_list_calendar_for_athletes(), déjà déployées et déjà appelées par /particulier/contenus
// et /particulier/calendrier : aucune nouvelle fonction, uniquement une lecture supplémentaire
// sur l'accueil.
export default async function ParticulierHomePage() {
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  // player, athletes et les 5 requêtes ci-dessous sont toutes indépendantes (aucune ne dépend
  // du résultat d'une autre — voir rapport fluidité perçue 15/08) : un seul Promise.all au lieu
  // de deux awaits séquentiels puis un groupe, pour démarrer les 7 requêtes en parallèle.
  const [player, athletes, ordersRes, fundingsRes, unreadCount, contentsRes, eventsRes] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    fetchMyAthletes(supabase).catch(() => []),
    supabase.functions.invoke("connect-player-prestations", { body: { action: "list_orders", multi: true } }),
    supabase.rpc("list_my_fundings"),
    getOwnUnreadCount(supabase, user.id),
    supabase.rpc("connect_list_contents_for_athletes"),
    supabase.rpc("connect_list_calendar_for_athletes"),
  ]);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";

  const orders = ((ordersRes.data?.orders || []) as (PlayerOrder & { forWho: string | null })[]).filter(
    (o) => !["annulée", "refusée", "annulee"].includes(o.statut),
  );
  const nextPresta = orders
    .filter((o) => o.datePrestation)
    .sort((a, b) => (a.datePrestation! < b.datePrestation! ? -1 : 1))
    .find((o) => new Date(o.datePrestation!) >= new Date(new Date().toISOString().slice(0, 10)));

  const fundings = (fundingsRes.data || []) as Array<{
    id: string;
    titre: string;
    montant_cible: number;
    montant_collecte: number;
    statut: string;
    beneficiary_label?: string | null;
  }>;
  const cotisation = fundings.find((f) => f.statut === "ouverte" || f.statut === "objectif_atteint");

  const recentContents = ((contentsRes.data || []) as Array<{
    id: string;
    title: string;
    team: string | null;
    created_at: string;
    athlete_label: string;
  }>)
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 2);

  const today = new Date().toISOString().slice(0, 10);
  const nextEvent = ((eventsRes.data || []) as Array<{
    id: string;
    title: string;
    event_date: string;
    event_time: string | null;
    location: string | null;
    athlete_label: string;
  }>)
    .filter((e) => e.event_date >= today)
    .sort((a, b) => (a.event_date < b.event_date ? -1 : 1))[0];

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <div className="flex flex-col gap-6 animate-sv-in">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[33px] font-bold tracking-tight">Bonjour {firstName} 👋</h1>
            <p className="text-[15px] text-text-tertiary">
              Retrouvez les sportifs que vous accompagnez et leurs activités SportVision.
            </p>
          </div>
          <Link
            href="/particulier/prestations"
            className="hidden h-[46px] flex-none items-center gap-2 rounded-sv bg-sv-gradient px-5 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12] lg:flex"
          >
            <span className="material-symbols-rounded !text-[20px]">add</span>
            Réserver une prestation
          </Link>
        </div>

        {athletes.length === 0 && (
          <div className="flex max-w-[600px] flex-col gap-3.5 rounded-sv-card border border-dashed border-border-strong bg-white/[.04] p-[30px]">
            <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-affiliations-bg">
              <span className="material-symbols-rounded !text-[24px] text-affiliations">group_add</span>
            </span>
            <span className="font-sora text-[20px] font-semibold">Ajoutez votre premier sportif</span>
            <p className="text-[14px] leading-relaxed text-text-tertiary">
              Reliez votre compte à un joueur qui utilise déjà Connect, ou créez un profil géré pour un enfant que vous
              accompagnez.
            </p>
            <div className="mt-0.5 flex flex-wrap gap-2.5">
              <Link href="/particulier/sportifs/ajouter" className="rounded-sv bg-sv-gradient px-[18px] py-3 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]">
                Ajouter un sportif
              </Link>
              <Link href="/particulier/prestations" className="rounded-sv border border-border-strong bg-surface px-[18px] py-3 font-sora text-[15px] font-semibold hover:bg-surface-hover">
                Réserver pour moi
              </Link>
            </div>
          </div>
        )}

        {athletes.length > 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-sora text-[20px] font-semibold tracking-tight">
                {athletes.length === 1 ? "Votre sportif" : "Vos sportifs"}
              </h2>
              <Link href="/particulier/sportifs" className="text-[13px] font-medium text-affiliations">
                Gérer mes sportifs
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {athletes.map((a) => {
                const statusColor = ATHLETE_STATUS_COLOR[a.status];
                const facts: string[] = [];
                if (a.clubNom) facts.push(a.clubNom);
                if (a.categorie) facts.push(a.categorie);
                return (
                  <Link
                    key={`${a.kind}:${a.refId}`}
                    href={`/particulier/sportifs/${a.kind}/${a.refId}`}
                    className="flex flex-col gap-[15px] rounded-sv-card border border-border bg-surface p-5 hover:bg-white/[.09]"
                  >
                    <div className="flex items-center gap-3.5">
                      <span
                        className="flex h-[54px] w-[54px] flex-none items-center justify-center rounded-sv font-sora text-[18px] font-semibold text-white"
                        style={{ background: gradientFor(`${a.kind}:${a.refId}`) }}
                      >
                        {(a.firstName[0] || "?").toUpperCase()}
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-sora text-[18px] font-semibold tracking-tight">
                          {a.firstName} {a.lastName}
                        </span>
                        {a.sport && <span className="text-[13px] text-text-tertiary">{a.sport}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[12px] font-medium text-text-secondary">
                        {a.relationLabel}
                      </span>
                      <span
                        className="rounded-sv-pill px-2.5 py-1 text-[12px] font-medium"
                        style={{ color: statusColor.fg, background: statusColor.bg }}
                      >
                        {ATHLETE_STATUS_LABEL[a.status]}
                      </span>
                    </div>
                    {facts.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        {facts.map((f) => (
                          <div key={f} className="flex items-center gap-2">
                            <span className="material-symbols-rounded !text-[16px] text-text-faint">check</span>
                            <span className="text-[13px] text-text-secondary">{f}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {athletes.length > 0 && (
          <div className="grid grid-cols-1 gap-4.5 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)] lg:items-start">
            <div className="flex flex-col gap-4.5">
              {nextPresta && (
                <Link
                  href="/particulier/commandes"
                  className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-5 hover:bg-white/[.09]"
                >
                  <span className="flex h-[50px] w-[50px] flex-none items-center justify-center rounded-sv bg-prestations-bg">
                    <span className="material-symbols-rounded !text-[23px] text-prestations">camera_alt</span>
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">
                      Prochaine prestation{nextPresta.forWho ? ` · Pour ${nextPresta.forWho}` : ""}
                    </span>
                    <span className="font-sora text-[17px] font-semibold tracking-tight">{nextPresta.offreNom || "Prestation"}</span>
                    <span className="text-[13px] text-text-tertiary">{formatDateLong(nextPresta.datePrestation)}</span>
                  </div>
                </Link>
              )}

              {recentContents.length > 0 && (
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-baseline justify-between gap-3.5">
                    <h2 className="font-sora text-[18px] font-semibold tracking-tight lg:text-[20px]">Nouveaux contenus</h2>
                    <Link href="/particulier/contenus" className="text-[13px] font-medium text-contenus">
                      Tout voir
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {recentContents.map((c) => (
                      <Link
                        key={c.id}
                        href="/particulier/contenus"
                        className="flex flex-col overflow-hidden rounded-sv-card border border-border bg-surface hover:border-[rgba(192,132,252,.45)]"
                      >
                        <div className="flex h-[130px] items-start justify-between p-3" style={{ background: "linear-gradient(135deg,#3B1E6E 0%,#22307A 55%,#0F4C63 100%)" }}>
                          <span className="rounded-sv-pill bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-bg">Pour {c.athlete_label}</span>
                        </div>
                        <div className="flex flex-col gap-1.5 p-4">
                          <span className="truncate font-sora text-[15px] font-semibold">{c.title}</span>
                          <span className="text-[12.5px] text-text-tertiary">{c.team ? `${c.team} · ` : ""}{formatDateLong(c.created_at)}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {nextEvent && (
                <Link
                  href="/particulier/calendrier"
                  className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-5 hover:bg-white/[.09]"
                >
                  <div
                    className="flex h-[54px] w-[54px] flex-none flex-col items-center justify-center rounded-sv"
                    style={{ background: "linear-gradient(150deg,rgba(79,125,255,.3),rgba(34,211,238,.14))" }}
                  >
                    <span className="font-sora text-[17px] font-bold leading-none">{new Date(`${nextEvent.event_date}T00:00:00`).getDate()}</span>
                    <span className="text-[10px] font-medium uppercase text-prestations">
                      {new Date(`${nextEvent.event_date}T00:00:00`).toLocaleDateString("fr-FR", { month: "short" })}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">
                      Prochain événement · Pour {nextEvent.athlete_label}
                    </span>
                    <span className="font-sora text-[17px] font-semibold tracking-tight">{nextEvent.title}</span>
                    <span className="text-[13px] text-text-tertiary">
                      {formatDateLong(nextEvent.event_date)}
                      {nextEvent.location ? ` · ${nextEvent.location}` : ""}
                    </span>
                  </div>
                  <span className="ml-auto flex-none rounded-sv-pill bg-prestations-bg px-2.5 py-1 text-[12px] font-medium text-prestations">
                    📸 SportVision présent
                  </span>
                </Link>
              )}
            </div>

            <div className="flex flex-col gap-4.5">
              {cotisation && (
                <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(150deg,rgba(244,114,182,.6),rgba(168,85,247,.25) 55%,transparent)" }}>
                  <div className="flex flex-col gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated-accent p-5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-sv bg-cotisations-bg">
                        <span className="material-symbols-rounded !text-[18px] text-cotisations">savings</span>
                      </span>
                      <span className="text-[11px] font-medium uppercase tracking-[.1em] text-cotisations">
                        Cotisation{cotisation.beneficiary_label ? ` · Pour ${cotisation.beneficiary_label}` : ""}
                      </span>
                    </div>
                    <span className="font-sora text-[19px] font-semibold tracking-tight">{cotisation.titre}</span>
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-baseline justify-between gap-2.5">
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-sora text-[27px] font-bold tracking-tight">{cotisation.montant_collecte} €</span>
                          <span className="text-[14px] text-text-tertiary">/ {cotisation.montant_cible} €</span>
                        </div>
                      </div>
                      <div className="h-2 overflow-hidden rounded-sv-pill bg-white/[.08]">
                        <div
                          className="h-full rounded-sv-pill bg-sv-gradient-cotisation transition-[width] duration-300 motion-reduce:transition-none"
                          style={{ width: `${Math.min(100, Math.round((cotisation.montant_collecte / cotisation.montant_cible) * 100))}%` }}
                        />
                      </div>
                    </div>
                    <Link
                      href={`/particulier/cotisations/${cotisation.id}`}
                      className="flex h-12 items-center justify-center rounded-sv border border-border-strong bg-white/5 font-sora text-[14px] font-semibold hover:bg-white/10"
                    >
                      Voir la cotisation
                    </Link>
                  </div>
                </div>
              )}

              {unreadCount > 0 && (
                <Link
                  href="/particulier/messages"
                  className="flex items-center gap-3.5 rounded-sv-card border border-border bg-surface p-4.5 hover:bg-white/[.06]"
                >
                  <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-sv bg-affiliations-bg">
                    <span className="material-symbols-rounded !text-[20px] text-affiliations">chat_bubble</span>
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-sora text-[15px] font-semibold">Messages</span>
                    <span className="text-[13px] text-text-tertiary">
                      {unreadCount} nouveau{unreadCount > 1 ? "x" : ""} message{unreadCount > 1 ? "s" : ""} SportVision
                    </span>
                  </div>
                  <span className="ml-auto flex-none text-[13px] font-medium text-affiliations">Ouvrir</span>
                </Link>
              )}

              <Link
                href="/particulier/prestations"
                className="flex items-center gap-3.5 rounded-sv-card border border-border bg-white/[.04] p-5 hover:bg-white/[.08] lg:hidden"
              >
                <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-sv bg-prestations-bg">
                  <span className="material-symbols-rounded !text-[20px] text-prestations">add</span>
                </span>
                <span className="font-sora text-[15px] font-semibold">Réserver une prestation</span>
                <span className="material-symbols-rounded ml-auto !text-[20px] text-text-label">chevron_right</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </ParticularShell>
  );
}

// Messages non lus sur le fil "Mon compte" du particulier lui-même (pas agrégé multi-sportifs —
// voir /particulier/messages pour le fil contextualisé complet). Ne force jamais la création
// d'un client_id : lit uniquement s'il existe déjà (même principe que le calendrier joueur).
async function getOwnUnreadCount(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<number> {
  const { data: ownClientId } = await supabase.rpc("connect_owner_client_id", { p_owner_user_id: userId });
  if (!ownClientId) return 0;
  const { count } = await supabase
    .from("messages_client")
    .select("id", { count: "exact", head: true })
    .eq("client_id", ownClientId)
    .eq("auteur_type", "staff")
    .eq("lu", false);
  return count || 0;
}
