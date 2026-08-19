import type { ReactNode } from "react";
import { canAccess } from "@/lib/permissions";
import { formatPlanCredits, formatPlanPrice, PLANS } from "@/lib/plans";
import type { DemoProfile } from "./profiles";
import { Card, DataTable, EmptyState, LockedModule, MessageBubble, PageHeader, RowList, StatGrid } from "@/components/demo/DemoBlocks";

// Contenu statique des écrans de démo Club+, un par chemin de navigation (voir profiles.ts pour
// la liste des chemins possibles par profil). Aucune donnée réelle, aucun appel Supabase.

function ok(ctx: DemoProfile["ctx"], module: Parameters<typeof canAccess>[1]) {
  return canAccess(ctx, module);
}

function Locked(title: string) {
  return <LockedModule title={title} reason="Ce module n'est pas inclus dans l'offre ou le rôle actuellement sélectionné — cadenas identique à celui affiché dans le vrai produit." />;
}

function Dashboard(p: DemoProfile): ReactNode {
  const plan = PLANS[p.ctx.subscription.planCode];
  const isClub = p.ctx.organization.type === "club";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={`Bonjour ${p.ctx.user.firstName} 👋`} subtitle={`${p.ctx.organization.name} · ${p.ctx.membership.role}`} />
      <StatGrid
        stats={[
          { label: "Offre", value: plan.name, hint: formatPlanPrice(plan) },
          { label: "Crédits", value: formatPlanCredits(plan) },
          { label: "Contenus ce mois", value: "18" },
          { label: "Demandes en attente", value: isClub ? "2" : "1" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Derniers contenus">
          <RowList
            rows={[
              { primary: "Match vs AS Melun — Highlights", secondary: "Vidéo · U17", meta: "Hier" },
              { primary: "Portraits d'équipe — Rentrée", secondary: "Photos · Club", meta: "3 j." },
              { primary: "Interview capitaine", secondary: "Vidéo · Newsroom", meta: "5 j." },
            ]}
          />
        </Card>
        <Card title="À faire">
          <RowList
            rows={[
              { primary: "Valider la publication Instagram", badge: { label: "À valider", tone: "warning" } },
              { primary: "Demande de visuel — Affiche tournoi", badge: { label: "Nouveau", tone: "info" } },
              { primary: "Facture Août à régler", badge: { label: "En attente", tone: "neutral" } },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

function Studio(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Studio" subtitle="Créez des visuels aux couleurs du club à partir de modèles prêts à l'emploi." />
      {Locked("Studio Club+")}
    </div>
  );
}

function ListPage(title: string, subtitle: string, rows: { primary: string; secondary?: string; meta?: string; badge?: { label: string; tone?: "neutral" | "success" | "warning" | "danger" | "info" | "accent" } }[]): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <RowList rows={rows} />
      </Card>
    </div>
  );
}

function Newsroom(): ReactNode {
  return ListPage("Newsroom", "Les temps forts du club, prêts à publier.", [
    { primary: "FC Fontainebleau s'impose 3-1 face à AS Melun", secondary: "Article · U17", badge: { label: "Publié", tone: "success" } },
    { primary: "Portrait : Nathan R., capitaine des U17", secondary: "Article", badge: { label: "Brouillon", tone: "neutral" } },
    { primary: "Bilan de mi-saison", secondary: "Article · Club", badge: { label: "À valider", tone: "warning" } },
  ]);
}

function MatchCenter(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Match Center" subtitle="Résultats et informations de match, saisis par le club." />
      <Card>
        <DataTable
          columns={["Match", "Score", "Date", "Statut"]}
          rows={[
            ["FC Fontainebleau — AS Melun", "3 - 1", "17/08/2026", "Terminé"],
            ["FC Fontainebleau — US Nemours", "—", "24/08/2026", "À venir"],
            ["Stade Provins — FC Fontainebleau", "2 - 2", "10/08/2026", "Terminé"],
          ]}
        />
      </Card>
    </div>
  );
}

function Communication(p: DemoProfile): ReactNode {
  return ListPage("Communication", "Planning éditorial des publications à venir.", [
    { primary: "Annonce du prochain match", secondary: "Instagram · Prévu jeudi", badge: { label: "Planifié", tone: "info" } },
    { primary: "Récap victoire vs AS Melun", secondary: "Facebook + Instagram", badge: { label: "Publié", tone: "success" } },
    { primary: "Interview coach avant-match", secondary: "TikTok", badge: { label: "À valider", tone: "warning" } },
  ]);
}

function CommunicationCredits(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Crédits Communication" subtitle="Solde de crédits visuels du mois." />
      <StatGrid stats={[{ label: "Crédits restants", value: "27 / 40" }, { label: "Réservés", value: "3" }, { label: "Renouvellement", value: "01/09/2026" }]} />
    </div>
  );
}

function Requests(): ReactNode {
  return ListPage("Demandes", "Vos demandes de visuels et de prestations.", [
    { primary: "Affiche tournoi de rentrée", secondary: "Visuel · Urgent", badge: { label: "En cours", tone: "info" } },
    { primary: "Bannière réseaux sociaux", secondary: "Visuel", badge: { label: "Livré", tone: "success" } },
    { primary: "Montage highlights saison", secondary: "Vidéo", badge: { label: "En attente", tone: "neutral" } },
  ]);
}

function Content(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Contenus" subtitle="Médiathèque : photos, vidéos et créations du club." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {["Match vs AS Melun", "Portraits équipe", "Entraînement", "Affiche tournoi", "Interview capitaine", "Célébration but", "Séance vidéo", "Logo club HD"].map((t) => (
          <div key={t} className="flex flex-col gap-2 rounded-sv-card border border-border bg-surface p-3">
            <div className="aspect-video rounded-sv bg-surface-alt" />
            <span className="truncate text-[12.5px] font-semibold text-text">{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Calendar(): ReactNode {
  return ListPage("Calendrier", "Matchs, entraînements et tournages à venir.", [
    { primary: "FC Fontainebleau — US Nemours", secondary: "Match · 24/08 15h00", meta: "Stade Municipal" },
    { primary: "Entraînement collectif", secondary: "21/08 18h30", meta: "Terrain B" },
    { primary: "Tournage Match Center", secondary: "SportVision · 24/08 14h45", meta: "Stade Municipal" },
  ]);
}

function Teams(p: DemoProfile): ReactNode {
  const label = p.ctx.organization.type === "academy" ? "Groupes" : p.ctx.organization.type === "coach" ? "Joueurs suivis" : "Équipes";
  return ListPage(label, "Les équipes et effectifs du club.", [
    { primary: "U17", secondary: "18 joueurs", meta: "Coach : Marc D." },
    { primary: "U15", secondary: "16 joueurs", meta: "Coach : Sophie L." },
    { primary: "Seniors A", secondary: "22 joueurs", meta: "Coach : Karim B." },
  ]);
}

function TeamRequests(): ReactNode {
  return ListPage("Adhésions", "Demandes d'affiliation en attente de validation.", [
    { primary: "Lucas Martin — U17", badge: { label: "En attente", tone: "warning" } },
    { primary: "Emma Dubois — U15", badge: { label: "Acceptée", tone: "success" } },
    { primary: "Tom Richard — Seniors A", badge: { label: "En attente", tone: "warning" } },
  ]);
}

function Sponsors(): ReactNode {
  return ListPage("Sponsors", "Partenaires du club et visibilité associée.", [
    { primary: "Decathlon Fontainebleau", secondary: "Partenaire principal", badge: { label: "Actif", tone: "success" } },
    { primary: "Boulangerie Léon", secondary: "Panneau terrain", badge: { label: "Actif", tone: "success" } },
    { primary: "Garage Petit", secondary: "Maillots U17", badge: { label: "Renouvellement", tone: "warning" } },
  ]);
}

function Services(p: DemoProfile): ReactNode {
  const allowed = p.ctx.organization.type === "club" || p.ctx.organization.type === "generic";
  if (!allowed) return <div className="flex flex-col gap-5"><PageHeader title="Prestations" />{Locked("Prestations")}</div>;
  return ListPage("Prestations", "Réservations SportVision du club.", [
    { primary: "Match Complet — vs US Nemours", secondary: "24/08/2026", badge: { label: "Confirmée", tone: "success" } },
    { primary: "Séance photo trombinoscope", secondary: "02/09/2026", badge: { label: "À planifier", tone: "warning" } },
    { primary: "Montage saison U17", secondary: "Livré le 10/08", badge: { label: "Livrée", tone: "info" } },
  ]);
}

function Accompagnement(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Accompagnement" subtitle="Ce qui est inclus dans votre offre, et votre interlocuteur SportVision." />
      <Card title="Votre chargée de compte">
        <RowList rows={[{ primary: "Léa Fontaine", secondary: "chargée de compte SportVision", meta: "contact@sportvision-an.fr" }]} />
      </Card>
    </div>
  );
}

function Contracts(): ReactNode {
  return ListPage("Contrats", "Contrats en cours avec SportVision.", [
    { primary: "Contrat Club+ Performance — 12 mois", secondary: "Signé le 01/09/2025", badge: { label: "Actif", tone: "success" } },
  ]);
}

function Billing(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Factures" subtitle="Devis, contrats et factures du club." />
      <Card>
        <DataTable
          columns={["Facture", "Montant", "Échéance", "Statut"]}
          rows={[
            ["Abonnement Août 2026", "129,00 €", "05/08/2026", "Payée"],
            ["Pack Match Complet — 24/08", "160,00 €", "24/08/2026", "En attente"],
            ["Montage saison U17", "220,00 €", "10/08/2026", "Payée"],
          ]}
        />
      </Card>
    </div>
  );
}

function Users(p: DemoProfile): ReactNode {
  if (p.ctx.organization.type !== "club") return <div className="flex flex-col gap-5"><PageHeader title="Membres & accès" />{Locked("Membres & accès")}</div>;
  return ListPage("Membres & accès", "Membres ayant accès à cet espace Club+.", [
    { primary: "Camille Bernard", secondary: "Président", badge: { label: "Admin", tone: "accent" } },
    { primary: "Marc Dubois", secondary: "Éducateur U17", badge: { label: "Coach", tone: "neutral" } },
    { primary: "Sophie Laurent", secondary: "Responsable communication", badge: { label: "Communication", tone: "info" } },
  ]);
}

function Documents(): ReactNode {
  return ListPage("Documents", "Documents partagés par SportVision et le club.", [
    { primary: "Statuts du club 2026", secondary: "PDF · 1,2 Mo" },
    { primary: "Charte graphique club", secondary: "PDF · 3,4 Mo" },
    { primary: "Livrables saison U17", secondary: "ZIP · 840 Mo" },
  ]);
}

function Messages(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Messages" subtitle="Échangez avec votre interlocuteur SportVision." />
      <Card>
        <div className="flex flex-col gap-3">
          <MessageBubble from="sportvision" text="Bonjour, l'opérateur sera sur place dès 14h45 samedi pour le coup d'envoi à 15h." time="Hier, 11:42" />
          <MessageBubble from="moi" text="Parfait, merci pour l'info !" time="Hier, 11:50" />
        </div>
      </Card>
    </div>
  );
}

