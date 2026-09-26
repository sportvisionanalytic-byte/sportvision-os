"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { createClient } from "@/lib/supabase/client";
import { useFermetureEchap } from "@/lib/use-fermeture-echap";

// Galeries — côté club.
//
// Club+ lit LES MÊMES albums et LES MÊMES liens que l'OS et que la galerie publique. Aucune copie,
// aucune table dédiée : media_club_galleries() est une vue de lecture sur media_albums, filtrée
// par is_club_member(), la fonction déjà utilisée partout ailleurs dans Club+.
//
// Le club ne voit AUCUN tarif et ne peut rien modifier : les règles commerciales restent chez
// SportVision. Il ne voit d'ailleurs que les liens qu'on lui a explicitement confiés
// (visible_in_clubplus) — le lien « équipe adverse » et les liens internes ne remontent pas ici.
//
// ── POURQUOI LES PHOTOS S'OUVRENT ICI, ET PLUS SEULEMENT PAR LE LIEN (26/09/2026) ──
//
// Constat de Fouka : « en tant que community manager, j'ouvre la galerie, je vois le filigrane ».
// Il avait raison, et la cause n'était pas dans les droits : Club+ vit sur clubplus.sportvision-an.fr
// et la galerie publique sur connect.sportvision-an.fr. Aucun domaine de cookie n'est partagé entre
// les deux, donc cliquer « Ouvrir » faisait arriver sur Connect DÉCONNECTÉ. Un community manager y
// était un visiteur anonyme, et un visiteur anonyme voit le filigrane — ce qui est exactement ce
// qu'on veut de lui.
//
// Le lien reste donc ce qu'il est : le chemin des familles et des acheteurs, filigrané. Pour le
// staff du club, les photos s'affichent ICI, dans Club+, où la session existe. La base (v284) rend
// alors l'aperçu net, et la politique de stockage (v281) l'autorise.
//
// On ne partage PAS les cookies entre sous-domaines pour régler ça : ce serait déconnecter tout le
// monde une fois, et surtout étendre le cookie de session à tous les sous-domaines, l'OS compris.

const CONNECT_URL = "https://connect.sportvision-an.fr";

/** L'adresse publique d'un aperçu. La base rend un CHEMIN et non une adresse : elle ne connaît pas
 *  l'URL du projet Supabase, les clients si. */
