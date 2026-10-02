// CONSTITUER L'EFFECTIF — REFAIT LE 02/10/2026
//
// Fouka, après avoir vu la première version : « c'est super mal fait. Il faut que je crée un
// enfant, je mets nom, prénom, photo de référence, hop. Nom, prénom, photo, hop. Ou alors je crée
// tous les noms d'un coup et j'ajoute les photos après. »
//
// CE QUI N'ALLAIT PAS : il n'y avait qu'une seule façon de faire, coller une liste, et elle était
// repliée derrière un bouton. Pour pré-créer un enfant avec sa photo — le geste que Fouka fait
// réellement, un enfant à la fois, devant lui — il fallait coller une ligne, valider, chercher le
// joueur dans la liste du dessous, puis déposer sa photo. Quatre gestes pour un enfant.
//
// LES DEUX MODES SONT MAINTENANT CÔTE À CÔTE, et « un par un » est celui qui s'ouvre :
//   · UN PAR UN : prénom, nom, photo, Entrée. Le champ se vide et reprend le focus. On enchaîne.
//   · COLLER UNE LISTE : les 27 catégories d'un coup, puis les photos après, dans la grille.
//
// LA PHOTO EST FACULTATIVE (décision de Fouka, 02/10) : un enfant absent le jour de la saisie ne
// doit pas bloquer la création de sa fiche. La grille signale ensuite qui n'en a pas.
//
// L'APPAREIL PHOTO EST PROPOSÉ QUAND IL EXISTE. Fouka saisit « des deux » côtés : au Mac avec des
// fichiers, et au téléphone sur le terrain. `capture="user"` ouvre l'appareil photo sur mobile et
// est simplement ignoré sur ordinateur, où le sélecteur de fichiers s'ouvre normalement. Un seul
// champ pour les deux usages, pas deux boutons dont un ne marche jamais.
//
// ── CE QUE CET ÉCRAN NE PEUT PAS FAIRE, ET C'EST VOULU ──
// Calculer une empreinte. Déposer une photo ne fait qu'enregistrer une PHOTO : elle attend dans
// une table que la chaîne de reconnaissance ne lit nulle part. Elle ne devient une référence qu'au
// moment où la famille donne son accord, et seulement si la date de naissance est connue — c'est
// elle qui dit à QUI demander cet accord (un parent avant 15 ans, le sportif ensuite).
//
// ── LA DATE DE NAISSANCE EST FACULTATIVE (v389, et v420 qui l'a rendue vraie) ──
// Fouka ne saisit que ce qu'il a relevé sur le terrain. Une date qu'on n'arrive pas à lire est
// RENDUE avec sa raison, jamais avalée : « 04/13/2017 » créerait sinon une fiche muette.

"use client";