function Support(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Aide" subtitle="Questions fréquentes et contact SportVision." />
      <Card title="Contact">
        <RowList rows={[{ primary: "contact@sportvision-an.fr", secondary: "Réponse sous 24h ouvrées" }]} />
      </Card>
    </div>
  );
}

function SettingsProfile(p: DemoProfile): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Paramètres" subtitle="Profil, organisation et intégrations." />
      <Card title="Mon profil">
        <RowList rows={[{ primary: `${p.ctx.user.firstName} ${p.ctx.user.lastName}`, secondary: p.ctx.user.email, meta: p.ctx.user.jobTitle }]} />
      </Card>
    </div>
  );
}

function Validations(): ReactNode {
  return ListPage("À valider", "Publications en attente de votre validation.", [
    { primary: "Récap victoire vs AS Melun", secondary: "Instagram", badge: { label: "À valider", tone: "warning" } },
    { primary: "Interview capitaine", secondary: "TikTok", badge: { label: "À valider", tone: "warning" } },
  ]);
}

function Publications(): ReactNode {
  return ListPage("Publications", "Historique des publications réalisées.", [
    { primary: "Annonce rentrée U17", secondary: "Instagram · 12/08", badge: { label: "Publié", tone: "success" } },
    { primary: "Bilan mi-saison", secondary: "Facebook · 05/08", badge: { label: "Publié", tone: "success" } },
  ]);
}

