"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";

// Galeries — côté club.
//
// Club+ lit LES MÊMES albums et LES MÊMES liens que l'OS et que la galerie publique. Aucune copie,
// aucune table dédiée : media_club_galleries() est une vue de lecture sur media_albums, filtrée
// par is_club_member(), la fonction déjà utilisée partout ailleurs dans Club+.
//
// Le club ne voit AUCUN tarif et ne peut rien modifier : les règles commerciales restent chez
// SportVision. Il ne voit d'ailleurs que les liens qu'on lui a explicitement confiés
// (visible_in_clubplus) — le lien « équipe adverse » et les liens internes ne remontent pas ici.

const CONNECT_URL = "https://connect.sportvision-an.fr";

interface LienClub {
  label: string | null;
  audience: string | null;
  slug: string;
  token: string;
  is_enabled: boolean;
}

interface GalerieClub {
  album_id: string;
  titre: string;
  equipe: string | null;
  event_date: string | null;
  cover_url: string | null;
  photos: number;
  publie: boolean;
  liens: LienClub[];
}

export default function GaleriesClubPage() {
  const { ctx } = useSession();
  const [galeries, setGaleries] = useState<GalerieClub[] | null>(null);
  const [copie, setCopie] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx?.organization?.id) return;
    let vivant = true;
    void (async () => {
      const { data } = await createClient().rpc("media_club_galleries", { p_club_id: ctx.organization.id });
      if (vivant) setGaleries(Array.isArray(data) ? (data as GalerieClub[]) : []);
    })();
    return () => {
      vivant = false;
    };
  }, [ctx?.organization?.id]);

  const url = (l: LienClub) => `${CONNECT_URL}/gallery/${l.slug}?k=${encodeURIComponent(l.token)}`;

  async function copier(l: LienClub) {
    try {
      await navigator.clipboard.writeText(url(l));
      setCopie(l.slug);
      setTimeout(() => setCopie(null), 2200);
    } catch {
      /* presse-papier refusé : le lien reste visible et sélectionnable */
    }
  }

  if (galeries === null) {
    return <div className="p-6 text-[13px] text-slate-400">Chargement des galeries…</div>;
  }

  if (galeries.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-[22px] font-bold tracking-tight">Galeries</h1>
        <p className="mt-3 max-w-[460px] text-[13.5px] leading-relaxed text-slate-400">
          Aucune galerie publiée pour le moment. Les galeries réalisées par SportVision
          apparaîtront ici dès leur publication, avec les liens à diffuser aux familles.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-[22px] font-bold tracking-tight">Galeries</h1>
      <p className="mt-1.5 text-[13px] text-slate-400">
        Les galeries SportVision de votre club, et les liens que vous pouvez diffuser.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {galeries.map((g) => (
          <div key={g.album_id} className="rounded-2xl border border-white/10 bg-white/[.03] p-3 sm:p-4">
            <div className="flex items-start gap-4">
              <div className="h-[68px] w-[68px] flex-none overflow-hidden rounded-xl bg-white/5 sm:h-[86px] sm:w-[86px]">
                {g.cover_url && <img src={g.cover_url} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold tracking-tight">{g.titre}</div>
                <div className="mt-0.5 truncate text-[12px] text-slate-400">
                  {[
                    g.equipe,
                    g.event_date
                      ? new Date(`${g.event_date}T12:00:00`).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })
                      : null,
                    `${g.photos} photo${g.photos > 1 ? "s" : ""}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>

            {g.liens.length === 0 ? (
              <p className="mt-3 text-[12px] text-slate-500">
                Aucun lien n&apos;est encore mis à votre disposition pour cette galerie.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {g.liens.map((l) => (
                  <div
                    key={l.slug}
                    className={`flex flex-wrap items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 ${l.is_enabled ? "" : "opacity-50"}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                      {l.label ?? "Lien de galerie"}
                      {!l.is_enabled && <span className="ml-2 text-[11px] font-normal text-slate-400">désactivé</span>}
                    </span>
                    <button
                      onClick={() => copier(l)}
                      className="rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-semibold hover:bg-white/5"
                    >
                      {copie === l.slug ? "Copié" : "Copier"}
                    </button>
                    <button
                      onClick={() => setQr(url(l))}
                      className="rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-semibold hover:bg-white/5"
                    >
                      QR Code
                    </button>
                    <a
                      href={url(l)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-semibold hover:bg-white/5"
                    >
                      Ouvrir
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {qr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setQr(null)}>
          <div className="rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <img
              alt="QR Code du lien"
              className="h-[260px] w-[260px]"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=520x520&data=${encodeURIComponent(qr)}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
