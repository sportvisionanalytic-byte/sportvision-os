import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";

// Mon profil — version minimale (identité + club). L'édition et les préférences de
// notifications du design de référence (README § Mon profil) arrivent avec le reste du
// chantier — pas construites ici pour éviter un formulaire décoratif qui n'enregistre rien.
export default async function ProfilPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";
  const fullName = player ? `${player.firstName} ${player.lastName}`.trim() : firstName;
  const monogram = (firstName[0] || "?").toUpperCase();

  return (
    <AppShell firstName={firstName}>
      <div className="flex flex-col gap-6">
        <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(130deg, rgba(168,85,247,.5), rgba(34,211,238,.24) 60%, transparent)" }}>
          <div className="flex items-center gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
            <span className="flex h-[60px] w-[60px] flex-none items-center justify-center rounded-full bg-sv-gradient font-sora text-[20px] font-semibold text-white">
              {monogram}
            </span>
            <div className="flex flex-col gap-1.5">
              <h1 className="font-sora text-[26px] font-bold tracking-tight">{fullName}</h1>
              <span className="text-[14px] text-text-tertiary">{user.email}</span>
              {player?.club && (
                <span className="mt-1 self-start rounded-sv-pill bg-affiliations-bg px-2.5 py-1 text-[12px] font-medium text-affiliations">
                  {player.club.nom}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-sv-card border border-border bg-surface p-5">
          <h2 className="font-sora text-[17px] font-semibold">Informations</h2>
          <InfoRow label="Adresse e-mail" value={user.email || "—"} />
          <InfoRow label="Prénom" value={player?.firstName || "—"} />
          <InfoRow label="Nom" value={player?.lastName || "—"} />
        </div>
      </div>
    </AppShell>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">{label}</span>
      <span className="text-[15px] font-medium">{value}</span>
    </div>
  );
}