function Presences(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Présences" subtitle="Suivi des tournages effectués sur le terrain." />
      <StatGrid stats={[{ label: "Présences ce mois", value: "2 / 5" }]} />
    </div>
  );
}

function Analytics(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Statistiques" subtitle="Portée et engagement des contenus publiés (saisie manuelle)." />
      <StatGrid stats={[{ label: "Vues ce mois", value: "12 400" }, { label: "Engagement", value: "6,8 %" }, { label: "Contenus publiés", value: "14" }]} />
    </div>
  );
}

function Reports(): ReactNode {
  return ListPage("Rapports", "Bilans mensuels envoyés par SportVision.", [
    { primary: "Rapport Juillet 2026", secondary: "PDF" },
    { primary: "Rapport Juin 2026", secondary: "PDF" },
  ]);
}

function MyCM(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Mon Community Manager" subtitle="Votre interlocuteur dédié Full Communication." />
      <Card title="Community manager">
        <RowList rows={[{ primary: "Sophie Laurent", secondary: "Community manager SportVision", meta: "Disponible 9h-18h" }]} />
      </Card>
    </div>
  );
}

function Sessions(): ReactNode {
  return ListPage("Séances", "Séances individuelles programmées.", [
    { primary: "Séance technique — Nathan R.", secondary: "21/08 17h00" },
    { primary: "Séance vidéo — analyse match", secondary: "23/08 18h00" },
  ]);
}

