import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { AddClubForm } from "./AddClubForm";

// Ajouter mon club — pour un utilisateur DÉJÀ authentifié sans affiliation, appelée depuis les
// CTA "Ajouter mon club" du Dashboard et de Mes affiliations.
//
// Corrige un parcours cassé : ces deux CTA pointaient vers /signup/club (l'étape 4 du tunnel
// d'inscription PRÉ-compte), qui exige state.email + state.password dans le SignupContext. Ce
// state n'existe jamais pour un utilisateur déjà connecté (le mot de passe n'est jamais persisté
// en localStorage par design — voir signup-context.tsx), donc la page renvoyait systématiquement
// vers /signup — un compte déjà authentifié atterrissait sur l'écran de CRÉATION de compte, et
// en le validant, auth.signUp() échouait avec "adresse déjà utilisée". Cette page réutilise la
// même Edge Function (connect-player-onboarding, actions "join"/"declare") mais avec la session
// déjà active, sans jamais rappeler auth.signUp().
export default async function AjouterClubPage() {
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  // Multi-club (04/09/2026, décision produit Fouka) : un compte peut désormais avoir plusieurs
  // affiliations actives (buildPlayerContext/connect-player-onboarding, migration-multiclub-
  // identity.sql) — cette page ne redirige donc plus dès qu'un club existe déjà. Seul un statut
  // "refuse" sur l'affiliation active garde un sens à bloquer ici (le formulaire ci-dessous gère
  // déjà ce cas via LeaveAffiliationButton sur /affiliations), donc aucune garde supplémentaire
  // n'est nécessaire : rejoindre un second club fonctionne exactement comme le premier.

  const metaFirst = typeof user.user_metadata?.first_name === "string" ? user.user_metadata.first_name : "";
  const metaLast = typeof user.user_metadata?.last_name === "string" ? user.user_metadata.last_name : "";
  const firstName = player?.firstName || metaFirst || user.email?.split("@")[0] || "";
  const lastName = player?.lastName || metaLast || "";

  // Date de naissance déjà connue (10/09/2026, décision de Fouka) : le joueur arrivé par le QR de
  // son équipe l'avait saisie à l'inscription, et le formulaire « code d'invitation » la lui
  // redemandait à vide. Source, dans l'ordre : sa fiche joueur (player_profiles, lisible par lui
  // seul — pp_self_select), la plus récente s'il en a plusieurs ; sinon l'inscription encore en
  // attente dans ses métadonnées (sv_inscription, effacée une fois rejouée). Jamais devinée :
  // une valeur qui n'est pas une date AAAA-MM-JJ est ignorée, le champ reste à saisir.
  const { data: fiche } = await supabase
    .from("player_profiles")
    .select("date_naissance")
    .eq("user_id", user.id)
    .not("date_naissance", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const inscription = user.user_metadata?.sv_inscription as { dateNaissance?: unknown } | null | undefined;
  const dateConnue = [fiche?.date_naissance, inscription?.dateNaissance].find(
    (d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
  );
  const dateNaissance = dateConnue ?? "";

  return (
    <div className="flex max-w-[560px] flex-col gap-6 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[28px] font-bold tracking-tight">Ajouter mon club</h1>
        <p className="text-[15px] leading-relaxed text-text-tertiary">
          Recherchez votre club partenaire SportVision, ou ajoutez-le manuellement s&apos;il
          n&apos;est pas encore partenaire.
        </p>
      </div>
      <AddClubForm initialFirstName={firstName} initialLastName={lastName} initialDateNaissance={dateNaissance} />
    </div>
  );
}
