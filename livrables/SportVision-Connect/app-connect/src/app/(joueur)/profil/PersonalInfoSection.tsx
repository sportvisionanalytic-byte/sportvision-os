"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EditModal } from "@/components/ui/EditModal";
import { Avatar } from "@/components/ui/Avatar";
import { createClient } from "@/lib/supabase/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function PersonalInfoSection({
  firstName,
  lastName,
  email,
  telephone,
  playerId,
  avatarUrl,
  isAgent,
  nomAgence,
}: {
  firstName: string;
  lastName: string;
  email: string;
  telephone: string;
  playerId: string | null;
  avatarUrl: string | null;
  // Nom de l'agence (connect_profile_settings.nom_agence, migration-connect-v69) — facultatif,
  // n'affecte QUE l'Espace particulier avec profil_particulier='agent' (voir particulier/profil/
  // page.tsx). Non transmis par l'Espace joueur (profil/page.tsx), donc absent (undefined) là-bas
  // et sans effet sur cet écran.
  isAgent?: boolean;
  nomAgence?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fn, setFn] = useState(firstName);
  const [ln, setLn] = useState(lastName);
  const [em, setEm] = useState(email);
  const [ph, setPh] = useState(telephone);
  const [ag, setAg] = useState(nomAgence || "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(avatarUrl);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload direct client → Storage (bucket portail-media, migration-connect-v55-photo-profil.sql,
  // même schéma que la pièce jointe des messages) : chemin toujours avatars/<user_id>/photo.<ext>
  // (nom fixe, pas d'horodatage) pour que remplacer sa photo écrase l'ancienne plutôt que
  // d'accumuler des fichiers orphelins dans le bucket.
  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      setPhotoError("Format non supporté (JPG, PNG ou WebP uniquement).");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setPhotoError("Image trop lourde (4 Mo maximum).");
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setPhotoBusy(false);
      setPhotoError("Session expirée, reconnectez-vous.");
      return;
    }
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `avatars/${userId}/photo.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("portail-media")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) {
      setPhotoBusy(false);
      setPhotoError("Impossible d'envoyer la photo pour le moment.");
      return;
    }
    const { data: pub } = supabase.storage.from("portail-media").getPublicUrl(path);
    // Suffixe de cache-busting : le chemin est fixe (toujours photo.<ext>), donc sans ce
    // paramètre le navigateur continuerait d'afficher l'ancienne photo en cache après un
    // remplacement.
    const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;
    const { error: dbError } = await supabase
      .from("connect_profile_settings")
      .upsert({ user_id: userId, avatar_url: publicUrl }, { onConflict: "user_id" });
    setPhotoBusy(false);
    if (dbError) {
      setPhotoError("Photo envoyée mais impossible de l'enregistrer sur votre profil.");
      return;
    }
    setPhotoUrl(publicUrl);
    router.refresh();
  }

  function openModal() {
    setFn(firstName);
    setLn(lastName);
    setEm(email);
    setPh(telephone);
    setAg(nomAgence || "");
    setTouched(false);
    setError(null);
    setEmailPending(false);
    setOpen(true);
  }

  const fnError = touched && !fn.trim() ? "Renseignez votre prénom." : null;
  const lnError = touched && !ln.trim() ? "Renseignez votre nom." : null;
  const emError = touched && !EMAIL_RE.test(em.trim()) ? "Adresse e-mail invalide." : null;
  const ok = !!fn.trim() && !!ln.trim() && EMAIL_RE.test(em.trim());

  async function handleSave() {
    setTouched(true);
    if (!fn.trim() || !ln.trim() || !EMAIL_RE.test(em.trim())) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const emailChanged = em.trim().toLowerCase() !== email.trim().toLowerCase();
    const { error: authError } = await supabase.auth.updateUser({
      ...(emailChanged ? { email: em.trim() } : {}),
      data: { first_name: fn.trim(), last_name: ln.trim() },
    });
    if (authError) {
      setBusy(false);
      setError("Impossible de mettre à jour vos informations pour le moment.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (userId) {
      await supabase.from("connect_profile_settings").upsert(
        {
          user_id: userId,
          telephone: ph.trim() || null,
          ...(isAgent ? { nom_agence: ag.trim() || null } : {}),
        },
        { onConflict: "user_id" },
      );
      // Garde player_profiles (roster Club+) cohérent avec l'identité éditée ici, quand une
      // ligne existe — voir migration §1, "une seule identité" (MASTER-CONNECT-V1.md §5).
      if (playerId) {
        await supabase.from("player_profiles").update({ prenom: fn.trim(), nom: ln.trim() }).eq("id", playerId);
      }
    }

    setBusy(false);
    if (emailChanged) {
      setEmailPending(true);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <h2 className="font-sora text-[17px] font-semibold">Informations personnelles</h2>
        <button
          type="button"
          onClick={openModal}
          className="ml-auto flex h-[38px] flex-none items-center gap-1.5 rounded-sv border border-border-strong bg-white/[.03] px-3.5 font-sora text-[14px] font-semibold hover:bg-white/[.08] lg:text-[13px]"
        >
          <span className="material-symbols-rounded !text-[17px]" aria-hidden="true">edit</span>
          Modifier
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-none">
          <Avatar url={photoUrl} label={firstName} size={64} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={photoBusy}
            aria-label="Changer la photo de profil"
            className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-sv-gradient text-white disabled:opacity-60"
          >
            <span className="material-symbols-rounded !text-[13px]" aria-hidden="true">
              {photoBusy ? "hourglass_empty" : "photo_camera"}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handlePhotoChange}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-medium text-text lg:text-[13px]">Photo de profil</span>
          <span className="text-[12px] text-text-tertiary">JPG, PNG ou WebP · 4 Mo maximum</span>
          {photoError && <span className="text-[13px] text-danger lg:text-[12px]">{photoError}</span>}
        </div>
      </div>

      {/* grid-cols-1 sous sm: — "E-mail" peut être une adresse longue (jean.dupont@exemple.com),
          illisible/repliée dans une colonne de ~150px sur mobile en grid-cols-2 fixe. Même
          pattern d'empilement que les Fact de CommandeDetailView.tsx. */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <InfoField label="Prénom" value={firstName || "—"} />
        <InfoField label="Nom" value={lastName || "—"} />
        <InfoField label="E-mail" value={email || "—"} />
        <InfoField label="Téléphone" value={telephone || "—"} />
        {isAgent && <InfoField label="Nom de l'agence" value={nomAgence || "—"} />}
      </div>

      {open && (
        <EditModal
          title="Informations personnelles"
          subtitle="Ces informations servent à vos réservations et à vos factures."
          onClose={() => setOpen(false)}
          busy={busy}
          error={error}
        >
          {emailPending ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-2.5 rounded-sv border border-affiliations/40 bg-affiliations-bg px-4 py-3.5">
                <span className="material-symbols-rounded !text-[19px] text-affiliations" aria-hidden="true">mark_email_read</span>
                <span className="text-[14px] leading-relaxed text-text-secondary lg:text-[13px]">
                  Vérifiez votre boîte mail pour confirmer votre nouvelle adresse e-mail. Vos autres
                  informations ont bien été mises à jour.
                </span>
              </div>
              <Button
                onClick={() => {
                  setOpen(false);
                  router.refresh();
                }}
                className="w-full"
              >
                Fermer
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Field id="pi-fn" label="Prénom" value={fn} onChange={(e) => setFn(e.target.value)} error={fnError} />
              <Field id="pi-ln" label="Nom" value={ln} onChange={(e) => setLn(e.target.value)} error={lnError} />
              <Field id="pi-em" label="Adresse e-mail" type="email" value={em} onChange={(e) => setEm(e.target.value)} error={emError} />
              <Field id="pi-ph" label="Téléphone" type="tel" placeholder="06 12 34 56 78" value={ph} onChange={(e) => setPh(e.target.value)} />
              {isAgent && (
                <Field
                  id="pi-ag"
                  label="Nom de l'agence"
                  placeholder="Nom de votre agence"
                  value={ag}
                  onChange={(e) => setAg(e.target.value)}
                />
              )}
              <Button onClick={handleSave} loading={busy} disabled={!ok && touched} className="w-full">
                Enregistrer
              </Button>
            </div>
          )}
        </EditModal>
      )}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">{label}</span>
      <span className="text-[15px] font-medium">{value}</span>
    </div>
  );
}
