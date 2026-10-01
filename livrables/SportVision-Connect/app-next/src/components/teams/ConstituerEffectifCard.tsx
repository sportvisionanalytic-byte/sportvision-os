"use client";

// Constituer l'effectif d'une catégorie, en collant une liste (migrations v384 et v385).
//
// Fouka, 01/10/2026 : « J'ai fait le média avec Fontainebleau. J'ai tous les noms, prénoms, et les
// photos de tous les joueurs. Du coup je peux créer moi-même les profils des joueurs. »
//
// ── POURQUOI UN COLLAGE, ET PAS TRENTE FORMULAIRES ──
// Parce qu'il y a 27 catégories à Fontainebleau. Saisir une catégorie, c'est coller la colonne qu'on
// a déjà dans un tableur, pas remplir trente fois le même écran.
//
// ── LA DATE DE NAISSANCE EST FACULTATIVE (v389, et v420 qui l'a rendue vraie) ──
// Fouka ne saisit que ce qu'il a relevé sur le terrain : prénom, nom, catégorie, photo. La famille
// renseigne la date en s'inscrivant. L'écran et la base disaient tous les deux l'inverse jusqu'à la
// v420, et refusaient donc l'intégralité des 27 catégories de Fontainebleau.
// Ce n'est pas un relâchement : tant que la date manque, la base refuse qu'une photo devienne une
// empreinte, et `sv_age_bracket` rend 'inconnu' — donc les protections du mineur s'appliquent.
//
// ── CE QUE CET ÉCRAN NE PEUT PAS FAIRE, ET C'EST VOULU ──
// Calculer une empreinte. Déposer une photo ne fait qu'enregistrer une PHOTO : elle attend dans une
// table que la chaîne de reconnaissance ne lit nulle part. Elle ne devient une référence qu'au
// moment où la famille donne son accord, et l'empreinte se calcule après. Cet écran n'a aucun
// chemin pour inverser cet ordre.
//
// ── LE DROIT VIENT DE LA BASE ──
// `effectif_peut_constituer` décide de l'affichage du bouton, et `effectif_constituer` refuse de
// toute façon. L'administration et la Production SportVision partout, le CM affecté et le bureau du
// club sur leur club, le coach SUR SES ÉQUIPES SEULEMENT. On ne rejoue pas cette règle ici.

import { useMemo, useState } from "react";
import { ClipboardPaste, Info, Users } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { createClient } from "@/lib/supabase/client";
import {
  LIGNES_MAX,
  VERDICT_LABEL,
  VERDICT_TONE,
  constituerEffectif,
  lireLignesCollees,
  type VerdictEffectif,
} from "@/lib/data/club/effectif";

// La première ligne est la forme que Fouka colle le 01/10 : prénom et nom seuls. Les suivantes
// montrent que la date reste acceptée quand on l'a, et qu'on peut la laisser vide avant un numéro.
const EXEMPLE = `Léa;Moreau
Noah;Diallo;;10
Inès;Bernard;2017-11-22;4;F`;

