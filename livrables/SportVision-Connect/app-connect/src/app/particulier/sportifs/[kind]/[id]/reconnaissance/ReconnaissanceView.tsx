"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { LEGAL_URLS } from "@/lib/legal-links";
import {
  BUCKET_VISAGES,
  VERSION_TEXTE_CONSENTEMENT,
  extensionDe,
  lireEtatConsentement,
  refuserPhoto,
  type EtatConsentement,
} from "@/lib/supabase/reconnaissance";
import type { AthleteDetail } from "../AthleteDetailView";

// Écran de consentement à la reconnaissance du visage de l'enfant.
// Le texte affiché est celui de livrables/juridique/consentement-reconnaissance-enfant.md, version
// VERSION_TEXTE_CONSENTEMENT : il ne se modifie pas sans changer ce numéro, sinon on ne sait plus ce
// que les familles ont accepté.
// Trois gestes, trois fonctions serveur (v161) : donner, déposer, retirer. L'écran n'écrit jamais
// directement dans les tables.
export function ReconnaissanceView({
  detail,
  etatInitial,
}: {
  detail: AthleteDetail;
  etatInitial: EtatConsentement | null;
}) {
  const [etat, setEtat] = useState<EtatConsentement | null>(etatInitial);
  const [autoriteParentale, setAutoriteParentale] = useState(false);
  const [autorise, setAutorise] = useState(false);
  const [enCours, setEnCours] = useState<null | "accord" | "photo" | "retrait">(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const champPhoto = useRef<HTMLInputElement>(null);

  const prenom = detail.first_name;
  const accorde = etat?.autorise === true;
  const photoDeposee = etat?.photo_deposee === true;

  async function rafraichir() {
    const supabase = createClient();
    setEtat(await lireEtatConsentement(supabase, detail.ref_id));
  }

  async function donnerAccord() {
    setErreur(null);
    setMessage(null);
    setEnCours("accord");
    const supabase = createClient();
    const { error } = await supabase.rpc("donner_consentement_biometrie", {
      p_player_id: detail.ref_id,
      p_texte_version: VERSION_TEXTE_CONSENTEMENT,
    });
    if (error) {
      setErreur("Votre accord n'a pas pu être enregistré. Réessayez, et écrivez-nous si cela se reproduit.");
      setEnCours(null);
      return;
    }
    await rafraichir();
    setMessage("Votre accord est enregistré. Déposez maintenant une photo de " + prenom + ".");
    setEnCours(null);
  }

  async function deposerPhoto(fichier: File) {
    setErreur(null);
    setMessage(null);
    const refus = refuserPhoto(fichier);
    if (refus) {
      setErreur(refus);
      return;
    }
    setEnCours("photo");
    const supabase = createClient();
    const chemin = `visages/${detail.ref_id}/reference-${Date.now()}.${extensionDe(fichier)}`;
    const { error: erreurDepot } = await supabase.storage
      .from(BUCKET_VISAGES)
      .upload(chemin, fichier, { contentType: fichier.type, upsert: false });
    if (erreurDepot) {
      setErreur("La photo n'a pas pu être déposée. Vérifiez votre connexion et réessayez.");
      setEnCours(null);
      return;
    }
    const { error: erreurLien } = await supabase.rpc("enregistrer_photo_reference", {
      p_player_id: detail.ref_id,
      p_storage_path: chemin,
    });
    if (erreurLien) {
      // La photo est partie mais n'est rattachée à rien : on la retire tout de suite plutôt que de
      // la laisser traîner dans le stockage.
      await supabase.storage.from(BUCKET_VISAGES).remove([chemin]);
      setErreur("La photo n'a pas pu être enregistrée. Réessayez dans un instant.");
      setEnCours(null);
      return;
    }
    await rafraichir();
    setMessage("Photo enregistrée. " + prenom + " sera reconnu sur les prochaines galeries de son club.");
    if (champPhoto.current) champPhoto.current.value = "";
    setEnCours(null);
  }

  async function retirerAccord() {
    setErreur(null);
    setMessage(null);
    setEnCours("retrait");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("retirer_consentement_biometrie", { p_player_id: detail.ref_id });
    if (error) {
      setErreur("Votre accord n'a pas pu être retiré. Réessayez, et écrivez-nous si cela se reproduit.");
      setEnCours(null);
      return;
    }
    const chemins = ((data as { chemins?: string[] } | null)?.chemins ?? []).filter(Boolean);
    if (chemins.length > 0) {
      await supabase.storage.from(BUCKET_VISAGES).remove(chemins);
    }
    await rafraichir();
    setAutoriteParentale(false);
    setAutorise(false);
    setMessage("Votre accord est retiré et la photo de référence est effacée.");
    setEnCours(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/particulier/sportifs/${detail.kind}/${detail.ref_id}`}
          className="inline-flex items-center gap-1.5 text-[14px] font-medium text-text-tertiary hover:text-text"
        >
          <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
          Retour à la fiche de {prenom}
        </Link>
        <h1 className="mt-3 font-sora text-[26px] font-semibold leading-tight">
          Retrouver automatiquement les photos de {prenom}
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-text-secondary">
          Cette option est facultative. Si vous ne la prenez pas, rien ne change : vous accédez à la
          galerie de l&apos;équipe et vous achetez les photos comme aujourd&apos;hui.
        </p>
      </div>

      {erreur && (
        <p role="alert" className="rounded-sv border border-danger-border bg-danger-bg px-4 py-3 text-[14px] text-danger">
          {erreur}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-sv border border-border-strong bg-white/[.06] px-4 py-3 text-[14px] text-text-secondary">
          {message}
        </p>
      )}

      {accorde ? (
        <section className="rounded-sv border border-border bg-white/[.04] p-5">
          <h2 className="font-sora text-[18px] font-semibold">Votre accord est actif</h2>
          <dl className="mt-3 flex flex-col gap-1.5 text-[14px] text-text-secondary">
            <div className="flex gap-2">
              <dt className="text-text-tertiary">Donné le</dt>
              <dd>
                {etat?.accorde_le
                  ? new Date(etat.accorde_le).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
                  : "date inconnue"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-tertiary">Photo de référence</dt>
              <dd>{photoDeposee ? "déposée" : "à déposer"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-tertiary">Version du texte accepté</dt>
              <dd>{etat?.texte_version ?? VERSION_TEXTE_CONSENTEMENT}</dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-border pt-5">
            <h3 className="font-sora text-[15px] font-semibold">
              {photoDeposee ? "Remplacer la photo de référence" : "Déposer la photo de référence"}
            </h3>
            <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-text-secondary">
              Une photo récente de {prenom}, de face, visage bien visible et sans lunettes de soleil.
              Format JPEG, PNG ou HEIC, 8 Mo maximum.
            </p>
            <label
              htmlFor="photo-reference"
              className="mt-3 inline-flex h-12 cursor-pointer items-center gap-2 rounded-sv border border-border-strong bg-white/[.06] px-4 font-sora text-[15px] font-semibold hover:bg-white/[.12]"
            >
              <span className="material-symbols-rounded !text-[19px]" aria-hidden="true">add_a_photo</span>
              {enCours === "photo" ? "Dépôt en cours…" : "Choisir une photo"}
            </label>
            <input
              ref={champPhoto}
              id="photo-reference"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="sr-only"
              disabled={enCours !== null}
              onChange={(e) => {
                const fichier = e.target.files?.[0];
                if (fichier) void deposerPhoto(fichier);
              }}
            />
          </div>

          <div className="mt-5 border-t border-border pt-5">
            <h3 className="font-sora text-[15px] font-semibold">Retirer votre accord</h3>
            <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-text-secondary">
              La photo et son empreinte sont effacées immédiatement. Les photos déjà achetées restent
              à vous.
            </p>
            <Button
              variant="danger"
              className="mt-3 h-12 text-[15px]"
              loading={enCours === "retrait"}
              disabled={enCours !== null}
              onClick={() => void retirerAccord()}
            >
              Retirer mon accord
            </Button>
          </div>
        </section>
      ) : (
        <section className="rounded-sv border border-border bg-white/[.04] p-5">
          <h2 className="font-sora text-[18px] font-semibold">Comment ça marche</h2>
          <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-text-secondary">
            Vous déposez une photo de {prenom}, bien visible et de face. SportVision en calcule une
            empreinte numérique et s&apos;en sert pour le retrouver sur les photos des prochaines
            galeries de son club. Quand la ressemblance est très sûre, la photo lui est attribuée
            automatiquement ; sinon, une personne de SportVision vérifie avant.
          </p>

          <h3 className="mt-5 font-sora text-[15px] font-semibold">Ce que nous conservons</h3>
          <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-text-secondary">
            La photo que vous déposez et son empreinte numérique, rattachées au compte de {prenom}.
            Rien d&apos;autre. Elles ne servent qu&apos;à le retrouver dans les galeries de son club.
          </p>

          <h3 className="mt-4 font-sora text-[15px] font-semibold">Ce que nous ne faisons pas</h3>
          <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-text-secondary">
            Nous ne créons aucun fichier de visages consultable. Nous ne vous identifions nulle part
            ailleurs. Nous ne transmettons ces données à personne, ni au club, ni à un autre parent.
            Les visages des autres enfants présents sur une photo ne sont jamais enregistrés.
          </p>

          <h3 className="mt-4 font-sora text-[15px] font-semibold">Vous pouvez changer d&apos;avis à tout moment</h3>
          <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-text-secondary">
            Un bouton sur cette page retire votre accord. La photo et l&apos;empreinte sont effacées
            immédiatement. Les photos déjà achetées restent à vous.
          </p>

          <h3 className="mt-4 font-sora text-[15px] font-semibold">Durée</h3>
          <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-text-secondary">
            L&apos;accord vaut pour la saison en cours. À la fin de la saison, les empreintes sont
            effacées et il vous sera redemandé.
          </p>

          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5">
            <label className="flex max-w-[62ch] cursor-pointer items-start gap-3 text-[14px] leading-relaxed text-text-secondary">
              <input
                type="checkbox"
                className="mt-0.5 h-[18px] w-[18px] flex-none accent-[#4F7DFF]"
                checked={autoriteParentale}
                onChange={(e) => setAutoriteParentale(e.target.checked)}
              />
              <span>
                J&apos;atteste être titulaire de l&apos;autorité parentale sur {prenom} (ou son
                représentant légal).
              </span>
            </label>
            <label className="flex max-w-[62ch] cursor-pointer items-start gap-3 text-[14px] leading-relaxed text-text-secondary">
              <input
                type="checkbox"
                className="mt-0.5 h-[18px] w-[18px] flex-none accent-[#4F7DFF]"
                checked={autorise}
                onChange={(e) => setAutorise(e.target.checked)}
              />
              <span>
                J&apos;autorise SportVision à reconnaître le visage de {prenom} sur les photos des
                galeries de son club, dans les conditions ci-dessus.
              </span>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              className="h-12 text-[15px]"
              loading={enCours === "accord"}
              disabled={!autoriteParentale || !autorise || enCours !== null}
              onClick={() => void donnerAccord()}
            >
              J&apos;accepte et je dépose la photo
            </Button>
            <Link
              href={`/particulier/sportifs/${detail.kind}/${detail.ref_id}`}
              className="flex h-12 items-center rounded-sv border border-border-strong bg-white/[.06] px-4 font-sora text-[15px] font-semibold hover:bg-white/[.12]"
            >
              Non merci
            </Link>
          </div>
          {etat?.retire_le && (
            <p className="mt-3 text-[13px] text-text-tertiary">
              Accord retiré le{" "}
              {new Date(etat.retire_le).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.
              Vous pouvez le redonner quand vous le souhaitez.
            </p>
          )}
        </section>
      )}

      <p className="text-[13px] leading-relaxed text-text-tertiary">
        <a href={LEGAL_URLS.confidentialite} target="_blank" rel="noreferrer" className="underline hover:text-text-secondary">
          Comment vos données sont protégées
        </a>{" "}
        · Pour toute question : contact@sportvision-an.fr
      </p>
    </div>
  );
}
