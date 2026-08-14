import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { gradientFor } from "@/lib/avatarGradients";

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  is_creator: boolean;
  member_count: number;
  member_previews: { user_id: string; initial: string }[];
  has_active_funding: boolean;
}

// Mes équipes — voir design-connect-personnel-12-08/README.md § Espace joueur → Mes équipes.
// Backend : list_my_groups() (migration-connect-v50-groupes-cotisations-personnelles.sql),
// RPC SECURITY DEFINER qui ne renvoie que les groupes dont l'appelant est membre.
export default async function EquipesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  const { data: groups } = await supabase.rpc("list_my_groups");
  const list = (groups || []) as GroupRow[];

  return (
    <AppShell firstName={firstName}>
      <div className="flex flex-col gap-6 animate-sv-in">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Mes équipes</h1>
            <p className="max-w-[560px] text-[15px] text-text-tertiary">
              Créez vos groupes, invitez vos coéquipiers et organisez vos prestations ensemble.
            </p>
          </div>
          <Link
            href="/equipes/creer"
            className="flex h-[46px] flex-none items-center gap-2 rounded-sv bg-sv-gradient px-[18px] font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]"
          >
            <span className="material-symbols-rounded !text-[20px]">add</span>
            Créer une équipe
          </Link>
        </div>

        {list.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {list.map((g) => (
              <Link
                key={g.id}
                href={`/equipes/${g.id}`}
                className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-5 hover:bg-surface-hover"
              >
                <div className="flex items-center gap-3.5">
                  <span
                    className="flex h-[54px] w-[54px] flex-none items-center justify-center rounded-sv font-sora text-[18px] font-semibold text-white"
                    style={{ background: gradientFor(g.id) }}
                  >
                    {g.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-sora text-[18px] font-semibold tracking-tight">{g.name}</span>
                    <span className="text-[13px] text-text-tertiary">{g.member_count} membres</span>
                  </div>
                  <div className="ml-auto flex flex-none">
                    {g.member_previews.map((m, i) => (
                      <span
                        key={m.user_id}
                        className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-bg-elevated text-[10px] font-semibold text-white"
                        style={{ background: gradientFor(m.user_id), marginLeft: i === 0 ? 0 : "-10px" }}
                      >
                        {m.initial}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.is_creator && (
                    <span className="rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[12px] font-medium text-text-secondary">
                      Créateur
                    </span>
                  )}
                  {g.has_active_funding && (
                    <span className="rounded-sv-pill bg-cotisations-bg px-2.5 py-1 text-[12px] font-medium text-cotisations">
                      Cotisation en cours
                    </span>
                  )}
                </div>
                <span className="flex items-center gap-1.5 font-sora text-[14px] font-semibold text-[#8CA9FF]">
                  Ouvrir
                  <span className="material-symbols-rounded !text-[17px]">arrow_forward</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex max-w-[560px] flex-col gap-3.5 rounded-sv-card border border-dashed border-border-strong bg-surface p-[30px]">
            <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-affiliations-bg">
              <span className="material-symbols-rounded !text-[24px] text-affiliations">groups</span>
            </span>
            <span className="font-sora text-[19px] font-semibold">Aucune équipe pour le moment</span>
            <p className="text-[14px] leading-relaxed text-text-tertiary">
              Créez un groupe avec vos coéquipiers pour réserver et cotiser ensemble.
            </p>
            <Link
              href="/equipes/creer"
              className="self-start rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[15px] font-semibold text-white"
            >
              Créer mon équipe
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}
