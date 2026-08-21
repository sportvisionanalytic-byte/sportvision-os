import { DEMO_CLUB, DEMO_EMAIL, DEMO_FIRST_NAME, DEMO_LAST_NAME } from "@/lib/demo/mock-data";

// Version statique (non éditable) du profil réel — les sections du vrai profil ouvrent des
// modales qui écrivent en base ; pas pertinent de les rendre fonctionnelles pour un aperçu.
export default function DemoProfilPage() {
  const fullName = `${DEMO_FIRST_NAME} ${DEMO_LAST_NAME}`;
  const monogram = DEMO_FIRST_NAME.charAt(0).toUpperCase();

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="rounded-sv-card p-px" style={{ background: "linear-gradient(130deg, rgba(168,85,247,.5), rgba(34,211,238,.24) 60%, transparent)" }}>
        <div className="flex flex-wrap items-center gap-4 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
          <span className="flex h-[60px] w-[60px] flex-none items-center justify-center rounded-full bg-sv-gradient font-sora text-[20px] font-semibold text-white">
            {monogram}
          </span>
          <div className="flex flex-col gap-1.5">
            <h1 className="font-sora text-[26px] font-bold tracking-tight">{fullName}</h1>
            <span className="text-[14px] text-text-tertiary">Football · Milieu de terrain</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Section title="Informations personnelles">
          <Fact label="E-mail" value={DEMO_EMAIL} />
          <Fact label="Téléphone" value="06 12 34 56 78" />
        </Section>
        <Section title="Profil sportif">
          <Fact label="Sport" value="Football" />
          <Fact label="Poste" value="Milieu de terrain" />
        </Section>
        <Section title="Mon affiliation">
          <Fact label="Club" value={DEMO_CLUB.nom} />
          <Fact label="Statut" value="Affilié" />
        </Section>
        <Section title="Accès à mon profil">
          <p className="text-[14px] leading-relaxed text-text-tertiary">Personne n&apos;a accès à votre profil.</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-sv-card border border-border bg-surface p-5">
      <span className="font-sora text-[16px] font-semibold">{title}</span>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[14px]">
      <span className="text-text-tertiary">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