import { useRef, useState } from "react";
import { Camera, ClipboardPaste, Info, UserPlus, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { createClient } from "@/lib/supabase/client";
import {
  LIGNES_MAX,
  VERDICT_LABEL,
  VERDICT_TONE,
  constituerEffectif,
  deposerPhotoEffectif,
  lireLignesCollees,
  refuserPhoto,
  type VerdictEffectif,
} from "@/lib/data/club/effectif";

const EXEMPLE = `Léa;Moreau
Noah;Diallo;;10
Inès;Bernard;2017-11-22;4;F`;

/** Ce qu'on vient d'ajouter, gardé à l'écran pour voir la pile monter. */
interface Ajout {
  prenom: string;
  nom: string;
  avecPhoto: boolean;
}

export function ConstituerEffectifCard({
  teamId,
  nomEquipe,
  onEffectifChange,
}: {
  teamId: string;
  nomEquipe: string;
  onEffectifChange: () => void;
}) {
  const [mode, setMode] = useState<"un" | "liste">("un");

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-extrabold">Ajouter des joueurs à {nomEquipe}</div>
          <p className="mt-1 max-w-[620px] text-[12.5px] leading-relaxed text-text-soft">
            Vous créez ici la fiche d&apos;un sportif <strong>avant</strong> qu&apos;il ait un
            compte. Quand sa famille s&apos;inscrira, elle retrouvera cette fiche et ses photos.
          </p>
        </div>
        <div className="flex shrink-0 gap-1 rounded-sv border border-border-strong/60 bg-surface-alt p-1">
          <button
            type="button"
            onClick={() => setMode("un")}
            className={`rounded-sv px-3 py-1.5 text-[12.5px] font-bold transition ${
              mode === "un" ? "bg-brand-blue-electric text-white" : "text-text-soft hover:text-text"
            }`}
          >
            Un par un
          </button>
          <button
            type="button"
            onClick={() => setMode("liste")}
            className={`rounded-sv px-3 py-1.5 text-[12.5px] font-bold transition ${
              mode === "liste" ? "bg-brand-blue-electric text-white" : "text-text-soft hover:text-text"
            }`}
          >
            Coller une liste
          </button>
        </div>
      </div>

      {mode === "un" ? (
        <UnParUn teamId={teamId} onEffectifChange={onEffectifChange} />
      ) : (
        <CollerUneListe teamId={teamId} onEffectifChange={onEffectifChange} />
      )}
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * UN PAR UN — le geste que Fouka fait devant l'enfant.
 * ────────────────────────────────────────────────────────────────────────────────────────── */

function UnParUn({ teamId, onEffectifChange }: { teamId: string; onEffectifChange: () => void }) {
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajouts, setAjouts] = useState<Ajout[]>([]);
  const champPrenom = useRef<HTMLInputElement>(null);
  const champFichier = useRef<HTMLInputElement>(null);

  const pret = prenom.trim().length > 0 && nom.trim().length > 0 && !envoi;

  function choisirPhoto(f: File | null) {
    setErreur(null);
    if (!f) {
      setPhoto(null);
      if (apercu) URL.revokeObjectURL(apercu);
      setApercu(null);
      return;
    }
    // Le refus se dit AVANT l'envoi : un fichier trop lourd ou d'un format inconnu doit être
    // signalé tout de suite, pas après trente secondes de téléversement.
    const refus = refuserPhoto(f);
    if (refus) {
      setErreur(refus);
      return;
    }
    if (apercu) URL.revokeObjectURL(apercu);
    setPhoto(f);
    setApercu(URL.createObjectURL(f));
  }

  async function ajouter() {
    if (!pret) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const supabase = createClient();
      const [verdict] = await constituerEffectif(supabase, teamId, [
        { prenom: prenom.trim(), nom: nom.trim() },
      ]);

      // On relit le VERDICT, on ne suppose pas que ça a marché. Un refus porte sa raison.
      if (!verdict || verdict.verdict === "refusee") {
        setErreur(verdict?.detail ?? "Ce joueur n'a pas pu être ajouté.");
        setEnvoi(false);
        return;
      }

      // La photo n'est déposée QUE si la fiche existe : sans identifiant, on n'invente rien.
      let avecPhoto = false;
      if (photo && verdict.ficheId) {
        try {
          await deposerPhotoEffectif(supabase, verdict.ficheId, photo);
          avecPhoto = true;
        } catch (e) {
          // La fiche est créée, c'est l'essentiel : on le dit, et la photo se rajoute depuis la
          // grille. Faire échouer l'ajout entier ferait perdre le joueur qu'on vient de saisir.
          setErreur(
            `${verdict.prenom} ${verdict.nom} est ajouté, mais sa photo n'a pas pu être enregistrée : ${
              e instanceof Error ? e.message : "erreur inconnue"
            }. Vous pouvez la déposer depuis la grille ci-dessous.`,
          );
        }
      }

      setAjouts((liste) => [{ prenom: verdict.prenom, nom: verdict.nom, avecPhoto }, ...liste]);
      setPrenom("");
      setNom("");
      choisirPhoto(null);
      if (champFichier.current) champFichier.current.value = "";
      onEffectifChange();
      // On reprend le focus sur le prénom : c'est ce qui permet d'enchaîner sans la souris.
      champPrenom.current?.focus();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "L'ajout n'a pas abouti.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-sv border border-border-strong/60 bg-surface-alt p-4 sm:flex-row sm:items-start">
        {/* La photo à gauche, grande et cliquable en entier : c'est la cible la plus facile au
            doigt comme à la souris. */}
        <div className="shrink-0">
          <label
            className="relative flex h-[104px] w-[104px] cursor-pointer items-center justify-center overflow-hidden rounded-sv border-2 border-dashed border-border-strong bg-surface transition hover:border-brand-blue-electric"
            aria-label="Choisir ou prendre la photo de référence"
          >
            {apercu ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={apercu} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex flex-col items-center gap-1 text-text-soft">
                <Camera className="h-5 w-5" aria-hidden />
                <span className="text-[11px] font-bold">Photo</span>
              </span>
            )}
            <input
              ref={champFichier}
              type="file"
              accept="image/*"
              capture="user"
              className="sr-only"
              onChange={(e) => choisirPhoto(e.target.files?.[0] ?? null)}
            />
          </label>
          {photo ? (
            <button
              type="button"
              onClick={() => {
                choisirPhoto(null);
                if (champFichier.current) champFichier.current.value = "";
              }}
              className="mt-1.5 flex items-center gap-1 text-[11.5px] font-bold text-text-soft hover:text-text"
            >
              <X className="h-3 w-3" aria-hidden /> Retirer
            </button>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex-1">
              <span className="mb-1 block text-[11.5px] font-bold text-text-soft">Prénom</span>
              <input
                ref={champPrenom}
                value={prenom}
                onChange={(e) => setPrenom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void ajouter();
                }}
                placeholder="Léa"
                autoCapitalize="words"
                className="h-10 w-full rounded-sv border border-border-strong bg-surface px-3 text-[13.5px] outline-none focus:border-brand-blue-electric"
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-[11.5px] font-bold text-text-soft">Nom</span>
              <input
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void ajouter();
                }}
                placeholder="Moreau"
                autoCapitalize="words"
                className="h-10 w-full rounded-sv border border-border-strong bg-surface px-3 text-[13.5px] outline-none focus:border-brand-blue-electric"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void ajouter()} disabled={!pret}>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {envoi ? "Ajout…" : "Ajouter ce joueur"}
            </Button>
            <span className="text-[11.5px] text-text-soft">
              La photo est facultative, elle peut venir plus tard. Entrée pour enchaîner.
            </span>
          </div>
        </div>
      </div>

      {erreur ? (
        <div className="rounded-sv border border-danger/40 bg-danger/5 px-3.5 py-2.5 text-[12.5px] text-danger">
          {erreur}
        </div>
      ) : null}

      {ajouts.length ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11.5px] font-bold text-text-soft">
            {ajouts.length} ajouté{ajouts.length > 1 ? "s" : ""} à l&apos;instant
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ajouts.map((a, i) => (
              <Badge key={`${a.prenom}-${a.nom}-${i}`} tone={a.avecPhoto ? "success" : "neutral"}>
                {a.prenom} {a.nom}
                {a.avecPhoto ? " · photo" : " · sans photo"}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <NoteBiometrie />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * COLLER UNE LISTE — les 27 catégories d'un coup.
 * ────────────────────────────────────────────────────────────────────────────────────────── */

function CollerUneListe({
  teamId,
  onEffectifChange,
}: {
  teamId: string;
  onEffectifChange: () => void;
}) {
  const [texte, setTexte] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<VerdictEffectif[] | null>(null);

  const { lignes, erreurs } = lireLignesCollees(texte);

  async function envoyer() {
    if (!lignes.length) return;
    setEnvoi(true);
    setErreur(null);
    setVerdicts(null);
    try {
      const r = await constituerEffectif(createClient(), teamId, lignes);
      setVerdicts(r);
      if (r.some((v) => v.verdict !== "refusee")) onEffectifChange();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "La saisie n'a pas abouti.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] leading-relaxed text-text-soft">
        Une ligne par sportif : <strong>prénom ; nom</strong> suffisent. Ensuite, si vous les avez,
        la date de naissance, le numéro de maillot puis M ou F. Le point-virgule, la virgule et la
        tabulation font tous l&apos;affaire, donc un copier-coller de tableur passe directement. Les
        photos s&apos;ajoutent après, dans la grille.
      </p>

      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={7}
        spellCheck={false}
        placeholder={EXEMPLE}
        className="w-full rounded-sv border border-border-strong bg-surface p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-brand-blue-electric"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void envoyer()} disabled={!lignes.length || envoi}>
          <ClipboardPaste className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {envoi ? "Enregistrement…" : `Ajouter ${lignes.length || ""} joueur${lignes.length > 1 ? "s" : ""}`}
        </Button>
        {lignes.length > LIGNES_MAX ? (
          <span className="text-[12px] text-danger">
            {LIGNES_MAX} lignes au maximum à la fois.
          </span>
        ) : null}
      </div>

      {erreurs.length ? (
        <div className="flex flex-col gap-1 rounded-sv border border-warning/40 bg-warning/5 px-3.5 py-2.5">
          <div className="text-[12px] font-bold text-warning">
            {erreurs.length} ligne{erreurs.length > 1 ? "s" : ""} non comprise
            {erreurs.length > 1 ? "s" : ""}, elles ne seront pas envoyées :
          </div>
          {erreurs.map((e) => (
            <div key={e.ligne} className="text-[12px] text-text-soft">
              Ligne {e.ligne} — « {e.texte} » : {e.raison}
            </div>
          ))}
        </div>
      ) : null}

      {erreur ? (
        <div className="rounded-sv border border-danger/40 bg-danger/5 px-3.5 py-2.5 text-[12.5px] text-danger">
          {erreur}
        </div>
      ) : null}

      {verdicts ? (
        <div className="flex flex-col gap-1.5">
          {verdicts.map((v) => (
            <div key={v.rang} className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <Badge tone={VERDICT_TONE[v.verdict]}>{VERDICT_LABEL[v.verdict]}</Badge>
              <span className="font-bold">
                {v.prenom} {v.nom}
              </span>
              {v.detail ? <span className="text-text-soft">{v.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <NoteBiometrie />
    </div>
  );
}

/** La phrase qu'on doit pouvoir dire à un parent qui la demande, écrite une seule fois. */
function NoteBiometrie() {
  return (
    <div className="flex items-start gap-2.5 rounded-sv border border-border-strong/60 bg-surface-alt px-3.5 py-3">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue-electric" aria-hidden />
      <p className="text-[12px] leading-relaxed text-text-soft">
        Une photo déposée ici <strong>reste en attente</strong> : elle ne devient une référence que
        lorsque la famille a donné son accord, et seulement si la date de naissance est connue —
        c&apos;est elle qui dit à qui demander cet accord, un parent avant 15 ans et le sportif
        lui-même ensuite. La date de naissance est facultative à la saisie : la famille la
        renseignera en s&apos;inscrivant, et la photo partira toute seule.
      </p>
    </div>
  );
}
