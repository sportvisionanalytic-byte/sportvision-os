import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// Page publique du Smart Link/QR (migration-clubplus-v57, 03/09/2026) — SANS COMPTE, même patron
// que /cotisation/[token]/page.tsx (server component, RPC lecture seule grantée à `anon`, aucune
// donnée personnelle exposée). "/join" est whitelisté dans PUBLIC_PATHS
// (src/lib/supabase/middleware.ts). Le code n'est PAS le token final consommé côté serveur : il
// est simplement transmis en clair au formulaire d'affiliation (déjà le comportement historique
// de team_invite_codes.code, pensé pour être partagé/tapé), preview_invite_code() ne révèle que
// club/équipe/saison, jamais de donnée personnelle.
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

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("preview_invite_code", { p_code: code });
  const preview = (Array.isArray(data) ? data[0] : data) as InvitePreview | null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Le compte déjà existant (le cas le plus fréquent : lien renvoyé, coach qui montre son propre
  // QR à un parent déjà inscrit) retrouve le code prérempli via /auth/login?next=... (déjà lu par
  // AddClubForm.tsx). La création de compte, elle, redirige simplement vers /signup — le tunnel
  // d'inscription multi-étapes n'a pas encore de mécanisme pour rejouer un code d'équipe après
  // confirmation d'e-mail (contrairement à "join"/"declare", voir pending-onboarding.ts) ; on
  // n'affiche donc jamais une promesse de préremplissage qu'on ne tient pas encore pour ce cas.
  const continueHref = user
    ? `/affiliations/ajouter?code=${encodeURIComponent(code)}`
    : `/auth/login?next=${encodeURIComponent(`/affiliations/ajouter?code=${code}`)}`;
  const signupHref = "/signup";

  return (
    <div
      className="flex min-h-screen flex-col bg-bg font-sans text-text"
      style={{
        backgroundImage:
          "radial-gradient(820px 560px at 50% -12%, rgba(168,85,247,.24), transparent 70%), radial-gradient(620px 460px at 0% 100%, rgba(34,211,238,.1), transparent 70%)",
      }}
    >
      <div className="flex flex-none items-center justify-center gap-2.5 border-b border-border px-6 py-5">
        <Image src="/uploads/logo.png" alt="SportVision Connect" width={30} height={30} className="object-contain" />
        <div className="flex items-baseline gap-1.5">
          <span className="font-sora text-[15px] font-bold tracking-tight">SportVision</span>
          <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">Connect</span>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-5 pb-8 pt-7">
        <div className="w-full max-w-[420px] rounded-2xl border border-border bg-surface p-7 text-center">
          {preview?.valide ? (
            <>
              <p className="text-[12.5px] font-bold uppercase tracking-[.1em] text-text-soft">Vous rejoignez</p>
              <h1 className="mt-2 text-[24px] font-extrabold tracking-tight">{preview.club_nom}</h1>
              {preview.team_nom && <p className="mt-1 text-[16px] font-bold text-text-soft">{preview.team_nom}</p>}
              {preview.saison && <p className="mt-1 text-[13px] text-text-faint">Saison {preview.saison}</p>}
              <p className="mt-4 text-[13px] leading-relaxed text-text-soft">
                Le club et l&apos;équipe seront déjà renseignés — il ne vous reste plus qu&apos;à indiquer pour qui.
              </p>
              <div className="mt-6 flex flex-col gap-2.5">
                <Link
                  href={continueHref}
                  className="rounded-sv bg-gradient-to-br from-brand-blue to-brand-violet px-5 py-3 text-[14px] font-bold text-white shadow-sv-button hover:brightness-[1.06]"
                >
                  Continuer
                </Link>
                {!user && (
                  <Link href={signupHref} className="text-[12.5px] font-bold text-text-soft hover:text-text">
                    Pas encore de compte SportVision Connect ? Créer mon espace
                  </Link>
                )}
              </div>
            </>
          ) : (
            <>
              <h1 className="text-[20px] font-extrabold tracking-tight">Lien indisponible</h1>
              <p className="mt-3 text-[13.5px] leading-relaxed text-text-soft">
                {(preview?.raison && RAISON_LABEL[preview.raison]) ?? "Ce lien n'est plus valide."}
              </p>
              <Link href="/" className="mt-6 inline-block text-[12.5px] font-bold text-brand-blue-electric hover:text-brand-violet">
                Retour à l&apos;accueil SportVision Connect
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
