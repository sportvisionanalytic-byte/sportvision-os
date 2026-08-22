"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Team } from "@/lib/types/teams";
import type { FamilyInviteTargetType } from "@/lib/data/club/family-invites";

// Modale « Inviter un joueur / un parent » — portage de club-gestion-joueurs-familles.js
// (inviteModalHtml) dans la nouvelle Club+, même patron visuel que InviteUserModal.tsx.
interface InviteFamilyModalProps {
  targetType: FamilyInviteTargetType;
  teams: Team[];
  onClose: () => void;
  onInvite: (input: { email: string; firstName: string; lastName: string; teamId?: string; dateNaissance?: string }) => Promise<{ alreadyInvited: boolean }>;
}

export function InviteFamilyModal({ targetType, teams, onClose, onInvite }: InviteFamilyModalProps) {
  const isJoueur = targetType === "joueur";
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [dateNaissance, setDateNaissance] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; alreadyInvited: boolean } | null>(null);

  const canSubmit =
    /\S+@\S+\.\S+/.test(email) && firstName.trim().length > 0 && (!isJoueur || (teamId.length > 0 && dateNaissance.length > 0));

  function handleSubmit() {
    setSubmitting(true);
    setError(null);
    onInvite({ email, firstName, lastName, teamId: isJoueur ? teamId : undefined, dateNaissance: isJoueur ? dateNaissance : undefined })
      .then(({ alreadyInvited }) => setSent({ email, alreadyInvited }))
      .catch((err) => setError(err instanceof Error ? err.message : "Envoi de l'invitation impossible, réessayez."))
      .finally(() => setSubmitting(false));
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

        {sent ? (
          <>
            <h2 className="text-[19px] font-extrabold tracking-tight">
              {sent.alreadyInvited ? "Invitation déjà en attente" : "Invitation envoyée"}
            </h2>
            <p className="text-[13px] text-text-soft">
              {sent.alreadyInvited
                ? `${sent.email} a déjà une invitation en attente.`
                : `${sent.email} va recevoir un e-mail pour créer son espace SportVision Connect.`}
            </p>
            <div className="mt-1 flex justify-end">
              <Button onClick={onClose}>Fermer</Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[19px] font-extrabold tracking-tight">Inviter un {isJoueur ? "joueur" : "parent"}</h2>
            <p className="text-[12.5px] text-text-soft">
              {isJoueur ? "Le joueur" : "Le parent"} reçoit un e-mail pour créer son espace SportVision Connect.
            </p>

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
                placeholder={isJoueur ? "joueur@exemple.fr" : "parent@exemple.fr"}
              />
            </label>

            {isJoueur && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-bold text-text-soft">Équipe</span>
                  {teams.length > 0 ? (
                    <select
                      value={teamId}
                      onChange={(e) => setTeamId(e.target.value)}
                      className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue"
                    >
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[12px] text-text-faint">Créez d&apos;abord une équipe.</span>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-bold text-text-soft">Date de naissance</span>
                  <input
                    type="date"
                    value={dateNaissance}
                    onChange={(e) => setDateNaissance(e.target.value)}
                    className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue"
                  />
                </label>
              </div>
            )}

            {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}

            <div className="mt-1 flex justify-end">
              <Button disabled={!canSubmit || submitting} loading={submitting} onClick={handleSubmit}>
                Envoyer l&apos;invitation
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