function Camps(): ReactNode {
  return ListPage("Stages", "Stages organisés par l'académie.", [
    { primary: "Stage vacances d'été — U13/U15", secondary: "24-28/08/2026", badge: { label: "Ouvert", tone: "success" } },
  ]);
}

function EventTimeline(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Timeline" subtitle="Checklist de préparation de l'événement." />
      <Card>
        <RowList
          rows={[
            { primary: "Confirmation des équipes", badge: { label: "Fait", tone: "success" } },
            { primary: "Plan de communication", badge: { label: "En cours", tone: "warning" } },
            { primary: "Logistique terrain", badge: { label: "À faire", tone: "neutral" } },
          ]}
        />
      </Card>
    </div>
  );
}

function Live(): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Live" subtitle="Suivi en direct de l'événement." />
      <EmptyState label="Aucun live en cours actuellement." />
    </div>
  );
}

function Events(): ReactNode {
  return ListPage("Mes événements", "Éditions organisées par la structure.", [
    { primary: "Tournoi International U15 — 2026", secondary: "6-7 septembre 2026", badge: { label: "À venir", tone: "info" } },
    { primary: "Tournoi International U15 — 2025", secondary: "Édition précédente", badge: { label: "Terminé", tone: "neutral" } },
  ]);
}

function CampSessions(): ReactNode {
  return ListPage("Mes sessions", "Sessions du stage/camp.", [
    { primary: "Semaine 1 — U13/U15", secondary: "24-28/08/2026", badge: { label: "Complet", tone: "success" } },
    { primary: "Semaine 2 — U9/U11", secondary: "31/08-04/09/2026", badge: { label: "Places disponibles", tone: "info" } },
  ]);
}

function Children(): ReactNode {
  return ListPage("Profils associés", "Vos enfants rattachés à cet espace.", [
    { primary: "Léo Martin", secondary: "U13 · FC Fontainebleau" },
    { primary: "Chloé Martin", secondary: "U9 · FC Fontainebleau" },
  ]);
}

function Authorizations(): ReactNode {
  return ListPage("Autorisations", "Droits accordés pour vos enfants.", [
    { primary: "Léo Martin — droit à l'image", badge: { label: "Accordée", tone: "success" } },
    { primary: "Chloé Martin — droit à l'image", badge: { label: "Accordée", tone: "success" } },
  ]);
}

function Appointments(p: DemoProfile): ReactNode {
  if (p.ctx.organization.type !== "generic") return <div className="flex flex-col gap-5"><PageHeader title="Rendez-vous" />{Locked("Rendez-vous")}</div>;
  return ListPage("Rendez-vous", "Rendez-vous planifiés avec SportVision.", [
    { primary: "Cadrage besoin — visio", secondary: "20/08 10h00" },
  ]);
}

const PAGES: Record<string, (p: DemoProfile) => ReactNode> = {
  dashboard: Dashboard,
  studio: Studio,
  newsroom: Newsroom,
  matchcenter: MatchCenter,
  communication: Communication,
  "communication/credits": CommunicationCredits,
  requests: Requests,
  content: Content,
  calendar: Calendar,
  teams: Teams,
  "team-requests": TeamRequests,
  sponsors: Sponsors,
  services: Services,
  accompagnement: Accompagnement,
  contracts: Contracts,
  billing: Billing,
  users: Users,
  documents: Documents,
  messages: Messages,
  support: Support,
  settings: SettingsProfile,
  "settings/profile": SettingsProfile,
  validations: Validations,
  publications: Publications,
  presences: Presences,
  analytics: Analytics,
  reports: Reports,
  mycm: MyCM,
  sessions: Sessions,
  camps: Camps,
  eventtimeline: EventTimeline,
  live: Live,
  events: Events,
  campsessions: CampSessions,
  children: Children,
  authorizations: Authorizations,
  appointments: Appointments,
};

// Modules dont le rendu gère lui-même son propre verrou (règle métier hors canAccess générique,
// voir permissions.ts/entitlements.ts) : ne jamais appliquer le verrou générique par-dessus.
const SELF_GATED = new Set(["studio", "services", "users", "appointments"]);

export function renderDemoPage(profile: DemoProfile, path: string): ReactNode {
  const render = PAGES[path];
  if (!render) return <EmptyState label="Cet écran n'existe pas dans le produit réel." />;
  const entry = profile.nav.find((e) => e.kind === "item" && e.href === `/${path}`);
  if (!SELF_GATED.has(path) && entry && entry.kind === "item" && !ok(profile.ctx, entry.module)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={entry.label} />
        {Locked(entry.label)}
      </div>
    );
  }
  return render(profile);
}
