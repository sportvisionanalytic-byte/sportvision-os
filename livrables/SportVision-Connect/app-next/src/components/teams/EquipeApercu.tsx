"use client";

// L'aperçu d'une équipe : ce qu'il faut savoir d'elle en un coup d'œil, ce qui lui manque, et le
// geste qui le résout.
//
// Demande de Fouka, 10/09/2026 : « Afficher en priorité : l'équipe, le prochain événement, le
// droit à l'image, la communication, SportVision. Ajouter les alertes concernant cette équipe. »
// Tout vient de `equipe_apercu` (v121) : une seule lecture, contrôlée en base.

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, Check, Copy, Mail, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  fetchJetonInvitation,
  type AlerteEquipe,
  type ApercuEquipe,
  type EncadrantFiche,
  type ImageJoueur,
} from "@/lib/data/club/cockpit";
import {
  buildInvitationUrl,
  envoyerInvitationParEmail,
  marquerInvitationEnvoyee,
  messageErreurInvitation,
  revoquerInvitation,
} from "@/lib/data/club/invitations";

function dateLongue(ymd: string): string {
  const [a, m, j] = ymd.split("-").map(Number);
  if (!a || !m || !j) return ymd;
  return new Date(a, m - 1, j).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

const COUVERTURE_LB: Record<string, string> = { photo: "Photo", video: "Vidéo", photo_video: "Photo + vidéo" };

const ROLE_ENCADRANT: Record<string, string> = {
  coach: "Coach",
  resp_equipe: "Dirigeant",
  directeur_sportif: "Directeur sportif",
};

// Les statuts demandés par Fouka : Non invité, Invitation envoyée, Invitation ouverte, Compte
// activé. « Préparée » se dit « Non invité » : rien n'est encore parti vers la personne.
const STATUT_ENCADRANT: Record<EncadrantFiche["statut"], { libelle: string; tone: BadgeTone }> = {
  actif: { libelle: "Compte activé", tone: "success" },
  suspendu: { libelle: "Suspendu", tone: "neutral" },
  preparee: { libelle: "Non invité", tone: "neutral" },
  envoyee: { libelle: "Invitation envoyée", tone: "info" },
  ouverte: { libelle: "Invitation ouverte", tone: "accent" },
  expiree: { libelle: "Invitation expirée", tone: "warning" },
};

const IMAGE: Record<ImageJoueur, { libelle: string; tone: BadgeTone }> = {
  valide: { libelle: "Autorisé", tone: "success" },
  en_attente: { libelle: "En attente", tone: "warning" },
  aucune: { libelle: "Non demandé", tone: "neutral" },
  refus: { libelle: "Refus", tone: "danger" },
};

export function EquipeApercuKpis({ apercu }: { apercu: ApercuEquipe }) {
  const e = apercu.equipe;
  const di = apercu.droit_image;
  const ev = apercu.prochain_evenement;
  const pr = apercu.sportvision.prochaine_presence;
  const kpis = [
    {
      titre: "Équipe",
      valeur: `${e.joueurs} joueur${e.joueurs > 1 ? "s" : ""}`,
      detail: `${e.encadrants} encadrant${e.encadrants > 1 ? "s" : ""} connecté${e.encadrants > 1 ? "s" : ""}`,
      alerte: e.joueurs === 0,
    },
    {
      titre: "Prochain événement",
      valeur: ev ? (ev.adversaire ? `contre ${ev.adversaire}` : ev.titre ?? "Événement") : "Aucun",
      detail: ev ? `${dateLongue(ev.date_evenement)}${ev.heure_debut ? ` · ${ev.heure_debut.slice(0, 5)}` : ""}` : "dans les 60 jours",
    },
    {
      titre: "Droit à l'image",
      valeur: di.total > 0 ? `${di.valides} / ${di.total} validés` : "Pas d'effectif",
      detail: di.total > 0 ? (di.refus > 0 ? `${di.refus} refus` : `${di.en_attente} en attente`) : "rien à recueillir",
      alerte: di.total > 0 && di.valides < di.total,
    },
    {
      titre: "Communication",
      valeur: `${apercu.communication.contenus_prevus} contenu${apercu.communication.contenus_prevus > 1 ? "s" : ""} prévu${apercu.communication.contenus_prevus > 1 ? "s" : ""}`,
      detail: "sur les matchs et événements de l'équipe",
    },
    {
      titre: "SportVision",
      valeur: pr ? `Présence le ${dateLongue(pr.date).split(" ").slice(1).join(" ")}` : "Aucune présence prévue",
      detail: pr
        ? [pr.type && COUVERTURE_LB[pr.type], pr.adversaire && `contre ${pr.adversaire}`].filter(Boolean).join(" · ")
        : apercu.sportvision.souhaits > 0
          ? `${apercu.sportvision.souhaits} demande${apercu.sportvision.souhaits > 1 ? "s" : ""} en cours`
          : "",
      accent: Boolean(pr),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {kpis.map((k) => (
        <div
          key={k.titre}
          className={cn(
            "rounded-sv-card border px-4 py-3.5 shadow-sv-card",
            k.accent ? "border-brand-violet/40 bg-accent-bg" : k.alerte ? "border-warning-fg/30 bg-surface" : "border-border bg-surface",
          )}
        >
          <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[.07em] text-text-faint">
            {k.accent && <Camera className="h-3 w-3" aria-hidden />}
            {k.titre}
          </div>
          <div className={cn("mt-1 text-[15px] font-extrabold leading-tight", k.alerte && "text-warning-fg")}>{k.valeur}</div>
          {k.detail && <div className="mt-0.5 text-[11.5px] text-text-soft">{k.detail}</div>}
        </div>
      ))}
    </div>
  );
}

export function EquipeAlertes({ alertes, onAction }: { alertes: AlerteEquipe[]; onAction: (a: AlerteEquipe["action"]) => void }) {
  if (alertes.length === 0) return null;
  const LIBELLE_ACTION: Record<AlerteEquipe["action"], string> = {
    inviter_encadrant: "Inviter un encadrant",
    inviter_joueurs: "Inviter les joueurs",
    droit_image: "Voir les joueurs",
    creneaux: "Ajouter un créneau",
    demandes: "Valider",
  };
  return (
    <Card className="flex flex-col gap-1 border-warning-fg/25 p-0">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <AlertTriangle className="h-4 w-4 flex-none text-warning-fg" aria-hidden />
        <span className="text-[12px] font-extrabold uppercase tracking-[.06em]">À traiter pour cette équipe</span>
      </div>
      <ul className="divide-y divide-border">
        {alertes.map((a) => (
          <li key={a.code} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1 text-[13px] font-semibold">{a.texte}</span>
            <button type="button" onClick={() => onAction(a.action)} className="flex-none text-[12.5px] font-bold text-info-fg hover:underline">
              {LIBELLE_ACTION[a.action]} →
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Les invitations d'encadrants en cours, avec les gestes du suivi : envoyer ou relancer, copier
 *  le lien, annuler. Les comptes déjà actifs vivent dans la carte Encadrement juste au-dessus. */
export function EncadrementInvitations({
  encadrement,
  peutGerer,
  enPreparation,
  onChange,
}: {
  encadrement: EncadrantFiche[];
  peutGerer: boolean;
  enPreparation: boolean;
  onChange: () => void;
}) {
  const invitations = encadrement.filter((x) => x.source === "invitation");
  const [occupe, setOccupe] = useState<string | null>(null);
  const [copie, setCopie] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  if (invitations.length === 0) return null;

  function agir(id: string, action: () => Promise<unknown>) {
    setOccupe(id);
    setErreur(null);
    action()
      .then(onChange)
      .catch((e) => setErreur(messageErreurInvitation(e, "Action impossible.")))
      .finally(() => setOccupe(null));
  }

  function copier(id: string) {
    agir(id, async () => {
      const token = await fetchJetonInvitation(createClient(), id);
      await navigator.clipboard.writeText(buildInvitationUrl(token));
      setCopie(id);
      setTimeout(() => setCopie(null), 1500);
      // Le lien est entre les mains du club : du point de vue du suivi, l'invitation est envoyée.
      await marquerInvitationEnvoyee(createClient(), id).catch(() => undefined);
    });
  }

  return (
    <Card className="p-4.5">
      <div className="text-[14px] font-extrabold tracking-tight">Invitations d&apos;encadrants</div>
      <ul className="mt-3 flex flex-col gap-2">
        {invitations.map((x) => {
          const s = STATUT_ENCADRANT[x.statut];
          return (
            <li key={x.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{x.nom}</span>
                <span className="block truncate text-[11.5px] text-text-soft">
                  {ROLE_ENCADRANT[x.role] ?? x.role}
                  {x.email && x.email !== x.nom ? ` · ${x.email}` : ""}
                </span>
              </span>
              <Badge tone={s.tone}>{x.statut === "preparee" && enPreparation ? "Partira au lancement" : s.libelle}</Badge>
              {peutGerer && (
                <span className="flex flex-none items-center gap-2.5 text-[12px] font-bold text-text-soft">
                  <button
                    type="button"
                    disabled={occupe === x.id}
                    onClick={() => agir(x.id, () => envoyerInvitationParEmail(createClient(), x.id))}
                    className="flex items-center gap-1 hover:text-brand-blue-electric disabled:opacity-50"
                  >
                    <Mail className="h-3.5 w-3.5" aria-hidden />
                    {x.statut === "preparee" ? "Inviter" : "Renvoyer"}
                  </button>
                  <button
                    type="button"
                    disabled={occupe === x.id}
                    onClick={() => copier(x.id)}
                    className="flex items-center gap-1 hover:text-brand-blue-electric disabled:opacity-50"
                  >
                    {copie === x.id ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    {copie === x.id ? "Copié" : "Copier le lien"}
                  </button>
                  <button
                    type="button"
                    disabled={occupe === x.id}
                    onClick={() => agir(x.id, () => revoquerInvitation(createClient(), x.id))}
                    className="flex items-center gap-1 hover:text-danger-fg disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Annuler
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {erreur && <p className="mt-2 text-[12.5px] font-bold text-danger-fg">{erreur}</p>}
    </Card>
  );
}

/** Le droit à l'image d'une équipe, joueur par joueur — l'information dont SportVision a besoin
 *  pour savoir quelles photos peuvent être publiées. */
export function EquipeDroitImage({ droit, onInviter }: { droit: ApercuEquipe["droit_image"]; onInviter: () => void }) {
  const [liste, setListe] = useState(false);
  if (droit.total === 0) {
    return (
      <Card className="p-4.5">
        <div className="text-[14px] font-extrabold tracking-tight">Droit à l&apos;image</div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-text-soft">
          L&apos;effectif n&apos;est pas encore renseigné. Les autorisations se recueillent quand les joueurs et leurs parents
          rejoignent l&apos;équipe, par le lien d&apos;invitation.
        </p>
        <button type="button" onClick={onInviter} className="mt-2 text-[12.5px] font-bold text-info-fg hover:underline">
          Inviter les joueurs →
        </button>
      </Card>
    );
  }
  return (
    <Card className="p-4.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[14px] font-extrabold tracking-tight">Droit à l&apos;image</div>
        <span className={cn("text-[13px] font-extrabold tabular-nums", droit.valides < droit.total ? "text-warning-fg" : "text-success-fg")}>
          {droit.valides} / {droit.total} validés
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Badge tone="success">✓ {droit.valides} autorisé{droit.valides > 1 ? "s" : ""}</Badge>
        {droit.en_attente > 0 && <Badge tone="warning">⚠ {droit.en_attente} en attente</Badge>}
        {droit.refus > 0 && <Badge tone="danger">✕ {droit.refus} refus</Badge>}
      </div>
      <button type="button" onClick={() => setListe((v) => !v)} className="mt-2.5 text-[12.5px] font-bold text-info-fg hover:underline">
        {liste ? "Masquer les joueurs" : "Voir les joueurs concernés"}
      </button>
      {liste && (
        <ul className="mt-2 flex flex-col divide-y divide-divider">
          {[...droit.joueurs]
            .sort((a, b) => (a.image === "valide" ? 1 : 0) - (b.image === "valide" ? 1 : 0))
            .map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]">
                <span className="font-semibold">
                  {j.prenom} {j.nom}
                </span>
                <Badge tone={IMAGE[j.image].tone}>{IMAGE[j.image].libelle}</Badge>
              </li>
            ))}
        </ul>
      )}
      <p className="mt-2.5 text-[11px] text-text-faint">
        Un joueur sans autorisation validée ne doit apparaître sur aucune publication.{" "}
        <Link href="/authorizations" className="font-bold hover:underline">
          Gérer les autorisations
        </Link>
      </p>
    </Card>
  );
}
