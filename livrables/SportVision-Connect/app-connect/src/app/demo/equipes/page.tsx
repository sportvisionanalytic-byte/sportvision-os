import { gradientFor } from "@/lib/avatarGradients";
import { DEMO_GROUPS } from "@/lib/demo/mock-data";

export default function DemoEquipesPage() {
  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Mes équipes</h1>
          <p className="max-w-[560px] text-[15px] text-text-tertiary">
            Créez vos groupes, invitez vos coéquipiers et organisez vos prestations ensemble.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DEMO_GROUPS.map((g) => (
          <div key={g.id} className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-5">
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
                <span className="rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[12px] font-medium text-text-secondary">Créateur</span>
              )}
              {g.has_active_funding && (
                <span className="rounded-sv-pill bg-cotisations-bg px-2.5 py-1 text-[12px] font-medium text-cotisations">Paiement collectif en cours</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
