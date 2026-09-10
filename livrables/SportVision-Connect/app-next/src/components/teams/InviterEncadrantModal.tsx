"use client";

// Préparer un encadrant et obtenir son lien d'invitation.
//
// ── Ce que cette fenêtre ne fait pas, volontairement ──
// Elle ne crée aucun compte. Ni mot de passe, ni identifiant à transmettre. Elle enregistre une
// PERSONNE et l'accès qu'on lui destine ; c'est elle qui prendra possession de son compte, depuis
// le lien, avec l'adresse qui l'a reçu.
//
// C'est la demande de Fouka du 10/09/2026, et ce n'est pas une préférence d'ergonomie : un compte
// créé par le club serait une identité de plus pour quelqu'un qui est peut-être déjà parent d'un
// joueur et acheteur Connect. Une personne, un compte, plusieurs rôles.
//
// ── Le lien, pas l'e-mail, pour l'instant ──
// Le canal d'envoi par e-mail n'est pas encore branché sur ce nouveau modèle. Plutôt que d'afficher
// un bouton « Envoyer » qui n'enverrait rien, on donne le lien à copier — le CM le transmet par le
// canal qu'il utilise déjà avec ses coachs. Le jeton sera le même quand l'e-mail arrivera : c'est
// la même invitation, distribuée autrement.

import { useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useModalA11y } from "@/lib/useModalA11y";
import { createClient } from "@/lib/supabase/client";
import {
  buildInvitationUrl,
  marquerInvitationEnvoyee,
  messageErreurInvitation,
  preparerInvitation,
  type InvitationClub,
} from "@/lib/data/club/invitations";

/** Les rôles qu'un opérateur de club peut accorder par ce chemin. `admin` en est absent : on
 *  prépare des encadrants et des dirigeants, on ne fabrique pas d'administrateur de club — la base
 *  le refuse d'ailleurs (contrainte de `club_invitations.role`). */
const ROLES = [
  { value: "coach", label: "Coach" },
  { value: "resp_equipe", label: "Responsable d'équipe" },
  { value: "directeur_sportif", label: "Directeur sportif" },
] as const;

interface Props {
  clubId: string;
  teamName: string;
  onClose: () => void;
  onInvited: () => void;
}

export function InviterEncadrantModal({ clubId, teamName, onClose, onInvited }: Props) {
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [telephone, setTelephone] = useState("");
  const [role, setRole] = useState<string>("coach");
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InvitationClub | null>(null);
  const [copie, setCopie] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useModalA11y(ref, onClose);

  const valide = /\S+@\S+\.\S+/.test(email) && prenom.trim() && nom.trim();

  function preparer() {
    setOccupe(true);
    setErreur(null);
    const supabase = createClient();
    preparerInvitation(supabase, {
      clubId,
      email: email.trim(),
      role,
      prenom: prenom.trim(),
      nom: nom.trim(),
      telephone: telephone.trim() || undefined,
      teams: [teamName],
    })
      .then((inv) => {
        setInvitation(inv);
        onInvited();
      })
      .catch((e) => setErreur(messageErreurInvitation(e, "Impossible de préparer cette invitation.")))
      .finally(() => setOccupe(false));
  }

  function copier() {
    if (!invitation) return;
    navigator.clipboard.writeText(buildInvitationUrl(invitation.token)).then(() => {
      setCopie(true);
      setTimeout(() => setCopie(false), 1500);
      // Le lien est parti dans le presse-papier : du point de vue du club, l'invitation est
      // envoyée. On le trace ici plutôt qu'à la préparation, sinon toute personne préparée
      // apparaîtrait comme relancée sans que rien ne soit jamais transmis.
      marquerInvitationEnvoyee(createClient(), invitation.id)
        .then(onInvited)
        .catch(() => {
          /* La trace d'envoi est un confort de suivi : son échec ne doit pas masquer le lien. */
        });
    });
  }

  if (invitation) {
    const url = buildInvitationUrl(invitation.token);
    return (
      <Enveloppe refDiv={ref} titre="Invitation prête" onClose={onClose}>
        <p className="text-[12.5px] leading-relaxed text-text-soft">
          Transmettez ce lien à {invitation.prenom || "cette personne"}. Elle créera son accès
          elle-même, avec l&apos;adresse <span className="font-bold text-text">{invitation.email}</span> —
          un lien transféré à quelqu&apos;un d&apos;autre ne fonctionnera pas.
        </p>
        <div className="break-all rounded-xl bg-surface-sunken px-3.5 py-3 text-[12px] font-mono text-text-soft">
          {url}
        </div>
        <Button variant="secondary" onClick={copier} className="gap-2">
          {copie ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copie ? "Lien copié" : "Copier le lien"}
        </Button>
        <p className="text-[11.5px] text-text-faint">
          Valable 30 jours. Vous pourrez le révoquer depuis « Coachs &amp; dirigeants ».
        </p>
        <div className="flex justify-end">
          <Button onClick={onClose}>Fermer</Button>
        </div>
      </Enveloppe>
    );
  }

  return (
    <Enveloppe refDiv={ref} titre={`Inviter un encadrant — ${teamName}`} onClose={onClose}>
      <p className="text-[12.5px] text-text-soft">
        Aucun compte n&apos;est créé maintenant : la personne activera le sien depuis le lien.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Champ label="Prénom" valeur={prenom} onChange={setPrenom} />
        <Champ label="Nom" valeur={nom} onChange={setNom} />
      </div>
      <Champ label="Adresse e-mail" valeur={email} onChange={setEmail} type="email" placeholder="prenom.nom@exemple.fr" />
      <Champ label="Téléphone (facultatif)" valeur={telephone} onChange={setTelephone} type="tel" />

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-bold text-text-soft">Rôle</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-xl bg-surface-sunken px-3.5 py-2.5 text-[12.5px]">
        <span className="font-bold text-text-soft">Équipe : </span>
        <span className="font-extrabold">{teamName}</span>
      </div>

      {erreur && <p className="text-[12.5px] font-bold text-danger-fg">{erreur}</p>}

      <div className="flex justify-end">
        <Button disabled={!valide || occupe} loading={occupe} onClick={preparer}>
          Créer l&apos;invitation
        </Button>
      </div>
    </Enveloppe>
  );
}

function Champ({
  label,
  valeur,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  valeur: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      <input
        type={type}
        value={valeur}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[16px] outline-none focus-visible:border-brand-blue"
      />
    </label>
  );
}

function Enveloppe({
  refDiv,
  titre,
  onClose,
  children,
}: {
  refDiv: React.RefObject<HTMLDivElement>;
  titre: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={refDiv}
      role="dialog"
      aria-modal="true"
      aria-label={titre}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4"
    >
      <Card className="animate-svfade relative flex max-h-[90vh] w-full max-w-[440px] flex-col gap-3.5 overflow-y-auto rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <h2 className="pr-8 text-[18px] font-extrabold tracking-tight">{titre}</h2>
        {children}
      </Card>
    </div>
  );
}
