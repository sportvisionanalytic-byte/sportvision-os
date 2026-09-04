"use client";

import { useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import type { MembershipRole } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/types/settings";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useModalA11y } from "@/lib/useModalA11y";

// Résultat renvoyé par onInvite — inviteClubMember (data/club/users.ts) renvoie un mot de passe
// en mode "direct" ; les autres types d'organisation (non branchés sur une vraie edge function
// encore, voir users/page.tsx) ne renvoient rien, undefined reste géré comme un cas normal.
export interface InviteResult {
  password?: string | null;
  accountAlreadyExisted?: boolean;
  alreadyMember?: boolean;
}

// Modale « Inviter un utilisateur » — voir ACTIONS.md § 5 (action rapide « Inviter un
// utilisateur ») et README.md § Sécurité (rôle attribué à l'invitation, non modifiable par
// l'invité — voir DATA_MODEL.md § Membership).
//
// `allowDirectMode` (23/08/2026, demande Fouka) : seul un club a une edge function qui sait
// vraiment créer un compte sans e-mail (clubplus-invite, mode "direct") — les autres types
// d'organisation restent en mode e-mail uniquement, le toggle n'apparaît donc que pour eux.
interface InviteUserModalProps {
  roles: MembershipRole[];
  allowDirectMode?: boolean;
  onClose: () => void;
  onInvite: (input: {
    email: string;
    firstName: string;
    lastName: string;
    role: MembershipRole;
    team?: string;
    mode?: "email" | "direct";
  }) => Promise<InviteResult | unknown>;
}

// Rôles pour qui l'équipe/catégorie a un sens réel (§7.1 : "équipe/catégorie facultative" dans le
// formulaire d'invitation, utile pour cibler qui suit quoi — voir §14, "Lecture ciblée" pour
// l'éducateur). Affiché aussi pour le responsable d'équipe, cohérent avec son rôle.
const TEAM_AWARE_ROLES = new Set<MembershipRole>(["coach", "team_manager"]);

export function InviteUserModal({ roles, allowDirectMode, onClose, onInvite }: InviteUserModalProps) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<MembershipRole>(roles[0] ?? "viewer");
  const [team, setTeam] = useState("");
  const [mode, setMode] = useState<"email" | "direct">("email");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y(containerRef, onClose);

  const canSubmit = /\S+@\S+\.\S+/.test(email) && firstName.trim().length > 0 && lastName.trim().length > 0;

  function handleSubmit() {
    setSubmitting(true);
    setError(null);
    onInvite({ email, firstName, lastName, role, team: TEAM_AWARE_ROLES.has(role) ? team : undefined, mode })
      .then((result) => {
        const password = (result as InviteResult | undefined)?.password;
        if (mode === "direct" && password) {
          setCredentials({ password });
          setSubmitting(false);
        } else {
          onClose();
        }
      })
      .catch((err) => {
        setSubmitting(false);
        setError(err instanceof Error ? err.message : "Envoi de l'invitation impossible, réessayez.");
      });
  }

  function handleCopy() {
    if (!credentials) return;
    navigator.clipboard.writeText(`${email} / ${credentials.password}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (credentials) {
    return (
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Identifiants créés" className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
        <Card className="animate-svfade relative flex w-full max-w-[420px] flex-col gap-4 rounded-sv-modal p-6 shadow-sv-modal">
          <button
            aria-label="Fermer"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
          <h2 className="text-[19px] font-extrabold tracking-tight">Compte créé</h2>
          <p className="text-[12.5px] text-text-soft">
            Communiquez ces identifiants vous-même — ils ne seront plus affichés après la fermeture de cette fenêtre.
          </p>
          <div className="flex flex-col gap-2 rounded-xl bg-surface-sunken px-3.5 py-3 text-[13px]">
            <div>
              <span className="font-bold text-text-soft">E-mail : </span>
              {email}
            </div>
            <div>
              <span className="font-bold text-text-soft">Mot de passe : </span>
              <span className="font-mono tracking-[.04em]">{credentials.password}</span>
            </div>
          </div>
          <Button variant="secondary" onClick={handleCopy} className="gap-2">
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            {copied ? "Copié" : "Copier e-mail + mot de passe"}
          </Button>
          <div className="mt-1 flex justify-end">
            <Button onClick={onClose}>Fermer</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Inviter un utilisateur" className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
      <Card className="animate-svfade relative flex w-full max-w-[420px] flex-col gap-4 rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h2 className="text-[19px] font-extrabold tracking-tight">Inviter un utilisateur</h2>
        <p className="text-[12.5px] text-text-soft">
          {mode === "direct"
            ? "Le compte est créé immédiatement, un mot de passe vous est communiqué à transmettre vous-même."
            : "L'invitation est valable 7 jours. Le rôle n'est pas modifiable par l'invité."}
        </p>

        {allowDirectMode && (
          <div className="flex gap-2 rounded-xl bg-surface-sunken p-1">
            <button
              type="button"
              onClick={() => setMode("email")}
              className={`flex-1 rounded-lg py-2 text-[12.5px] font-bold transition-colors ${mode === "email" ? "bg-brand-blue-electric text-white" : "text-text-soft"}`}
            >
              Inviter par e-mail
            </button>
            <button
              type="button"
              onClick={() => setMode("direct")}
              className={`flex-1 rounded-lg py-2 text-[12.5px] font-bold transition-colors ${mode === "direct" ? "bg-brand-blue-electric text-white" : "text-text-soft"}`}
            >
              Créer directement
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Prénom</span>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Nom</span>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Adresse e-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
            placeholder="prenom.nom@monclub.fr"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Rôle</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as MembershipRole)}
            className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r] ?? r}
              </option>
            ))}
          </select>
        </label>

        {TEAM_AWARE_ROLES.has(role) && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Équipe / catégorie (facultatif)</span>
            <input
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="Ex. U15, Seniors A…"
              className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
            />
            <span className="text-[11.5px] text-text-faint">
              Limite ce que cette personne voit dans les prestations SportVision à son périmètre.
            </span>
          </label>
        )}

        {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}

        <div className="mt-1 flex justify-end">
          <Button disabled={!canSubmit || submitting} loading={submitting} onClick={handleSubmit}>
            {mode === "direct" ? "Créer le compte" : "Envoyer l'invitation"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
