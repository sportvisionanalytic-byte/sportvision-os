import Link from "next/link";
import { DEMO_PROFILES } from "@/lib/demo/profiles";

export default function DemoIndexPage() {
  const groups = Array.from(new Set(DEMO_PROFILES.map((p) => p.group)));
  return (
    <div className="mx-auto flex min-h-screen max-w-[720px] flex-col gap-8 px-6 py-14">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-[.11em] text-brand-blue-electric">Démo interne</span>
        <h1 className="text-[26px] font-extrabold tracking-tight text-text">SportVision Club+ — démonstration</h1>
        <p className="text-[14px] leading-relaxed text-text-secondary">
          Choisissez un profil pour explorer la navigation et les écrans correspondants. Données 100&nbsp;% fictives, aucune action réelle.
        </p>
      </div>
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-2.5">
          <h2 className="text-[12px] font-extrabold uppercase tracking-[.08em] text-text-faint">{g}</h2>
          <div className="flex flex-col gap-2">
            {DEMO_PROFILES.filter((p) => p.group === g).map((p) => (
              <Link
                key={p.key}
                href={`/demo/${p.key}/dashboard`}
                className="flex items-center justify-between gap-3 rounded-sv-card border border-border bg-surface px-4 py-3.5 text-[13.5px] font-semibold text-text transition-colors hover:border-border-strong"
              >
                {p.label}
                <span className="text-text-faint">→</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
