import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes } from "@/lib/supabase/particulier";
import { JoinClubForm } from "./JoinClubForm";

interface InvitePreview {
  valide: boolean;
  raison: string | null;
  club_nom: string | null;
  team_nom: string | null;
  saison: string | null;
}

const RAISON_LABEL: Record<string, string> = {
  introuvable: "Ce lien n'existe pas ou n'est plus valide.",
  inactif: "Ce lien a été désactivé par le club.",
  expire: "Ce lien a expiré.",
  epuise: "Ce lien a atteint son nombre maximal d'utilisations.",
};

// "Qui rejoint [équipe] ?" côté particulier — construit le 04/09/2026 en réponse au finding D11
// de l'audit transversal (décision produit Fouka) : un Smart Link ne doit plus jamais perdre son
// contexte pour un compte 'particulier', et rejoindre un club doit faire converger l'identité vers
// player_profiles (la personne canonique) plutôt que de créer une seconde fiche déconnectée.
// Liste les sportifs déjà suivis (linked/managed/club unifiés par connect_list_my_athletes,
// migration-connect-v79) + "Ajouter un enfant" ; la conversion réelle se fait dans
// connect_join_club_via_smart_link (migration-smartlink-particulier-convergence.sql), jamais ici.
export default async function RejoindreClubPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  await requireParticulierAccount(supabase);

  const { data } = await supabase.rpc("preview_invite_code", { p_code: code });
  const preview = (Array.isArray(data) ? data[0] : data) as InvitePreview | null;

  if (!preview?.valide) {
    return (
      <div className="flex max-w-[520px] flex-col gap-4">
        <h1 className="font-sora text-[24px] font-bold tracking-tight">Lien indisponible</h1>
        <p className="text-[14px] leading-relaxed text-text-tertiary">
          {(preview?.raison && RAISON_LABEL[preview.raison]) ?? "Ce lien n'est plus valide."}
        </p>
        <Link href="/particulier" className="self-start text-[14px] font-semibold text-affiliations hover:underline">
          Retour à l&apos;accueil
        </Link>
      </div>
    );
  }

  const athletes = await fetchMyAthletes(supabase);
  // 'linked' exclu : cette personne a son propre compte Connect et doit décider elle-même de
  // rejoindre ce club — pas quelque chose qu'un tiers qui la suit peut déclencher à sa place.
  const eligible = athletes.filter((a) => a.kind === "managed" || a.kind === "club");

  return (
    <div className="flex max-w-[560px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-[12.5px] font-bold uppercase tracking-[.1em] text-text-tertiary">Vous rejoignez</p>
        <h1 className="font-sora text-[27px] font-bold tracking-tight">{preview.club_nom}</h1>
        {preview.team_nom && <p className="text-[16px] font-bold text-text-secondary">{preview.team_nom}</p>}
        {preview.saison && <p className="text-[13px] text-text-faint">Saison {preview.saison}</p>}
      </div>
      <JoinClubForm code={code} athletes={eligible} />
    </div>
  );
}
