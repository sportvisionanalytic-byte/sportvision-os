import type { ReactNode } from "react";
import { canAccess } from "@/lib/permissions";
import { formatPlanCredits, formatPlanPrice, PLANS } from "@/lib/plans";
import type { DemoProfile } from "./profiles";
import { orgData } from "./orgs";
import { Card, DataTable, EmptyState, LockedModule, MessageBubble, PageHeader, RowList, StatGrid } from "@/components/demo/DemoBlocks";

// Contenu statique des écrans de démo Club+, un par chemin de navigation (voir profiles.ts pour
// la liste des chemins possibles par profil). Aucune donnée réelle, aucun appel Supabase.
//
// Audit du 19/08/2026 : la première version affichait un unique jeu de données (FC
// Fontainebleau) et un dashboard générique pour les 20 profils — corrigé ici en dérivant le
// contenu de chaque écran de l'organisation active (voir orgs.ts) et en reproduisant la
// segmentation réelle du dashboard (dashboard/page.tsx : Full Communication / Persona /
// ClubPlusDashboard, ce dernier lui-même différent par rôle).

function ok(ctx: DemoProfile["ctx"], module: Parameters<typeof canAccess>[1]) {
  return canAccess(ctx, module);
}

function Locked(title: string) {
  return <LockedModule title={title} reason="Ce module n'est pas inclus dans l'offre ou le rôle actuellement sélectionné — cadenas identique à celui affiché dans le vrai produit." />;
}

// ─────────────────────────────────────────── Dashboard (3 variantes réelles) ───────────────────

function Dashboard(p: DemoProfile): ReactNode {
  if (p.ctx.subscription.planCode === "full_communication") return DashboardFullCommunication(p);
  if (p.ctx.organization.type === "club") return DashboardClubPlus(p);
  return DashboardPersona(p);
}

function fullCommHero(orgType: string, orgName: string): { title: string; subtitle: string } {
  if (orgType === "coach") return { title: "Développez votre image professionnelle", subtitle: "Un aperçu de votre communication et de ce qui attend votre validation." };
  if (orgType === "academy") return { title: "Pilotez le calendrier de votre académie", subtitle: "Le calendrier éditorial et la production en cours, en un coup d'œil." };
  if (orgType === "tournament_organizer" || orgType === "camp") return { title: `${orgName} — communication de l'événement`, subtitle: "Toute la communication de l'événement, du teasing au bilan." };
  return { title: "Ce que SportVision fait pour votre structure", subtitle: "Ce qui attend votre accord, et ce qui a été fait cette semaine." };
}

