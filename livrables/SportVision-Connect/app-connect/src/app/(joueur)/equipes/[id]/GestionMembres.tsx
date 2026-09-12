"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Sortir d'un groupe, ou en retirer quelqu'un (migration v184, 12/09/2026).
//
// Jusqu'ici on entrait dans un groupe et on n'en sortait plus : aucune policy de suppression sur
// les membres. Une personne ajoutée par erreur, ou partie du club, y restait pour toujours et
// voyait passer les cotisations. La base vérifie qui demande quoi : le créateur retire, chacun
// s'en va, et le créateur ne peut pas quitter son propre groupe.
export function BoutonQuitter({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function quitter() {
    if (!confirm("Quitter ce groupe ?\n\nVous ne verrez plus ses paiements collectifs. Vos participations déjà réglées restent acquises.")) return;
    setEnCours(true);
    setErreur(null);
    const { data, error } = await createClient().rpc("quitter_groupe", { p_group_id: groupId });
    setEnCours(false);
    if (error || !(data as { sorti?: boolean } | null)?.sorti) {
      setErreur(error?.message ?? "Vous n'avez pas pu quitter ce groupe.");
      return;
    }
    router.push("/equipes");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={() => void quitter()}
        disabled={enCours}
        className="flex h-11 items-center rounded-sv border border-border-strong bg-white/[.06] px-4 font-sora text-[14px] font-semibold hover:bg-white/[.12] disabled:opacity-50"
      >
        Quitter le groupe
      </button>
      {erreur && <span className="text-[12.5px] text-danger">{erreur}</span>}
    </div>
  );
}

export function BoutonRetirerMembre({ groupId, userId, nom }: { groupId: string; userId: string; nom: string }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);

  async function retirer() {
    if (!confirm(`Retirer ${nom} de ce groupe ?`)) return;
    setEnCours(true);
    const { error } = await createClient().rpc("exclure_du_groupe", { p_group_id: groupId, p_user_id: userId });
    setEnCours(false);
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void retirer()}
      disabled={enCours}
      className="ml-auto flex-none text-[12px] font-medium text-text-tertiary hover:text-danger disabled:opacity-50"
    >
      Retirer
    </button>
  );
}
