import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { ReconnaissanceView } from "@/app/particulier/sportifs/[kind]/[id]/reconnaissance/ReconnaissanceView";
import type { AthleteDetail } from "@/app/particulier/sportifs/[kind]/[id]/AthleteDetailView";
import type { EtatConsentement } from "@/lib/supabase/reconnaissance";

// Le joueur donne lui-même son accord à la reconnaissance (21/09/2026).
//
// Fouka : « pour un joueur majeur, ils donnent leur accord eux-mêmes. » Jusqu'ici, seul un parent
// pouvait le faire depuis la fiche de son enfant — un senior de 25 ans n'avait donc aucun moyen
// d'activer l'option, alors que la base le lui permet depuis le 12/09.
//
// MÊME ÉCRAN QUE LE PARENT, volontairement : le texte accepté doit être le même pour tout le monde,
// et sa version part avec chaque accord. Deux écrans séparés finiraient par dire deux choses
// différentes du même engagement, et on ne saurait plus lequel a été accepté.
//
// L'ÂGE N'EST PAS TESTÉ ICI : c'est la base qui décide (majeur et 15-17 ans consentent seuls,
// avant 15 ans le refus explique d'inviter son parent). Reproduire cette règle à l'écran, ce
// serait se donner rendez-vous avec le jour où les deux ne diront plus la même chose.
export default async function ReconnaissanceJoueurPage() {
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);
  const player = await buildPlayerContext(supabase, user.id);

  // Sans club ni fiche joueur, il n'existe aucune galerie où être retrouvé.
  if (!player?.playerId) notFound();
  if (!player.club) redirect("/dashboard");

  const { data: etat } = await supabase.rpc("mon_consentement_biometrie", { p_player_id: player.playerId });

  // La vue attend une fiche de sportif : on lui donne celle du joueur connecté, sans requête de
  // plus — elle n'utilise que le prénom et l'identifiant.
  const detail = {
    kind: "club",
    ref_id: player.playerId,
    first_name: player.firstName || "vous",
    last_name: player.lastName || "",
  } as AthleteDetail;

  return (
    <ReconnaissanceView
      detail={detail}
      etatInitial={(etat as EtatConsentement | null) ?? null}
      pourMoi
      retourHref="/photos"
    />
  );
}
