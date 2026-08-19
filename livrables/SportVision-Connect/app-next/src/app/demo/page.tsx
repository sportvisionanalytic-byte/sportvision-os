import Link from "next/link";
import { DEMO_PROFILES } from "@/lib/demo/profiles";

function ProfileLink({ profileKey, label }: { profileKey: string; label: string }) {
  return (
    <Link
      href={`/demo/${profileKey}/dashboard`}
      className="flex items-center justify-between gap-3 rounded-sv-card border border-border bg-surface px-4 py-3.5 text-[13.5px] font-semibold text-text transition-colors hover:border-border-strong"
    >
      {label}
      <span className="text-text-faint">→</span>
    </Link>
  );
}

export default function DemoIndexPage() {
  const featured = DEMO_PROFILES.filter((p) => p.featured);
  const others = DEMO_PROFILES.filter((p) => !p.featured);
  const otherGroups = Array.from(new Set(others.map((p) => p.group)));

  return (
    <div className="mx-auto flex min-h-screen max-w-[720px] flex-col gap-8 px-6 py-14">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-[.11em] text-brand-blue-electric">Démo interne</span>
        <h1 className="text-[26px] font-extrabold tracking-tight text-text">SportVision Club+ — démonstration</h1>
        <p className="text-[14px] leading-relaxed text-text-secondary">
          Choisissez un profil pour explorer la navigation et les écrans correspondants. Données 100&nbsp;% fictives, aucune action réelle.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <h2 className="text-[12px] font-extrabold uppercase tracking-[.08em] text-text-faint">Profils recommandés</h2>
        <div className="flex flex-col gap-2">
          {featured.map((p) => (
            <ProfileLink key={p.key} profileKey={p.key} label={p.label} />
          ))}
        </div>
      </div>

      <details className="flex flex-col gap-2.5">
        <summary className="cursor-pointer text-[12px] font-extrabold uppercase tracking-[.08em] text-text-faint">Tous les profils (QA interne)</summary>
        <div className="mt-2.5 flex flex-col gap-6">
          {otherGroups.map((g) => (
            <div key={g} className="flex flex-col gap-2.5">
              <h3 className="text-[11px] font-bold uppercase tracking-[.06em] text-text-faint">{g}</h3>
              <div className="flex flex-col gap-2">
                {others.filter((p) => p.group === g).map((p) => (
                  <ProfileLink key={p.key} profileKey={p.key} label={p.label} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