function DashboardFullCommunication(p: DemoProfile): ReactNode {
  const org = orgData(p.ctx.organization.id);
  const hero = fullCommHero(p.ctx.organization.type, p.ctx.organization.name);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={hero.title} subtitle={`${p.ctx.organization.name} · ${hero.subtitle}`} />
      <StatGrid
        stats={[
          { label: "À valider", value: "2" },
          { label: "Publications cette semaine", value: "4" },
          { label: "Présences ce mois", value: "2 / 5" },
          { label: "Prochain rapport", value: "01/09" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Votre Community Manager">
          {/* Un seul interlocuteur ici (audit du 19/08 : afficher aussi org.contactName, la
              chargée de compte, faisait croire à deux CM sans rôle distinct) — la chargée de
              compte reste visible séparément dans Accompagnement. */}
          <RowList rows={[{ primary: "Sophie Laurent", secondary: "Community Manager SportVision" }]} />
        </Card>
        <Card title="Derniers contenus">
          {org.content.length > 0 ? <RowList rows={org.content.slice(0, 3).map((c) => ({ primary: c.title, secondary: c.kind }))} /> : <EmptyState label="Aucun contenu pour le moment." />}
        </Card>
      </div>
    </div>
  );
}

// Correction du 2e audit (19/08/2026) : Communication/Directeur sportif/Secrétaire/Administratif
// recevaient encore le même dashboard générique que l'Admin (crédits/contenus/facture Instagram),
// alors que leur navigation, elle, est déjà spécifique à leur rôle (filterClubRoleNav). Chaque
// rôle a maintenant ses propres statistiques et sa propre liste "à faire", cohérentes avec CE
// QU'IL VOIT dans sa navigation — jamais une carte pointant vers un module absent de son menu.
function DashboardClubPlus(p: DemoProfile): ReactNode {
  const plan = PLANS[p.ctx.subscription.planCode];
  const role = p.ctx.membership.role;
  const org = orgData(p.ctx.organization.id);
  const header = <PageHeader title={`Bonjour ${p.ctx.user.firstName} 👋`} subtitle={`${p.ctx.organization.name} · ${p.ctx.user.jobTitle ?? role}`} />;

  if (role === "treasurer") {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <StatGrid stats={[{ label: "Offre", value: plan.name, hint: formatPlanPrice(plan) }, { label: "Factures en attente", value: "1" }, { label: "Contrat", value: "Actif" }]} />
        <Card title="À faire">
          <RowList rows={[{ primary: "Facture Août à régler", badge: { label: "En attente", tone: "neutral" } }, { primary: "Prochaine échéance", secondary: "05/09/2026" }]} />
        </Card>
      </div>
    );
  }

  if (role === "coach" || role === "sports_director") {
    const isDirector = role === "sports_director";
    return (
      <div className="flex flex-col gap-5">
        {header}
        <StatGrid
          stats={[
            { label: isDirector ? "Équipes suivies" : "Mon équipe", value: isDirector ? String(org.teams.length) : "U17" },
            { label: "Affiliations en attente", value: "2" },
            { label: "Prochain match", value: "24/08" },
            { label: "Résultats manquants", value: "1" },
          ]}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="À faire">
            <RowList
              rows={[
                { primary: "Résultat à saisir — FC Fontainebleau vs US Nemours", badge: { label: "À faire", tone: "warning" } },
                ...(isDirector ? [{ primary: "Résultat U15 à vérifier", badge: { label: "À vérifier" as const, tone: "info" as const } }] : []),
              ]}
            />
          </Card>
          <Card title="Prestations prévues">
            <RowList rows={[{ primary: "Match Complet — vs US Nemours", secondary: "24/08/2026" }]} />
          </Card>
        </div>
      </div>
    );
  }

  if (role === "communication_manager" || role === "external_cm") {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <StatGrid stats={[{ label: "Crédits disponibles", value: "27 / 40" }, { label: "Demandes en cours", value: "2" }, { label: "Publications à préparer", value: "3" }, { label: "Résultats reçus", value: "2" }]} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Calendrier éditorial">
            {org.content.length > 0 ? <RowList rows={org.content.slice(0, 3).map((c) => ({ primary: c.title, secondary: c.kind }))} /> : <EmptyState label="Aucun contenu pour le moment." />}
          </Card>
          <Card title="Informations reçues des coachs">
            <RowList rows={[{ primary: "Résultat FC Fontainebleau vs AS Melun", secondary: "3 - 1, transmis par Marc D." }]} />
          </Card>
        </div>
      </div>
    );
  }

  if (role === "secretary") {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <StatGrid stats={[{ label: "Affiliations en attente", value: "2" }, { label: "Documents récents", value: "3" }, { label: "Demandes en cours", value: "1" }]} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Affiliations en attente">
            <RowList rows={[{ primary: "Lucas Martin — U17", badge: { label: "En attente", tone: "warning" } }, { primary: "Tom Richard — Seniors A", badge: { label: "En attente", tone: "warning" } }]} />
          </Card>
          <Card title="À venir">
            {org.calendar.length > 0 ? <RowList rows={org.calendar.slice(0, 2)} /> : <EmptyState label="Rien de prévu pour le moment." />}
          </Card>
        </div>
      </div>
    );
  }

  if (role === "admin_staff") {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <StatGrid stats={[{ label: "Demandes en cours", value: "1" }, { label: "Documents récents", value: "3" }]} />
        <Card title="À faire">
          <RowList rows={[{ primary: "Demande administrative — SportVision", badge: { label: "En cours", tone: "info" } }]} />
        </Card>
      </div>
    );
  }

  // admin/president/board_member/sponsor_manager/viewer : vision large (Bible §6), inchangée.
  return (
    <div className="flex flex-col gap-5">
      {header}
      <StatGrid
        stats={[
          { label: "Offre", value: plan.name, hint: formatPlanPrice(plan) },
          { label: "Crédits", value: formatPlanCredits(plan) },
          { label: "Contenus ce mois", value: String(org.content.length) },
          { label: "Demandes en attente", value: "2" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Derniers contenus">
          {org.content.length > 0 ? <RowList rows={org.content.slice(0, 3).map((c) => ({ primary: c.title, secondary: c.kind }))} /> : <EmptyState label="Aucun contenu pour le moment." />}
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

function personaHero(orgType: string, orgName: string, firstName: string): { title: string; subtitle: string } {
  if (orgType === "coach") return { title: `Bonjour ${firstName} 👋`, subtitle: "Vos joueurs suivis, vos contenus et vos prestations SportVision." };
  if (orgType === "academy") return { title: orgName, subtitle: "Groupes, stages et contenus de l'académie." };
  if (orgType === "tournament_organizer") return { title: orgName, subtitle: "Votre événement, sa communication et sa prestation SportVision." };
  if (orgType === "camp") return { title: orgName, subtitle: "Votre stage, ses sessions et sa prestation SportVision." };
  if (orgType === "sponsor") return { title: `${orgName} — espace partenaire`, subtitle: "Votre visibilité et vos contenus sponsorisés." };
  if (orgType === "cm_agency") return { title: orgName, subtitle: "Les clubs que vous accompagnez." };
  if (orgType === "parent") return { title: orgName, subtitle: "Les profils de vos enfants et leurs autorisations." };
  return { title: orgName, subtitle: "Votre prestation SportVision en cours." };
}

function DashboardPersona(p: DemoProfile): ReactNode {
  const org = orgData(p.ctx.organization.id);
  const hero = personaHero(p.ctx.organization.type, p.ctx.organization.name, p.ctx.user.firstName);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={hero.title} subtitle={hero.subtitle} />
      <StatGrid
        stats={[
          { label: "Contenus", value: String(org.content.length) },
          { label: "Prochain événement", value: org.calendar[0]?.secondary?.split(" ")?.[0] ?? "—" },
          { label: "Factures en attente", value: String(org.invoices.filter((i) => i.status === "En attente").length) },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Derniers contenus">
          {org.content.length > 0 ? <RowList rows={org.content.slice(0, 3).map((c) => ({ primary: c.title, secondary: c.kind }))} /> : <EmptyState label="Aucun contenu pour le moment." />}
        </Card>
        <Card title="À venir">
          {org.calendar.length > 0 ? <RowList rows={org.calendar.map((c) => ({ primary: c.primary, secondary: c.secondary, meta: c.meta }))} /> : <EmptyState label="Rien de prévu pour le moment." />}
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
  // Réservé au type "club" dans la vraie navigation (jamais montré à un coach/académie/
  // tournoi/stage) — FC Fontainebleau en dur est donc légitime ici, pas un bug de partage.
  return ListPage("Newsroom", "Les temps forts du club, prêts à publier.", [
    { primary: "FC Fontainebleau s'impose 3-1 face à AS Melun", secondary: "Article · U17", badge: { label: "Publié", tone: "success" } },
    { primary: "Portrait : Nathan R., capitaine des U17", secondary: "Article", badge: { label: "Brouillon", tone: "neutral" } },
    { primary: "Bilan de mi-saison", secondary: "Article · Club", badge: { label: "À valider", tone: "warning" } },
  ]);
}

function MatchCenter(): ReactNode {
  // Idem Newsroom : réservé au type "club" dans la vraie navigation.
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
  const org = orgData(p.ctx.organization.id);
  const rows = org.content.slice(0, 3).map((c, i) => ({
    primary: c.title,
    secondary: i === 0 ? "Instagram · Prévu jeudi" : i === 1 ? "Facebook + Instagram" : "TikTok",
    badge: i === 0 ? { label: "Planifié" as const, tone: "info" as const } : i === 1 ? { label: "Publié" as const, tone: "success" as const } : { label: "À valider" as const, tone: "warning" as const },
  }));
  return ListPage("Communication", `Planning éditorial de ${p.ctx.organization.name}.`, rows);
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

function Content(p: DemoProfile): ReactNode {
  const org = orgData(p.ctx.organization.id);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Contenus" subtitle={`Médiathèque de ${p.ctx.organization.name}.`} />
      {org.content.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {org.content.map((c) => (
            <div key={c.title} className="flex flex-col gap-2 rounded-sv-card border border-border bg-surface p-3">
              <div className="aspect-video rounded-sv bg-surface-alt" />
              <span className="truncate text-[12.5px] font-semibold text-text">{c.title}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState label="Aucun contenu pour le moment." />
      )}
    </div>
  );
}

function Calendar(p: DemoProfile): ReactNode {
  const org = orgData(p.ctx.organization.id);
  return ListPage("Calendrier", `Événements à venir pour ${p.ctx.organization.name}.`, org.calendar);
}

function Teams(p: DemoProfile): ReactNode {
  const org = orgData(p.ctx.organization.id);
  const label = p.ctx.organization.type === "academy" ? "Groupes" : p.ctx.organization.type === "coach" ? "Joueurs suivis" : p.ctx.organization.type === "cm_agency" ? "Clubs suivis" : "Équipes";
  if (org.teams.length === 0) return <div className="flex flex-col gap-5"><PageHeader title={label} /><EmptyState label="Aucune équipe pour le moment." /></div>;
  return ListPage(label, `${label} de ${p.ctx.organization.name}.`, org.teams);
}

function TeamRequests(): ReactNode {
  // "Affiliations" partout (audit démo du 19/08/2026 : navigation.ts utilisait 3 libellés
  // différents — "Adhésions"/"Joueurs & affiliations"/"Affiliations" — pour cette même page,
  // corrigé aussi côté vrai produit, voir navigation.ts).
  return ListPage("Affiliations", "Demandes d'affiliation en attente de validation.", [
    { primary: "Lucas Martin — U17", badge: { label: "En attente", tone: "warning" } },
    { primary: "Emma Dubois — U15", badge: { label: "Acceptée", tone: "success" } },
    { primary: "Tom Richard — Seniors A", badge: { label: "En attente", tone: "warning" } },
  ]);
}

function Sponsors(p: DemoProfile): ReactNode {
  // Un sponsor ne voit QUE son propre partenariat (vérifié dans le vrai code : PartnerView /
  // fetchSponsorPartnerships filtre par sponsor_organization_id, doublé par une policy RLS
  // csp_sponsor_org_select — la première version de cette démo montrait à tort les 3 sponsors
  // du club à Decathlon, un artefact de démo, pas un vrai bug de fuite de données).
  if (p.ctx.organization.type === "sponsor") {
    return ListPage("Ma visibilité", "Votre partenariat avec FC Fontainebleau.", [
      { primary: p.ctx.organization.name, secondary: "Partenaire principal", badge: { label: "Actif", tone: "success" } },
    ]);
  }
  return ListPage("Sponsors", "Partenaires du club et visibilité associée.", [
    { primary: "Decathlon Fontainebleau", secondary: "Partenaire principal", badge: { label: "Actif", tone: "success" } },
    { primary: "Boulangerie Léon", secondary: "Panneau terrain", badge: { label: "Actif", tone: "success" } },
    { primary: "Garage Petit", secondary: "Maillots U17", badge: { label: "Renouvellement", tone: "warning" } },
  ]);
}

function Services(p: DemoProfile): ReactNode {
  // Miroir du vrai gate (services/page.tsx) après correction du 19/08/2026 : club/generic/
  // tournament_organizer/camp voient le module, les autres restent verrouillés (voir le rapport
  // d'audit — "Ma prestation" menait auparavant à un cadenas pour sa propre persona, un vrai bug
  // produit, pas un artefact de démo).
  const allowed = ["club", "generic", "tournament_organizer", "camp"].includes(p.ctx.organization.type);
  if (!allowed) return <div className="flex flex-col gap-5"><PageHeader title="Prestations" />{Locked("Prestations")}</div>;
  const org = orgData(p.ctx.organization.id);
  const title = p.ctx.organization.type === "club" ? "Prestations" : "Ma prestation";
  // Statut OPÉRATIONNEL (confirmée/à planifier), jamais le statut de paiement de la facture
  // correspondante (audit du 19/08 : "Pack Match Complet — En attente" laissait croire à tort
  // que la prestation elle-même était en attente, alors que c'était son paiement — voir Billing()
  // pour le statut financier, distinct).
  return ListPage(
    title,
    `Réservations SportVision de ${p.ctx.organization.name}.`,
    org.invoices.map((i) => ({
      primary: i.label,
      secondary: i.due,
      badge: i.status === "Payée" ? { label: "Confirmée", tone: "success" as const } : { label: "À planifier", tone: "info" as const },
    })),
  );
}

function Accompagnement(p: DemoProfile): ReactNode {
  const org = orgData(p.ctx.organization.id);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Accompagnement" subtitle="Ce qui est inclus dans votre offre, et votre interlocuteur SportVision." />
      <Card title="Votre chargée de compte">
        <RowList rows={[{ primary: org.contactName, secondary: "chargée de compte SportVision", meta: "contact@sportvision-an.fr" }]} />
      </Card>
    </div>
  );
}

function Contracts(p: DemoProfile): ReactNode {
  const plan = PLANS[p.ctx.subscription.planCode];
  return ListPage("Contrats", "Contrats en cours avec SportVision.", [
    { primary: `Contrat ${plan.name} — 12 mois`, secondary: "Signé le 01/09/2025", badge: { label: "Actif", tone: "success" } },
  ]);
}

function Billing(p: DemoProfile): ReactNode {
  const org = orgData(p.ctx.organization.id);
  const isFullComm = p.ctx.subscription.planCode === "full_communication";
  // Correction du 19/08/2026 : la démo affichait auparavant une fausse ligne "Abonnement Club+
  // Performance 129 €" même pour un profil Full Communication — incohérent avec la page vitrine
  // ("Club+ est inclus dans Full Communication sans coût supplémentaire"). Miroir d'un vrai bug
  // produit trouvé le même jour (ClubSubscriptionCard lit clubs.plan, jamais mis à jour au
  // passage en Full Communication — voir le correctif réel dans billing/page.tsx).
  const rows = isFullComm ? org.invoices.filter((i) => !i.label.toLowerCase().includes("abonnement")) : org.invoices;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Factures"
        subtitle={isFullComm ? "Full Communication est inclus dans votre contrat, sans abonnement Club+ séparé — voir Contrats." : `Devis, contrats et factures de ${p.ctx.organization.name}.`}
      />
      <Card>
        {rows.length > 0 ? (
          <DataTable
            columns={["N°", "Facture", "Montant", "Échéance", "Statut"]}
            rows={rows.map((r, i) => [`FAC-2026-${String(i + 1).padStart(4, "0")}`, r.label, r.amount, r.due, r.status])}
          />
        ) : (
          <EmptyState label="Aucune facture pour le moment." />
        )}
      </Card>
    </div>
  );
}

function Users(p: DemoProfile): ReactNode {
  if (p.ctx.organization.type !== "club") return <div className="flex flex-col gap-5"><PageHeader title="Membres & accès" />{Locked("Membres & accès")}</div>;
  const plan = PLANS[p.ctx.subscription.planCode];
  const quota = plan.maxUsers ? `3 / ${plan.maxUsers} utilisateurs` : "3 utilisateurs · illimité";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Membres & accès" subtitle={`Membres ayant accès à cet espace Club+ — ${quota}.`} />
      <Card>
        <RowList
          rows={[
            { primary: "Camille Bernard", secondary: "Président · Toute la structure", badge: { label: "Admin", tone: "accent" } },
            { primary: "Marc Dubois", secondary: "Éducateur · Équipe U17", badge: { label: "Coach", tone: "neutral" } },
            { primary: "Sophie Laurent", secondary: "Communication · Toute la structure", badge: { label: "Communication", tone: "info" } },
          ]}
        />
      </Card>
    </div>
  );
}

const DOCUMENTS_BY_TYPE: Record<string, { primary: string; secondary?: string }[]> = {
  club: [
    { primary: "Statuts du club 2026", secondary: "PDF · 1,2 Mo" },
    { primary: "Charte graphique club", secondary: "PDF · 3,4 Mo" },
    { primary: "Livrables saison U17", secondary: "ZIP · 840 Mo" },
  ],
  tournament_organizer: [
    { primary: "Devis signé — édition 2026", secondary: "PDF · 0,3 Mo" },
    { primary: "Brief couverture événement", secondary: "PDF · 0,8 Mo" },
    { primary: "Planning tournoi", secondary: "PDF · 0,2 Mo" },
  ],
  camp: [
    { primary: "Devis signé — Semaine 1", secondary: "PDF · 0,3 Mo" },
    { primary: "Brief couverture stage", secondary: "PDF · 0,6 Mo" },
    { primary: "Planning des sessions", secondary: "PDF · 0,2 Mo" },
  ],
  generic: [
    { primary: "Devis signé — séance photo", secondary: "PDF · 0,3 Mo" },
    { primary: "Facture #1842", secondary: "PDF · 0,2 Mo" },
  ],
};

function Documents(p: DemoProfile): ReactNode {
  const rows = DOCUMENTS_BY_TYPE[p.ctx.organization.type] ?? DOCUMENTS_BY_TYPE.club!;
  return ListPage("Documents", `Documents partagés par SportVision et ${p.ctx.organization.name}.`, rows);
}

function Messages(p: DemoProfile): ReactNode {
  const org = orgData(p.ctx.organization.id);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Messages" subtitle={`Échangez avec ${org.contactName}, votre interlocuteur SportVision.`} />
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

function Validations(p: DemoProfile): ReactNode {
  const org = orgData(p.ctx.organization.id);
  const rows = org.content.slice(0, 2).map((c, i) => ({ primary: c.title, secondary: i === 0 ? "Instagram" : "TikTok", badge: { label: "À valider" as const, tone: "warning" as const } }));
  return ListPage("À valider", "Publications en attente de votre validation.", rows.length > 0 ? rows : [{ primary: "Rien à valider pour le moment", badge: { label: "À jour", tone: "success" as const } }]);
}

function Publications(p: DemoProfile): ReactNode {
  const org = orgData(p.ctx.organization.id);
  const rows = org.content.slice(0, 2).map((c, i) => ({ primary: c.title, secondary: i === 0 ? "Instagram · 12/08" : "Facebook · 05/08", badge: { label: "Publié" as const, tone: "success" as const } }));
  return ListPage("Publications", "Historique des publications réalisées.", rows);
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
  // Wording aligné sur le vrai mycm/page.tsx (audit du 19/08/2026 : ma démo avait inventé
  // "interlocuteur dédié" et "Disponible 9h-18h", absents du vrai produit — qui affiche
  // seulement cm.levelLabel ou, à défaut, "Community Manager SportVision").
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Mon Community Manager" subtitle="Comment travailler ensemble." />
      <Card title="Votre Community Manager">
        <RowList rows={[{ primary: "Sophie Laurent", secondary: "Community Manager SportVision" }]} />
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
  return ListPage("Rendez-vous", "Rendez-vous planifiés avec SportVision.", [{ primary: "Cadrage besoin — visio", secondary: "20/08 10h00" }]);
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
