"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

type State = "loading" | "ready" | "joined" | "error";

export function JoinGroupAction({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("loading");
  const [groupName, setGroupName] = useState("");
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On appelle directement join_user_group() : elle est idempotente (déjà membre = pas
  // d'erreur, juste already_member=true), donc pas besoin d'un aperçu séparé avant confirmation
  // — un seul aller-retour serveur, cohérent avec la copie du design ("Toute personne avec ce
  // lien peut rejoindre le groupe."). Pas d'état "busy" ici : le seul bouton de cet écran
  // ("Ouvrir le groupe") n'apparaît qu'une fois join() déjà terminé (state="joined"), donc rien
  // ne peut plus être en cours à ce moment — un busy y aurait toujours été figé à false.
  async function join() {
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("join_user_group", { p_group_id: groupId });
    if (rpcError || !data?.ok) {
      setState("error");
      setError("Ce lien de groupe n'est plus valide.");
      return;
    }
    setGroupName(data.group_name as string);
    setAlreadyMember(!!data.already_member);
    setState("joined");
  }

  useEffect(() => {
    join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "loading") {
    return <span className="text-[14px] text-text-tertiary">Vérification du lien…</span>;
  }

  if (state === "error") {
    return (
      <>
        <span className="font-sora text-[19px] font-semibold">Lien invalide</span>
        <span className="text-[14px] leading-relaxed text-text-tertiary">{error}</span>
      </>
    );
  }

  return (
    <>
      <span className="font-sora text-[19px] font-semibold">
        {alreadyMember ? `Vous faites déjà partie de ${groupName}` : `Vous avez rejoint ${groupName} 🎉`}
      </span>
      <span className="text-[14px] leading-relaxed text-text-tertiary">
        Retrouvez les membres, les paiements collectifs et les prestations de ce groupe.
      </span>
      <Button
        onClick={() => {
          router.push(`/equipes/${groupId}`);
          router.refresh();
        }}
      >
        Ouvrir le groupe
      </Button>
    </>
  );
}