function couvertureUrl(chemin: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/public/galerie-previews/${chemin}`;
}

interface LienClub {
  label: string | null;
  audience: string | null;
  slug: string;
  is_enabled: boolean;
  // 26/09/2026 : le jeton N'ARRIVE PLUS ici (v285). Sans lui le lien est inutilisable, et c'est le
  // but : le club sait quels liens existent, il ne peut plus les diffuser. Diffuser un lien est une
  // action de SportVision, depuis l'OS.
}

interface VideoGalerie {
  album_id: string;
  nom: string;
  url: string;
}

interface PhotoGalerie {
  id: string;
  /** L'adresse à afficher : l'aperçu NET quand le staff y a droit, sinon le public filigrané. */
  url: string;
  /** Faux = cette photo porte encore le filigrane. Sert à le dire au staff au lieu de le laisser
   *  deviner pourquoi certaines photos sont barrées. */
  net: boolean;
}

interface GalerieClub {
  album_id: string;
  titre: string;
  equipe: string | null;
  event_date: string | null;
  cover_url: string | null;
  /** 26/09/2026 — Le chemin de la photo de couverture, calculé par la base (v288) : la photo
   *  désignée depuis l'OS, sinon la première de la galerie. Les 24 galeries publiées n'avaient
   *  AUCUNE couverture, parce que `cover_url` n'est écrite que si quelqu'un la choisit à la main. */
  cover_path: string | null;
  photos: number;
  publie: boolean;
  liens: LienClub[];
}

export default function GaleriesClubPage() {
  const { ctx } = useSession();
  const [galeries, setGaleries] = useState<GalerieClub[] | null>(null);
  const [videos, setVideos] = useState<Record<string, VideoGalerie>>({});
  const [erreur, setErreur] = useState(false);
  // La visionneuse : quelle galerie est ouverte, ses photos, et la photo agrandie.
  const [ouverte, setOuverte] = useState<GalerieClub | null>(null);
  const [photos, setPhotos] = useState<PhotoGalerie[] | null>(null);
  const [agrandie, setAgrandie] = useState<string | null>(null);
  // Échap ferme la fenêtre du QR, comme les autres modales de Club+ depuis le 10/09.

  useEffect(() => {
    if (!ctx?.organization?.id) return;
    let vivant = true;
    void (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("media_club_galleries", { p_club_id: ctx.organization.id });
      // Une erreur ne se déguise pas en « aucune galerie publiée » : le club en conclurait que
      // SportVision ne lui a rien livré (12/09/2026).
      if (error) {
        if (vivant) {
          setErreur(true);
          setGaleries([]);
        }
        return;
      }
      const liste = Array.isArray(data) ? (data as GalerieClub[]) : [];
      if (vivant) {
        setErreur(false);
        setGaleries(liste);
      }
      // La vidéo du match n'est pas dans la galerie : c'est le lien du montage déposé sur la
      // mission (v157). Les liens de livraison sont réservés au staff, d'où cette fonction dédiée
      // qui ne rend que le montage final des galeries que la personne a le droit de voir.
      if (liste.length) {
        const { data: v } = await supabase.rpc("media_galeries_video", { p_album_ids: liste.map((g) => g.album_id) });
        if (vivant && Array.isArray(v)) {
          setVideos(Object.fromEntries((v as VideoGalerie[]).map((x) => [x.album_id, x])));
        }
      }
    })();
    return () => {
      vivant = false;
    };
  }, [ctx?.organization?.id]);

  // `url()` est SUPPRIMEE : elle fabriquait l'adresse partageable du lien, et le jeton sans lequel
  // elle ne vaut rien n'arrive plus (v285). La garder aurait produit une adresse qui semble valable
  // et qui ne l'est pas — pire qu'une absence.

  // Échap referme la visionneuse, comme la fenêtre du QR.
  useFermetureEchap(Boolean(agrandie), () => setAgrandie(null));
  useFermetureEchap(Boolean(ouverte) && !agrandie, () => { setOuverte(null); setPhotos(null); });

  /**
   * Les photos d'une galerie, vues par le staff du club.
   *
   * On passe par le MÊME `media_gallery_photos` que la page publique — pas une seconde fonction.
   * Ce qui change n'est pas la requête, c'est qui la pose : ici la session du club existe, donc la
   * base rend l'aperçu net (v284). Écrire une fonction dédiée aurait créé deux vérités sur ce que
   * contient une galerie, et c'est exactement le genre de divergence qu'on paie six mois plus tard.
   *
   * Le fichier net vit dans un bucket privé : une balise <img> n'y accède pas, il faut une adresse
   * signée. Un seul appel pour toute la galerie. Une signature qui échoue n'est pas une erreur
   * d'écran : on retombe sur l'aperçu public, filigrané.
   */
  async function ouvrirPhotos(g: GalerieClub) {
    setOuverte(g);
    setPhotos(null);
    const supabase = createClient();
    // PAR IDENTIFIANT DE GALERIE, SANS AUCUN JETON (v285). La fonction ne redéfinit pas qui a le
    // droit de voir : elle demande à media_club_galleries, celle qui a servi à afficher cette
    // carte. Une seule vérité sur « qui voit quoi ».
    const { data, error } = await supabase.rpc("media_club_gallery_photos", {
      p_album_id: g.album_id, p_limit: 200, p_offset: 0,
    });
    if (error || !Array.isArray(data)) { setPhotos([]); return; }
    const rows = data as Record<string, unknown>[];

    // Le fichier net vit dans un bucket privé : une balise <img> n'y accède pas, il faut une adresse
    // signée. Un seul appel pour toute la galerie. Une signature qui échoue n'est pas une erreur
    // d'écran : on retombe sur l'aperçu public, filigrané.
    const aSigner = rows
      .map((r) => r.preview_clair_path as string | null)
      .filter((c): c is string => Boolean(c));
    const signees = new Map<string, string>();
    if (aSigner.length) {
      const { data: urls } = await supabase.storage
        .from("sportvision-media-prive")
        .createSignedUrls(aSigner, 60 * 60);
      for (const u of urls ?? []) {
        if (u?.path && u?.signedUrl) signees.set(u.path, u.signedUrl);
      }
    }

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    setPhotos(rows.map((r) => {
      const net = (r.preview_clair_path as string | null) ?? null;
      const netUrl = net ? signees.get(net) ?? null : null;
      const publique = (r.preview_path as string | null) ?? (r.thumb_path as string | null) ?? "";
      return {
        id: r.id as string,
        url: netUrl ?? `${base}/storage/v1/object/public/galerie-previews/${publique}`,
        net: Boolean(netUrl),
      };
    }));
  }

  // `copier()` est SUPPRIMEE avec le bouton qu'elle servait : le club ne diffuse plus de lien.



  if (galeries === null) {
    return <div className="p-6 text-[13px] text-text-soft">Chargement des galeries…</div>;
  }

  if (erreur) {
    return (
      <div className="p-6">
        <h1 className="text-[22px] font-bold tracking-tight">Galeries</h1>
        <p className="mt-3 max-w-[460px] text-[13.5px] leading-relaxed text-text-soft">
          Les galeries n&apos;ont pas pu être chargées. Ce n&apos;est pas qu&apos;il n&apos;y en a
          aucune : la liste n&apos;a pas répondu.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-full border border-border-strong px-4 py-2 text-[13px] font-semibold hover:bg-row-hover"
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (galeries.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-[22px] font-bold tracking-tight">Galeries</h1>
        <p className="mt-3 max-w-[460px] text-[13.5px] leading-relaxed text-text-soft">
          Aucune galerie publiée pour le moment. Les galeries réalisées par SportVision
          apparaîtront ici dès leur publication, avec les liens à diffuser aux familles.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-[22px] font-bold tracking-tight">Galeries</h1>
      <p className="mt-1.5 text-[13px] text-text-soft">
        Les galeries SportVision de votre club, et les liens que vous pouvez diffuser.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {galeries.map((g) => (
          <div key={g.album_id} className="rounded-2xl border border-border bg-surface p-3 sm:p-4">
            <div className="flex items-start gap-4">
              <div className="h-[68px] w-[68px] flex-none overflow-hidden rounded-xl bg-surface-sunken sm:h-[86px] sm:w-[86px]">
                {(g.cover_url ?? (g.cover_path ? couvertureUrl(g.cover_path) : null)) && (
                  <img
                    src={g.cover_url ?? couvertureUrl(g.cover_path!)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold tracking-tight">{g.titre}</div>
                <div className="mt-0.5 truncate text-[12px] text-text-soft">
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

            {videos[g.album_id] && (
              <a
                href={videos[g.album_id]!.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px] font-semibold hover:bg-row-hover"
              >
                <span aria-hidden>🎬</span>
                <span className="min-w-0 flex-1 truncate">Vidéo du match</span>
                <span className="text-[12px] font-normal text-text-soft">Ouvrir</span>
              </a>
            )}

            {/* LE BOUTON DU STAFF. Les liens en dessous restent ce qu'ils sont : le chemin des
                familles, filigrané. Ici, c'est le club qui regarde son propre reportage. */}
            {g.photos > 0 && g.liens.length > 0 && (
              <button
                onClick={() => void ouvrirPhotos(g)}
                className="mt-3 flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px] font-semibold hover:bg-row-hover"
              >
                <span aria-hidden>🖼️</span>
                <span className="min-w-0 flex-1 truncate text-left">Voir les photos</span>
                <span className="text-[12px] font-normal text-text-soft">
                  {g.photos} photo{g.photos > 1 ? "s" : ""}
                </span>
              </button>
            )}

            {g.liens.length === 0 ? (
              <p className="mt-3 text-[12px] text-text-faint">
                Aucun lien n&apos;est encore mis à votre disposition pour cette galerie.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {g.liens.map((l) => (
                  <div
                    key={l.slug}
                    className={`flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2.5 ${l.is_enabled ? "" : "opacity-50"}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                      {l.label ?? "Lien de galerie"}
                      {!l.is_enabled && <span className="ml-2 text-[11px] font-normal text-text-soft">désactivé</span>}
                    </span>
                    {/* COPIER, QR CODE ET OUVRIR SONT RETIRES (26/09/2026, demande de Fouka).
                        « Il faut que ce lien ne soit pas envoyable. Il ne faudrait pas qu'eux
                        puissent envoyer leur propre lien aux joueurs. Le but, c'est que les joueurs
                        ou les parents paient. »
                        Le lien reste affiché parce que le club a le droit de savoir ce que
                        SportVision diffuse pour lui. Il n'est plus utilisable : le jeton n'arrive
                        même plus dans cette page (v285), donc retirer les boutons n'est pas un
                        habillage — il n'y a plus rien derrière. */}
                    <span className="text-[11px] font-normal text-text-soft">
                      diffusé par SportVision
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {ouverte && (
        <div
          className="fixed inset-0 z-40 flex flex-col bg-black/90"
          role="dialog"
          aria-modal="true"
          aria-label={`Photos de ${ouverte.titre}`}
        >
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-white">{ouverte.titre}</p>
              <p className="truncate text-[12px] text-white/60">
                {photos === null
                  ? "Chargement…"
                  : photos.length === 0
                    ? "Aucune photo à afficher."
                    : photos.some((p) => !p.net)
                      // Le dire au lieu de laisser deviner : les photos versées avant le 26/09 n'ont
                      // pas d'aperçu net, et SportVision doit les régénérer depuis l'OS.
                      ? `${photos.length} photo${photos.length > 1 ? "s" : ""} · certaines portent encore le filigrane, SportVision doit les régénérer`
                      : `${photos.length} photo${photos.length > 1 ? "s" : ""}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setOuverte(null); setPhotos(null); }}
              className="rounded-full border border-white/20 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-white/10"
            >
              Fermer
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {photos === null ? (
              <p className="p-6 text-center text-[13px] text-white/60">Chargement des photos…</p>
            ) : photos.length === 0 ? (
              <p className="p-6 text-center text-[13px] text-white/60">
                Aucune photo n&apos;est encore disponible dans cette galerie.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {photos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setAgrandie(p.url)}
                    className="aspect-square overflow-hidden rounded-lg bg-white/5"
                    aria-label="Agrandir cette photo"
                  >
                    <img src={p.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {agrandie && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black p-4"
              onClick={() => setAgrandie(null)}
              role="dialog"
              aria-modal="true"
              aria-label="Photo en plein écran"
            >
              <img src={agrandie} alt="" className="max-h-full max-w-full object-contain" />
            </div>
          )}
        </div>
      )}

      {/* LA FENETRE DU QR CODE EST SUPPRIMEE (26/09/2026). Plus rien ne l'ouvrait depuis le
          retrait du bouton : le club ne diffuse plus de lien de galerie (v285), donc il n'a plus de
          QR a montrer. Une fenetre modale inatteignable est du code que personne ne teste et que
          quelqu'un rebranchera un jour en croyant qu'elle est encore juste.
          Le composant QrCode lui-meme reste : il sert ailleurs, et c'est lui qui avait remplace
          api.qrserver.com le 12/09, ou le jeton d'acces aux photos d'enfants partait dans les
          journaux d'un tiers. */}
    </div>
  );
}