export function ConstituerEffectifCard({
  teamId,
  nomEquipe,
  onEffectifChange,
}: {
  teamId: string;
  nomEquipe: string;
  onEffectifChange: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [texte, setTexte] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<VerdictEffectif[] | null>(null);

  // La lecture est faite à la frappe : on montre ce qui sera envoyé AVANT de l'envoyer, et ce qui
  // ne sera pas lu, avec sa raison. Une liste qui part à moitié sans le dire est pire qu'un refus.
  const { lignes, erreurs } = useMemo(() => lireLignesCollees(texte), [texte]);
  const tropLong = lignes.length > LIGNES_MAX;

  async function envoyer() {
    setEnvoi(true);
    setErreur(null);
    setVerdicts(null);
    try {
      const r = await constituerEffectif(createClient(), teamId, lignes);
      setVerdicts(r);
      if (r.some((v) => v.verdict !== "refusee")) {
        setTexte("");
        onEffectifChange();
      }
    } catch (e) {
      setErreur(
        e instanceof Error && e.message
          ? e.message
          : "Enregistrement impossible pour le moment.",
      );
    } finally {
      setEnvoi(false);
    }
  }

  if (!ouvert) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue-electric" aria-hidden />
          <div>
            <div className="text-[13.5px] font-extrabold">Constituer l&apos;effectif de {nomEquipe}</div>
            <p className="mt-0.5 max-w-[560px] text-[12.5px] leading-relaxed text-text-soft">
              Créez les fiches des sportifs sans attendre que les familles s&apos;inscrivent. Quand un
              parent arrivera, il retrouvera le prénom et le nom de son enfant au lieu de les saisir.
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => setOuvert(true)}>
          <ClipboardPaste className="h-3.5 w-3.5" aria-hidden />
          Coller une liste
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-extrabold">Constituer l&apos;effectif de {nomEquipe}</div>
          <p className="mt-1 max-w-[620px] text-[12.5px] leading-relaxed text-text-soft">
            Une ligne par sportif : <strong>prénom ; nom</strong> suffisent. Ensuite, si vous les
            avez, la date de naissance, le numéro de maillot puis M ou F. Le point-virgule, la
            virgule et la tabulation font tous l&apos;affaire, donc un copier-coller de tableur passe
            directement.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setOuvert(false);
            setVerdicts(null);
            setErreur(null);
          }}
        >
          Fermer
        </Button>
      </div>

      <div className="flex items-start gap-2.5 rounded-sv border border-border-strong/60 bg-surface-alt px-3.5 py-3">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue-electric" aria-hidden />
        <p className="text-[12px] leading-relaxed text-text-soft">
          <strong>La date de naissance est facultative</strong> : si vous ne l&apos;avez pas, laissez-la
          vide, la famille la renseignera en s&apos;inscrivant. Tant qu&apos;elle manque, une photo
          déposée reste en attente et ne devient jamais une empreinte : c&apos;est elle qui décide à
          qui demander l&apos;autorisation de reconnaissance, un parent avant 15 ans et le sportif
          lui-même ensuite. Elle n&apos;est jamais déduite de la catégorie, et une date qu&apos;on
          n&apos;arrive pas à lire est rendue plutôt que devinée.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-bold text-text-soft">La liste</span>
        <textarea
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={EXEMPLE}
          className="w-full rounded-sv border border-border-strong bg-surface px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-text outline-none focus:border-brand-blue-electric"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={lignes.length > 0 && !tropLong ? "info" : "neutral"}>
          {lignes.length} ligne{lignes.length > 1 ? "s" : ""} prête{lignes.length > 1 ? "s" : ""}
        </Badge>
        {erreurs.length > 0 && (
          <Badge tone="warning">
            {erreurs.length} ligne{erreurs.length > 1 ? "s" : ""} non lue{erreurs.length > 1 ? "s" : ""}
          </Badge>
        )}
        <div className="ml-auto">
          <Button onClick={envoyer} loading={envoi} disabled={lignes.length === 0 || tropLong}>
            Créer {lignes.length > 0 ? `${lignes.length} fiche${lignes.length > 1 ? "s" : ""}` : "les fiches"}
          </Button>
        </div>
      </div>

      {tropLong && (
        <p className="text-[12.5px] font-semibold text-status-danger">
          {LIGNES_MAX} sportifs au maximum par envoi. Découpez la liste en deux.
        </p>
      )}

      {erreurs.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-sv border border-warning-bg bg-warning-bg/30 px-3.5 py-3">
          <div className="text-[12px] font-extrabold text-warning-fg">
            Ces lignes ne partiront pas en l&apos;état
          </div>
          <ul className="flex flex-col gap-1">
            {erreurs.slice(0, 12).map((e) => (
              <li key={e.ligne} className="text-[12px] leading-relaxed text-text-soft">
                <span className="font-mono">{e.texte.slice(0, 70)}</span> — {e.raison}
              </li>
            ))}
            {erreurs.length > 12 && (
              <li className="text-[12px] text-text-soft">et {erreurs.length - 12} autre(s).</li>
            )}
          </ul>
        </div>
      )}

      {erreur && (
        <p className="text-[12.5px] font-semibold text-status-danger">{erreur}</p>
      )}

      {verdicts && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[12px] font-extrabold">Ce que la base a enregistré</div>
          <ul className="flex flex-col divide-y divide-divider">
            {verdicts.map((v) => (
              <li key={v.rang} className="flex flex-wrap items-center gap-2.5 py-2">
                <span className="w-7 text-[11.5px] font-bold text-text-soft">{v.rang}</span>
                <span className="text-[13px] font-semibold">
                  {v.prenom} {v.nom}
                </span>
                <Badge tone={VERDICT_TONE[v.verdict]}>{VERDICT_LABEL[v.verdict]}</Badge>
                {v.detail && (
                  <span className="text-[12px] text-text-soft">{v.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
