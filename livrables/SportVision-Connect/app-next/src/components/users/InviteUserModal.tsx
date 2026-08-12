"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { MembershipRole } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/types/settings";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// Modale « Inviter un utilisateur » — voir ACTIONS.md § 5 (action rapide « Inviter un
// utilisateur ») et README.md § Sécurité (rôle attribué à l'invitation, non modifiable par
// l'invité — voir DATA_MODEL.md § Membership).
interface InviteUserModalProps {
  roles: MembershipRole[];
  onClose: () => void;
  onInvite: (input: { email: string; firstName: string; lastName: string; role: MembershipRole; team?: string }) => Promise<unknown>;
}

// Rôles pour qui l'équipe/catégorie a un sens réel (§7.1 : "équipe/catégorie facultative" dans le
// formulaire d'invitation, utile pour cibler qui suit quoi — voir §14, "Lecture ciblée" pour
// l'éducateur). Affiché aussi pour le responsable d'équipe, cohérent avec son rôle.
const TEAM_AWARE_ROLES = new Set<MembershipRole>(["coach", "team_manager"]);

export function InviteUserModal({ roles, onClose, onInvite }: InviteUserModalProps) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<MembershipRole>(roles[0] ?? "viewer");
  const [team, setTeam] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = /\S+@\S+\.\S+/.test(email) && firstName.trim().length > 0 && lastName.trim().length > 0;

  function handleSubmit() {
    setSubmitting(true);
    setError(null);
    onInvite({ email, firstName, lastName, role, team: TEAM_AWARE_ROLES.has(role) ? team : undefined })
      .then(() => onClose())
      .catch((err) => {
        setSubmitting(false);
        setError(err instanceof Error ? err.message : "Envoi de l'invitation impossible, réessayez.");
      });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
      <Card className="animate-svfade relative flex w-full max-w-[420px] flex-col gap-4 rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h2 className="text-[19px] font-extrabold tracking-tight">Inviter un utilisateur</h2>
        <p className="text-[12.5px] text-text-soft">L&apos;invitation est valable 7 jours. Le rôle n&apos;est pas modifiable par l&apos;invité.</p>

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
            Envoyer l&apos;invitation
          </Button>
        </div>
      </Card>
    </div>
  );
}
