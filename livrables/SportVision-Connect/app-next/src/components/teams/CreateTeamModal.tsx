"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fetchClubMembers } from "@/lib/data/club/users";
import { createClient } from "@/lib/supabase/client";
import { TEAM_CATEGORY_OPTIONS } from "@/lib/types/teams";
import type { OrgUser } from "@/lib/types/settings";

// Modale "Créer une équipe" (19/08/2026, retour utilisateur : aucune UI ne permettait de créer
// une équipe. Puis affinée le même soir : catégorie en liste déroulante (TEAM_CATEGORY_OPTIONS)
// + numéro d'équipe optionnel (club avec plusieurs équipes dans la même catégorie, ex. "U17 2"
// — mirroir du pattern "Seniors A" déjà vu dans les données de référence), name dérivé des deux
// plutôt que retapé à la main. Responsable : liste des membres déjà actifs du club (club_members
// est ce que coach lit réellement, voir data/club/teams.ts) plutôt qu'un texte libre qui peut
// diverger d'un vrai compte. Pas de "lien d'invitation à usage unique" séparé : /users a déjà un
// vrai mécanisme d'invitation par e-mail avec équipe assignée (InviteUserModal, rôle coach) —
// dupliquer cette logique ici aurait introduit un deuxième système d'invitation parallèle,
// simplement pointé vers lui si le responsable n'est pas encore dans l'effectif.
interface CreateTeamModalProps {
  clubId: string;
  onClose: () => void;
  onCreate: (input: { name: string; categorie?: string; coach?: string }) => Promise<unknown>;
}

export function CreateTeamModal({ clubId, onClose, onCreate }: CreateTeamModalProps) {
  const [categorie, setCategorie] = useState("");
  const [teamNumber, setTeamNumber] = useState("");
  const [coachMemberId, setCoachMemberId] = useState("");
  const [members, setMembers] = useState<OrgUser[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchClubMembers(createClient(), clubId)
      .then((rows) => setMembers(rows.filter((m) => m.status === "active")))
      .catch(() => setMembers([]));
  }, [clubId]);

  const canSubmit = categorie.trim().length > 0;
  const coachName = members?.find((m) => m.id === coachMemberId);

  function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const name = teamNumber ? `${categorie} ${teamNumber}` : categorie;
    const coach = coachName ? `${coachName.firstName} ${coachName.lastName}`.trim() : undefined;
    onCreate({ name, categorie, coach })
      .then(() => onClose())
      .catch(() => {
        setSubmitting(false);
        setError("Impossible de créer l'équipe. Réessayez.");
      });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
      <Card className="animate-svfade relative flex w-full max-w-[440px] flex-col gap-4 rounded-sv-modal p-6 shadow-sv-modal">
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <h2 className="text-[19px] font-extrabold tracking-tight">Créer une équipe</h2>
        <p className="-mt-2 text-[12.5px] leading-relaxed text-text-soft">
          Une fois créée, générez un code d&apos;invitation depuis sa carte pour que les joueurs la rejoignent
          directement.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Catégorie</span>
            <select value={categorie} onChange={(e) => setCategorie(e.target.value)} className={fieldClass}>
              <option value="">Sélectionner…</option>
              {TEAM_CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Équipe (optionnel)</span>
            <select value={teamNumber} onChange={(e) => setTeamNumber(e.target.value)} className={fieldClass}>
              <option value="">—</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Responsable (coach) · optionnel</span>
          <select
            value={coachMemberId}
            onChange={(e) => setCoachMemberId(e.target.value)}
            disabled={members === null}
            className={fieldClass}
          >
            <option value="">
              {members === null ? "Chargement…" : "Aucun responsable pour l'instant"}
            </option>
            {members?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName}
              </option>
            ))}
          </select>
          <span className="text-[11.5px] text-text-faint">
            Le futur coach n&apos;est pas encore dans l&apos;effectif ?{" "}
            <Link href="/users" className="font-bold text-brand-blue-electric">
              Invitez-le d&apos;abord
            </Link>
            , vous pourrez ensuite le choisir ici.
          </span>
        </label>

        {error && <p className="text-[12.5px] font-bold text-danger-fg">{error}</p>}

        <div className="mt-1 flex justify-end">
          <Button disabled={!canSubmit || submitting} loading={submitting} onClick={handleSubmit}>
            Créer l&apos;équipe
          </Button>
        </div>
      </Card>
    </div>
  );
}

const fieldClass =
  "h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";
