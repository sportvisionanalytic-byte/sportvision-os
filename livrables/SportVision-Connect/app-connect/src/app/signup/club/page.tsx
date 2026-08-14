"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";
import { savePendingOnboarding, consumePendingOnboarding } from "@/lib/signup/pending-onboarding";
import { useSignup } from "../signup-context";

type ClubChoice = "search" | "declare" | "none" | null;
interface ClubResult {
  id: string;
  nom: string;
  ville: string | null;
}

// Étape 4 · Club — voir README design § Inscription. Dernière étape du tunnel : c'est ICI que
// auth.signUp() est réellement appelé (une fois toutes les informations réunies), suivi de la
// sauvegarde de l'action club en attente (voir lib/signup/pending-onboarding.ts) — le vrai
// rattachement se fait au premier login, une fois l'e-mail confirmé (voir en-tête de l'edge
// function connect-player-onboarding pour le détail).
export default function SignupClubPage() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const [choice, setChoice] = useState<ClubChoice>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClubResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ClubResult | null>(null);
  const [declareName, setDeclareName] = useState("");
  const [declareCity, setDeclareCity] = useState("");
  const [declareTeam, setDeclareTeam] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.email.trim() || !state.password) router.replace("/signup");
  }, [state.email, state.password, router]);

  useEffect(() => {
    if (choice !== "search" || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const supabase = createClient();
    const t = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      const { data, error } = await supabase.functions.invoke("connect-player-onboarding", {
        body: { action: "search", query: query.trim() },
      });
      setSearching(false);
      if (error || data?.error) {
        setSearchError(
          "Recherche indisponible pour le moment — vous pouvez ajouter votre club manuellement.",
        );
        return;
      }
      setResults(data?.results || []);
    }, 300);
    return () => clearTimeout(t);
  }, [choice, query]);

  const isSportLike = state.profile === "joueur" || state.profile === "sportif";

  async function handleSubmit() {
    setTouched(true);
    if (choice === "declare" && (!declareName.trim() || !declareCity.trim())) return;
    if (choice === "search" && !selected) return;
    if (busy) return;

    setBusy(true);
    setSubmitError(null);
    const supabase = createClient();

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: state.email,
      password: state.password,
      options: {
        data: {
          first_name: state.firstName,
          last_name: state.lastName,
        },
        // Sans ça, le lien du mail de confirmation redirige vers "/" avec ?code=... jamais
        // traité (bug corrigé le 14/08) — voir auth/callback/route.ts pour l'échange du code.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (signUpError) {
      setBusy(false);
      setSubmitError(
        signUpError.message.toLowerCase().includes("already")
          ? "Un compte SportVision utilise déjà cette adresse."
          : "Impossible de créer le compte pour le moment.",
      );
      return;
    }

    // Type de compte (joueur vs particulier) — voir lib/signup/pending-onboarding.ts et
    // migration-connect-v51-espace-particulier.sql §1 : c'est ICI, au tout premier point où le
    // choix de l'étape Profil (signup-context.tsx) peut être capturé de façon durable, que le
    // filet "pending" est amorcé — pour TOUS les profils, pas seulement joueur/sportif (avant ce
    // correctif, un profil particulier/parent/autre ne déclenchait aucun savePendingOnboarding
    // du tout, donc aucun account_type n'était jamais écrit).
    const accountType: "joueur" | "particulier" = isSportLike ? "joueur" : "particulier";

    if (isSportLike) {
      if (choice === "search" && selected) {
        savePendingOnboarding({
          action: "join",
          orgId: selected.id,
          orgName: selected.nom,
          prenom: state.firstName,
          nom: state.lastName,
          dateNaissance: state.dateNaissance,
          accountType,
        });
      } else if (choice === "declare") {
        savePendingOnboarding({
          action: "declare",
          name: declareName,
          city: declareCity,
          team: declareTeam,
          prenom: state.firstName,
          nom: state.lastName,
          accountType,
        });
      } else {
        savePendingOnboarding({ action: "skip", accountType });
      }
    } else {
      // Particulier / parent / autre : pas d'étape club (voir le rendu conditionnel ci-dessous),
      // mais le type de compte doit être rejoué au premier login comme pour un profil joueur.
      savePendingOnboarding({ action: "skip", accountType });
    }

    patch({
      clubMode: choice,
      selectedClubId: selected?.id ?? null,
      selectedClubName: selected?.nom ?? "",
      declareName,
      declareCity,
      declareTeam,
    });

    // Si le projet Supabase a la confirmation d'e-mail désactivée (ou si ce compte était déjà
    // confirmé), signUp() renvoie directement une session exploitable : pas besoin de l'écran
    // "Vérifiez votre boîte mail", on rejoue tout de suite l'action club en attente. Sinon
    // (cas normal, confirmation active), pas de session avant le clic sur le lien reçu par
    // e-mail — voir lib/signup/pending-onboarding.ts pour le rejeu au premier login.
    if (signUpData.session) {
      try {
        await consumePendingOnboarding(supabase);
      } catch (e) {
        console.error("[signup/club] rejeu immédiat de l'action club échoué :", e);
      }
      setBusy(false);
      router.push("/dashboard");
      router.refresh();
      return;
    }

    setBusy(false);
    router.push("/signup/verify");
  }

  if (!isSportLike) {
    // Particulier/parent/autre : pas d'étape club dans le nouveau design — on saute directement
    // à la création du compte (même écran de choix simplifié pour rester cohérent visuellement,
    // sans les options de recherche de club qui n'ont pas de sens pour ce profil).
    return (
      <div className="flex flex-col gap-6 animate-sv-in">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[31px] font-bold tracking-tight">Votre espace est prêt à être créé</h1>
          <p className="text-[15px] leading-relaxed text-text-tertiary">
            Vérifiez vos informations puis créez votre compte.
          </p>
        </div>
        {submitError && (
          <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
            <span className="material-symbols-rounded !text-[19px] text-danger">error</span>
            <span className="text-[13px] leading-relaxed text-[#FBCFE8]">{submitError}</span>
          </div>
        )}
        <Button onClick={() => { setChoice("none"); handleSubmit(); }} loading={busy} className="w-full">
          Créer mon compte
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      {choice === null && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[31px] font-bold tracking-tight">
              Vous jouez actuellement dans un club ou une structure ?
            </h1>
            <p className="text-[15px] text-text-tertiary">Ce n&apos;est pas obligatoire pour utiliser Connect.</p>
          </div>
          <div className="flex flex-col gap-3">
            <ClubChoiceCard
              icon="search"
              iconColor="#22D3EE"
              label="Oui"
              sub="Je cherche mon club, mon académie ou ma structure."
              onClick={() => setChoice("search")}
            />
            <ClubChoiceCard
              icon="add_home_work"
              iconColor="#C084FC"
              label="Autre — mon club n'est pas sur SportVision"
              sub="Je l'ajoute moi-même comme club déclaré."
              onClick={() => setChoice("declare")}
            />
            <ClubChoiceCard
              icon="schedule"
              iconColor="#9A9AB8"
              label="Non / plus tard"
              sub="Je l'ajouterai depuis Mes affiliations."
              onClick={() => { setChoice("none"); }}
            />
          </div>
        </>
      )}

      {choice === "search" && (
        <>
          <BackLink onClick={() => setChoice(null)} />
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[31px] font-bold tracking-tight">Trouvez votre club</h1>
            <p className="text-[15px] text-text-tertiary">Club, académie ou structure sportive.</p>
          </div>
          <div className="relative flex">
            <span className="material-symbols-rounded absolute left-4 top-4 !text-[22px] text-text-faint">search</span>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Rechercher un club, une académie ou une structure…"
              className="h-[54px] w-full rounded-sv border border-border-strong bg-surface pl-[48px] pr-4 text-[15px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)]"
            />
          </div>

          {searching && <span className="text-[13px] text-text-tertiary">Recherche…</span>}
          {searchError && <span className="text-[13px] text-danger">{searchError}</span>}

          {!searching && query.trim().length >= 2 && results.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {results.map((c) => {
                const isSelected = selected?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className={`flex items-center gap-3.5 rounded-sv-card border p-4 text-left transition-colors duration-150 ${
                      isSelected ? "border-[#8CA9FF]/60 bg-[rgba(79,125,255,.12)]" : "border-border bg-surface hover:bg-surface-hover"
                    }`}
                  >
                    <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-sv bg-white/5 font-mono text-[8px] text-text-faint">
                      logo
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="font-sora text-[15px] font-semibold text-text">{c.nom}</span>
                      <span className="text-[13px] text-text-tertiary">{c.ville || "Ville non précisée"}</span>
                      <span className="mt-0.5 self-start rounded-sv-pill bg-affiliations-bg px-2.5 py-1 text-[11px] font-medium text-affiliations">
                        ✓ Partenaire SportVision
                      </span>
                    </span>
                    <span className="ml-auto flex-none font-sora text-[13px] font-semibold text-[#8CA9FF]">
                      {isSelected ? "Sélectionné" : "Sélectionner"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {!searching && query.trim().length >= 2 && results.length === 0 && !searchError && (
            <div className="flex flex-col items-center gap-3 rounded-sv-card border border-dashed border-border-strong p-6 text-center">
              <span className="material-symbols-rounded !text-[24px] text-text-tertiary">search_off</span>
              <span className="font-sora text-[16px] font-semibold">Votre club n&apos;apparaît pas ?</span>
              <span className="max-w-[320px] text-[13px] leading-relaxed text-text-tertiary">
                Vous pouvez tout de même l&apos;ajouter à votre profil.
              </span>
              <button
                type="button"
                onClick={() => { setDeclareName(query); setChoice("declare"); }}
                className="mt-1 rounded-sv border border-border-strong bg-surface px-4 py-2.5 text-[13px] font-semibold text-text hover:bg-surface-hover"
              >
                Ajouter mon club
              </button>
            </div>
          )}

          {submitError && <ErrorBanner message={submitError} />}

          <Button onClick={handleSubmit} disabled={!selected} loading={busy} className="w-full">
            Rejoindre {selected ? `« ${selected.nom} »` : ""}
          </Button>
        </>
      )}

      {choice === "declare" && (
        <>
          <BackLink onClick={() => setChoice(null)} />
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[31px] font-bold tracking-tight">Ajouter mon club</h1>
            <p className="text-[15px] leading-relaxed text-text-tertiary">
              Ce club sera signalé à SportVision comme club non partenaire. Il ne devient pas
              partenaire SportVision pour autant.
            </p>
          </div>
          <Field
            id="dc-name"
            label="Nom du club"
            placeholder="US Exemple"
            value={declareName}
            onChange={(e) => setDeclareName(e.target.value)}
            error={touched && !declareName.trim() ? "Renseignez le nom du club." : null}
          />
          <Field
            id="dc-city"
            label="Ville"
            placeholder="Nemours"
            value={declareCity}
            onChange={(e) => setDeclareCity(e.target.value)}
            error={touched && !declareCity.trim() ? "Renseignez la ville." : null}
          />
          <Field
            id="dc-team"
            label="Équipe ou catégorie · facultatif"
            placeholder="U18"
            value={declareTeam}
            onChange={(e) => setDeclareTeam(e.target.value)}
          />
          {submitError && <ErrorBanner message={submitError} />}
          <Button onClick={handleSubmit} loading={busy} className="w-full">
            Ajouter à mon profil
          </Button>
        </>
      )}

      {choice === "none" && (
        <>
          <BackLink onClick={() => setChoice(null)} />
          <span className="flex h-[66px] w-[66px] items-center justify-center rounded-sv-card bg-affiliations-bg">
            <span className="material-symbols-rounded !text-[32px] text-affiliations">check</span>
          </span>
          <div className="flex flex-col gap-2.5">
            <h1 className="font-sora text-[28px] font-bold tracking-tight">Aucun problème</h1>
            <p className="text-[15px] leading-relaxed text-text-tertiary">
              Vous pouvez utiliser SportVision Connect sans être affilié à un club. Vous pourrez
              ajouter une structure à tout moment depuis Mes affiliations.
            </p>
          </div>
          {submitError && <ErrorBanner message={submitError} />}
          <Button onClick={handleSubmit} loading={busy} className="w-full">
            Créer mon compte
          </Button>
        </>
      )}
    </div>
  );
}

function ClubChoiceCard({
  icon,
  iconColor,
  label,
  sub,
  onClick,
}: {
  icon: string;
  iconColor: string;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[74px] items-center gap-3.5 rounded-sv-card border border-border bg-surface p-4.5 text-left transition-colors duration-150 hover:bg-surface-hover"
    >
      <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-sv bg-white/5">
        <span className="material-symbols-rounded !text-[23px]" style={{ color: iconColor }}>
          {icon}
        </span>
      </span>
      <span className="flex flex-col gap-1">
        <span className="font-sora text-[16px] font-semibold text-text">{label}</span>
        <span className="text-[13px] leading-snug text-text-tertiary">{sub}</span>
      </span>
      <span className="material-symbols-rounded ml-auto !text-[22px] text-text-label">chevron_right</span>
    </button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 self-start text-[13px] font-medium text-text-tertiary hover:text-text"
    >
      <span className="material-symbols-rounded !text-[18px]">arrow_back</span>
      Retour
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
      <span className="material-symbols-rounded !text-[19px] text-danger">error</span>
      <span className="text-[13px] leading-relaxed text-[#FBCFE8]">{message}</span>
    </div>
  );
}
