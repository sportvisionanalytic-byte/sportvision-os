import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { fetchPlayerOfferById, baseTtc, categorieIcon, perPersonTtc } from "@/lib/prestations/catalogue";
import { formatEUR } from "@/lib/prestations/format";

const HOW_IT_WORKS = [
  { icon: "edit_note", title: "1. Vous envoyez votre demande", text: "Renseignez le match, la date et le lieu — votre demande passe au statut « En validation »." },
  { icon: "verified", title: "2. SportVision confirme", text: "Votre demande est vérifiée puis planifiée. Vous êtes prévenu à chaque étape." },
  { icon: "cloud_download", title: "3. Vos contenus sont livrés", text: "Retrouvez vos photos et vidéos directement dans Connect, dès qu'elles sont prêtes." },
];

export default async function PrestationFichePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  const offer = await fetchPlayerOfferById(supabase, id);
  if (!offer) notFound();

  const ttc = baseTtc(offer);
  const included = (offer.livrablesInclus || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <AppShell firstName={firstName}>
      <div className="flex flex-col gap-6 pb-24 animate-sv-in lg:pb-0">
        <Link href="/prestations" className="flex items-center gap-2 self-start text-[13px] font-medium text-text-tertiary hover:text-text">
          <span className="material-symbols-rounded !text-[18px]">arrow_back</span>
          Prestations
        </Link>

        {/* Hero */}
        <div
          className="flex flex-col gap-4 rounded-sv-card border border-border p-6"
          style={{ background: "linear-gradient(135deg, rgba(76,29,149,.45) 0%, rgba(58,42,134,.35) 50%, rgba(21,94,117,.35) 100%)" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            {offer.family && (
              <span className="rounded-sv-pill bg-white/10 px-3 py-1 text-[12px] font-medium uppercase tracking-[.08em] text-white">
                {offer.family}
              </span>
            )}
            <span className="rounded-sv-pill bg-white/10 px-3 py-1 text-[12px] font-medium text-white">Collectif</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 flex-none items-center justify-center rounded-sv bg-white/10">
              <span className="material-symbols-rounded !text-[28px] text-white">{categorieIcon(offer.categorie)}</span>
            </span>
            <h1 className="font-sora text-[28px] font-bold tracking-tight text-white">{offer.nom}</h1>
          </div>
          {offer.description && <p className="max-w-[560px] text-[15px] leading-relaxed text-white/80">{offer.description}</p>}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-6">
            {included.length > 0 && (
              <Section title="Inclus dans cette prestation">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {included.map((item) => (
                    <div key={item} className="flex items-center gap-2.5 rounded-sv border border-border bg-surface px-3.5 py-3">
                      <span className="material-symbols-rounded !text-[19px] text-affiliations">check_circle</span>
                      <span className="text-[13.5px] text-text-secondary">{item}</span>
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
                      <span className="material-symbols-rounded !text-[20px] text-prestations">{step.icon}</span>
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-sora text-[14.5px] font-semibold">{step.title}</span>
                      <span className="text-[13px] leading-relaxed text-text-tertiary">{step.text}</span>
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
                        <span className="text-[13.5px] text-text-secondary">{opt.nom}</span>
                        <span className="font-sora text-[13.5px] font-semibold">+{formatEUR(optTtc)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[12px] leading-relaxed text-text-faint">Options proposées à l&apos;étape suivante de la réservation.</p>
              </Section>
            )}

            <Section title="À savoir">
              <ul className="flex flex-col gap-2 text-[13px] leading-relaxed text-text-tertiary">
                <li>Des frais de déplacement peuvent s&apos;appliquer selon la localisation du match.</li>
                <li>Disponibilité soumise au planning des équipes SportVision — votre demande est confirmée après vérification.</li>
                {offer.dureeEstimee && <li>Délai de livraison estimé : {offer.dureeEstimee}.</li>}
              </ul>
            </Section>

            <Section title="Questions fréquentes">
              <FaqItem q="Quand vais-je recevoir mes contenus ?" a={offer.dureeEstimee ? `Comptez généralement ${offer.dureeEstimee} après la prestation, selon le volume à traiter.` : "Le délai vous est communiqué une fois votre demande confirmée."} />
              <FaqItem q="Puis-je annuler ma demande ?" a="Contactez SportVision depuis Connect dès que possible — le traitement dépend de l'avancement de votre dossier." />
            </Section>
          </div>

          {/* Bloc prix desktop */}
          <div className="hidden flex-col gap-4 self-start rounded-sv-card border border-border bg-surface p-5 lg:flex">
            <div className="flex flex-col gap-1">
              <span className="font-sora text-[26px] font-bold tracking-tight">{ttc !== null ? `${formatEUR(ttc)} TTC` : "Sur devis"}</span>
              {ttc !== null && <span className="text-[13px] text-text-tertiary">À 10 joueurs : {formatEUR(perPersonTtc(ttc))} / personne</span>}
            </div>
            <Link
              href={`/prestations/${offer.id}/reserver`}
              className="flex h-14 items-center justify-center rounded-sv bg-sv-gradient px-5 font-sora text-[16px] font-semibold text-white hover:brightness-[1.12]"
            >
              Réserver{ttc !== null ? ` — ${formatEUR(ttc)}` : ""}
            </Link>
          </div>
        </div>
      </div>

      {/* CTA sticky mobile — au-dessus de la bottom nav (AppShell), qui grandit avec
          env(safe-area-inset-bottom) sur les téléphones à encoche : même calc que le bouton
          "Plus" flottant de l'AppShell pour ne jamais passer sous la nav. */}
      <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 border-t border-border bg-bg/95 p-3.5 backdrop-blur-md lg:hidden">
        <Link
          href={`/prestations/${offer.id}/reserver`}
          className="flex h-14 items-center justify-center rounded-sv bg-sv-gradient px-5 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]"
        >
          Réserver{ttc !== null ? ` — ${formatEUR(ttc)}` : ""}
        </Link>
      </div>
    </AppShell>
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

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-sv border border-border bg-surface p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-medium text-text">
        {q}
        <span className="material-symbols-rounded !text-[20px] text-text-faint transition-transform duration-150 group-open:rotate-180">expand_more</span>
      </summary>
      <p className="mt-2.5 text-[13px] leading-relaxed text-text-tertiary">{a}</p>
    </details>
  );
}
