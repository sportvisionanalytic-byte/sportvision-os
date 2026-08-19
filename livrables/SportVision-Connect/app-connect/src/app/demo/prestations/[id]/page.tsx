import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchPlayerOfferById, baseTtc, categorieIcon, isCollectif, perPersonTtc, MONTAGE_COMPILATION_SLUG } from "@/lib/prestations/catalogue";
import { formatEUR } from "@/lib/prestations/format";
import { MontageCompilationModes } from "@/components/prestations/MontageCompilationModes";

// Version démo de (joueur)/prestations/[id]/page.tsx : même contenu (catalogue_offres est
// public en lecture, aucune donnée utilisateur), mais le CTA "Réserver" est désactivé au lieu
// de mener au vrai tunnel de réservation (qui écrirait une vraie demande en base).
const HOW_IT_WORKS = [
  { icon: "edit_note", title: "1. Vous envoyez votre demande", text: "Renseignez le match, la date et le lieu — votre demande passe au statut « En validation »." },
  { icon: "verified", title: "2. SportVision confirme", text: "Votre demande est vérifiée puis planifiée. Vous êtes prévenu à chaque étape." },
  { icon: "cloud_download", title: "3. Vos contenus sont livrés", text: "Retrouvez vos photos et vidéos directement dans Connect, dès qu'elles sont prêtes." },
];

export default async function DemoPrestationFichePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const offer = await fetchPlayerOfferById(supabase, id);
  if (!offer) notFound();

  const ttc = baseTtc(offer);
  const collectif = isCollectif(offer);
  const included = (offer.livrablesInclus || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-6 pb-24 animate-sv-in lg:pb-0">
      <Link href="/demo/prestations" className="flex items-center gap-2 self-start text-[14px] font-medium text-text-tertiary hover:text-text lg:text-[13px]">
        <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
        Prestations
      </Link>

      <div
        className="flex flex-col gap-4 rounded-sv-card border border-border p-6"
        style={{ background: "linear-gradient(135deg, rgba(76,29,149,.45) 0%, rgba(58,42,134,.35) 50%, rgba(21,94,117,.35) 100%)" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {offer.family && (
            <span className="rounded-sv-pill bg-white/10 px-3 py-1 text-[12px] font-medium uppercase tracking-[.08em] text-white">{offer.family}</span>
          )}
          <span className="rounded-sv-pill bg-white/10 px-3 py-1 text-[12px] font-medium text-white">
            {collectif ? "Paiement à plusieurs disponible" : "Individuel"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 flex-none items-center justify-center rounded-sv bg-white/10">
            <span className="material-symbols-rounded !text-[28px] text-white" aria-hidden="true">{categorieIcon(offer.categorie)}</span>
          </span>
          <h1 className="font-sora text-[28px] font-bold tracking-tight text-white">{offer.nom}</h1>
        </div>
        {offer.description && <p className="max-w-[560px] text-[15px] leading-relaxed text-white/80">{offer.description}</p>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          {offer.slug === MONTAGE_COMPILATION_SLUG && (
            <Section title="2 façons de nous envoyer vos images">
              <MontageCompilationModes offer={offer} />
            </Section>
          )}

          {included.length > 0 && (
            <Section title="Inclus dans cette prestation">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {included.map((item) => (
                  <div key={item} className="flex items-center gap-2.5 rounded-sv border border-border bg-surface px-3.5 py-3">
                    <span className="material-symbols-rounded !text-[19px] text-affiliations" aria-hidden="true">check_circle</span>
                    <span className="text-[14px] text-text-secondary lg:text-[13.5px]">{item}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Comment ça marche">
            <div className="flex flex-col gap-3">
              {HOW_IT_WORKS.map((step) => (
                <div key={step.title} className="flex items-start gap-3.5 rounded-sv border border-border bg-surface p-4">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-sv bg-prestations-bg">
                    <span className="material-symbols-rounded !text-[20px] text-prestations" aria-hidden="true">{step.icon}</span>
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-sora text-[14.5px] font-semibold">{step.title}</span>
                    <span className="text-[14px] leading-relaxed text-text-tertiary lg:text-[13px]">{step.text}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {offer.options.length > 0 && (
            <Section title="Options disponibles">
              <div className="flex flex-col gap-2">
                {offer.options.map((opt) => {
                  const optTtc = Math.round(opt.prixHt * (1 + offer.tvaPct / 100) * 100) / 100;
                  return (
                    <div key={opt.nom} className="flex items-center justify-between gap-3 rounded-sv border border-border bg-surface px-3.5 py-3">
                      <span className="text-[14px] text-text-secondary lg:text-[13.5px]">{opt.nom}</span>
                      <span className="font-sora text-[14px] font-semibold lg:text-[13.5px]">+{formatEUR(optTtc)}</span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </div>

        <div className="hidden flex-col gap-4 self-start rounded-sv-card border border-border bg-surface p-5 lg:flex">
          <div className="flex flex-col gap-1">
            <span className="font-sora text-[26px] font-bold tracking-tight">{ttc !== null ? `${formatEUR(ttc)} TTC` : "Sur devis"}</span>
            {ttc !== null && <span className="text-[13px] text-text-tertiary">Exemple à 10 participants : {formatEUR(perPersonTtc(ttc))} / personne</span>}
          </div>
          <DemoReserveButton />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 border-t border-border bg-bg/95 p-3.5 backdrop-blur-md lg:hidden">
        <DemoReserveButton />
      </div>
    </div>
  );
}

function DemoReserveButton() {
  return (
    <button
      type="button"
      disabled
      title="Réservation désactivée en mode démonstration"
      className="flex h-14 items-center justify-center rounded-sv border border-border-strong bg-white/5 px-5 font-sora text-[15px] font-semibold text-text-faint"
    >
      Réservation désactivée en démo
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-sora text-[17px] font-semibold">{title}</h2>
      {children}
    </div>
  );
}
