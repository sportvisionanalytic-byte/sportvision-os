// Données fictives du calendrier central — voir README.md § Fidélité et
// DATA_MODEL.md § CalendarEvent. Vue agrégée : matchs, prestations, publications, échéances.

import type { CalendarEvent } from "@/lib/types/calendar";

export const mockCalendarEvents: Record<string, CalendarEvent[]> = {
  "org-fcf": [
    { id: "cal-1", organizationId: "org-fcf", kind: "match", title: "FC Fontainebleau vs US Varenne", startsAt: "2026-08-10T15:00:00.000Z", endsAt: "2026-08-10T17:00:00.000Z", allDay: false, location: "Stade Pierre-Bardin", teamName: "Séniors A", sourceHref: "/matchcenter", status: "À venir" },
    { id: "cal-2", organizationId: "org-fcf", kind: "service", title: "Captation — Coupe du Gâtinais", startsAt: "2026-08-10T09:00:00.000Z", endsAt: "2026-08-10T13:00:00.000Z", allDay: false, location: "Complexe sportif de Nemours", sourceHref: "/services", status: "Planifiée" },
    { id: "cal-3", organizationId: "org-fcf", kind: "training", title: "Entraînement U15", startsAt: "2026-08-11T18:00:00.000Z", endsAt: "2026-08-11T19:30:00.000Z", allDay: false, location: "Stade Pierre-Bardin", teamName: "U15", status: "Confirmée" },
    { id: "cal-4", organizationId: "org-fcf", kind: "invoice_deadline", title: "Échéance — Facture SV-2026-0418", startsAt: "2026-08-05T00:00:00.000Z", allDay: true, sourceHref: "/billing", status: "En retard" },
    { id: "cal-5", organizationId: "org-fcf", kind: "contract_deadline", title: "Signature — Avenant Club+ Performance", startsAt: "2026-08-12T00:00:00.000Z", allDay: true, sourceHref: "/contracts", status: "À signer" },
    { id: "cal-6", organizationId: "org-fcf", kind: "meeting", title: "Point mensuel avec Théo Marchand", startsAt: "2026-08-14T10:00:00.000Z", endsAt: "2026-08-14T10:30:00.000Z", allDay: false, location: "Visioconférence", sourceHref: "/accompagnement", status: "Confirmée" },
    { id: "cal-7", organizationId: "org-fcf", kind: "match", title: "FC Fontainebleau vs AS Melun", startsAt: "2026-08-17T15:00:00.000Z", endsAt: "2026-08-17T17:00:00.000Z", allDay: false, location: "Stade Municipal, Melun", teamName: "Séniors A", sourceHref: "/matchcenter", status: "À venir" },
  ],
  "org-usv": [
    { id: "cal-8", organizationId: "org-usv", kind: "publication", title: "Annonce partenariat Varenne Auto", startsAt: "2026-08-10T18:00:00.000Z", allDay: false, sourceHref: "/communication", status: "Programmé" },
    { id: "cal-9", organizationId: "org-usv", kind: "shoot", title: "Tournage — Portraits de rentrée", startsAt: "2026-08-13T14:00:00.000Z", endsAt: "2026-08-13T17:00:00.000Z", allDay: false, location: "Complexe sportif, Varenne", sourceHref: "/services", status: "Planifiée" },
    { id: "cal-10", organizationId: "org-usv", kind: "match", title: "US Varenne vs ES Nemours", startsAt: "2026-08-16T15:00:00.000Z", endsAt: "2026-08-16T17:00:00.000Z", allDay: false, location: "Complexe sportif, Varenne", status: "À venir" },
  ],
  "org-lucas": [
    { id: "cal-11", organizationId: "org-lucas", kind: "match", title: "FC Fontainebleau vs US Varenne", startsAt: "2026-08-10T15:00:00.000Z", endsAt: "2026-08-10T17:00:00.000Z", allDay: false, location: "Stade Pierre-Bardin", status: "À venir" },
  ],
};
