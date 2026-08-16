"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";

type Choice = "search" | "declare" | "none" | null;
interface ClubResult {
  id: string;
  nom: string;
  ville: string | null;
}

// Recherche/déclaration de club pour un utilisateur déjà authentifié — mêmes actions serveur
// que le tunnel d'inscription (edge function connect-player-onboarding, actions "join"/
// "declare"), voir page.tsx pour le contexte du bug corrigé. Ne rappelle jamais auth.signUp().
export function AddClubForm({
  initialFirstName,
  initialLastName,
}: {
  initialFirstName: string;
  initialLastName: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClubResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ClubResult | null>(null);

  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [dateNaissance, setDateNaissance] = useState("");
  const [declareName, setDeclareName] = useState("");
  const [declareCity, setDeclareCity] = useState("");
  const [declareTeam, setDeclareTeam] = useState("");

  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declaredDone, setDeclaredDone] = useState(false);

  useEffect(() => {
    if (choice !== "search" || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const supabase = createClient();
    const t = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      const { data, error: fnError } = await supabase.functions.invoke("connect-player-onboarding", {
        body: { action: "search", query: query.trim() },
      });
      setSearching(false);
      if (fnError || data?.error) {
        setSearchError("Recherche indisponible pour le moment — vous pouvez ajouter votre club manuellement.");
        return;
      }
      setResults(data?.results || []);
    }, 300);
    return () => clearTimeout(t);
  }, [choice, query]);

  async function handleJoin() {
    setTouched(true);
    if (!selected || !firstName.trim() || !lastName.trim() || !dateNaissance || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("connect-player-onboarding", {
      body: {
        action: "join",
        orgId: selected.id,
        prenom: firstName.trim(),
        nom: lastName.trim(),
        dateNaissance,
      },
    });
    setBusy(false);
    if (fnError || data?.error) {
      setError("Impossible de rejoindre ce club pour le moment. Réessayez dans un instant.");
      return;
    }
    router.push("/affiliations");
    router.refresh();
  }

  async function handleSkip() {
    setTouched(true);
    if (!firstName.trim() || !lastName.trim() || !dateNaissance || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // migration-connect-v72 (15/08) : débloque en self-service les comptes Espace joueur créés
    // avant ce correctif, qui n'ont ZÉRO ligne player_profiles (choix "Non/plus tard" ou "club
    // non partenaire" à l'inscription) et ne repasseront jamais par le tunnel d'inscription —
    // même action "skip" que le tunnel, avec club_id = null. Une fois la ligne créée,
    // buildPlayerContext() cesse de renvoyer null et le mur "Complétez votre profil" de
    // /prestations/[id]/reserver disparaît.
    const { data, error: fnError } = await supabase.functions.invoke("connect-player-onboarding", {
      body: {
        action: "skip",
        prenom: firstName.trim(),
        nom: lastName.trim(),
        dateNaissance,
      },
    });
    setBusy(false);
    if (fnError || data?.error) {
      setError("Impossible de mettre à jour votre profil pour le moment. Réessayez dans un instant.");
      return;
    }
    router.push("/affiliations");
    router.refresh();
  }

  async function handleDeclare() {
    setTouched(true);
    if (!declareName.trim() || !declareCity.trim() || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("connect-player-onboarding", {
      body: {
        action: "declare",
        name: declareName.trim(),
        city: declareCity.trim(),
        team: declareTeam.trim(),
        prenom: firstName.trim(),
        nom: lastName.trim(),
      },
    });
    setBusy(false);
    if (fnError || data?.error) {
      setError("Impossible d'enregistrer votre club pour le moment. Réessayez dans un instant.");
      return;
    }
    // Un club déclaré non partenaire ne crée aucune ligne visible sur le profil (aucune écriture
    // organizations/clubs/player_profiles, voir l'en-tête de connect-player-onboarding — seule
    // une notification staff part) : rediriger silencieusement vers /affiliations, qui n'affiche
    // aucune section "Clubs déclarés", donnait l'impression que rien ne s'était passé (bug
    // remonté le 15/08). Écran de confirmation explicite à la place.
    setDeclaredDone(true);
  }

  if (declaredDone) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-sv-card border border-border bg-surface p-6 text-center animate-sv-in">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-affiliations-bg">
          <span className="material-symbols-rounded !text-[26px] text-affiliations" aria-hidden="true">check</span>
        </span>
        <div className="flex flex-col gap-2">
          <span className="font-sora text-[18px] font-semibold">Club transmis à SportVision</span>
          <p className="max-w-[320px] text-[13px] leading-relaxed text-text-tertiary">
            « {declareName} » a été signalé à notre équipe comme club non partenaire. Il n&apos;apparaît pas
            comme une affiliation active dans votre profil pour l&apos;instant — nous vous recontacterons si
            SportVision peut travailler avec cette structure.
          </p>
        </div>
        <Button onClick={() => { router.push("/affiliations"); router.refresh(); }} className="w-full">
          Retour à mes affiliations
        </Button>
      </div>
    );
  }

  if (choice === null) {
    return (
      <div className="flex flex-col gap-3">
        <ChoiceCard
          icon="search"
          iconColor="#22D3EE"
          label="Rechercher mon club"
          sub="Club, académie ou structure déjà partenaire SportVision."
          onClick={() => setChoice("search")}
        />
        <ChoiceCard
          icon="add_home_work"
          iconColor="#C084FC"
          label="Mon club n'est pas sur SportVision"
          sub="Je l'ajoute moi-même comme club déclaré."
          onClick={() => setChoice("declare")}
        />
        <ChoiceCard
          icon="schedule"
          iconColor="#9A9AB8"
          label="Continuer sans club"
          sub="Je réserve une prestation sans être affilié à un club."
          onClick={() => setChoice("none")}
        />
      </div>
    );
  }

  if (choice === "none") {
    return (
      <div className="flex flex-col gap-5 animate-sv-in">
        <BackLink onClick={() => { setChoice(null); setError(null); }} />
        <p className="text-[13px] leading-relaxed text-text-tertiary">
          Confirmez vos informations pour activer votre profil joueur. Vous pourrez ajouter un
          club à tout moment depuis cette page.
        </p>
        <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <Field id="ac-none-fn" label="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} error={touched && !firstName.trim() ? "Requis." : null} />
            </div>
            <div className="flex-1">
              <Field id="ac-none-ln" label="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} error={touched && !lastName.trim() ? "Requis." : null} />
            </div>
          </div>
          <Field
            id="ac-none-birth"
            label="Date de naissance"
            type="date"
            value={dateNaissance}
            onChange={(e) => setDateNaissance(e.target.value)}
            error={touched && !dateNaissance ? "Requise." : null}
          />
        </div>
        {error && <ErrorBanner message={error} />}
        <Button onClick={handleSkip} loading={busy} className="w-full">
          Activer mon profil
        </Button>
      </div>
    );
  }

  if (choice === "search") {
    return (
      <div className="flex flex-col gap-5 animate-sv-in">
        <BackLink onClick={() => { setChoice(null); setSelected(null); setError(null); }} />

        <div className="relative flex">
          <span className="material-symbols-rounded absolute left-4 top-4 !text-[22px] text-text-faint" aria-hidden="true">search</span>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
            placeholder="Rechercher un club, une académie ou une structure…"
            className="h-[54px] w-full rounded-sv border border-border-strong bg-surface pl-[48px] pr-4 text-[16px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)]"
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
            <span className="material-symbols-rounded !text-[24px] text-text-tertiary" aria-hidden="true">search_off</span>
            <span className="font-sora text-[16px] font-semibold">Votre club n&apos;apparaît pas ?</span>
            <button
              type="button"
              onClick={() => { setDeclareName(query); setChoice("declare"); }}
              className="mt-1 rounded-sv border border-border-strong bg-surface px-4 py-2.5 text-[13px] font-semibold text-text hover:bg-surface-hover"
            >
              Ajouter mon club manuellement
            </button>
          </div>
        )}

        {selected && (
          <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <Field id="ac-fn" label="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} error={touched && !firstName.trim() ? "Requis." : null} />
              </div>
              <div className="flex-1">
                <Field id="ac-ln" label="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} error={touched && !lastName.trim() ? "Requis." : null} />
              </div>
            </div>
            <Field
              id="ac-birth"
              label="Date de naissance"
              type="date"
              value={dateNaissance}
              onChange={(e) => setDateNaissance(e.target.value)}
              error={touched && !dateNaissance ? "Requise pour rejoindre un club." : null}
            />
          </div>
        )}

        {error && <ErrorBanner message={error} />}

        <Button onClick={handleJoin} disabled={!selected} loading={busy} className="w-full">
          Rejoindre {selected ? `« ${selected.nom} »` : ""}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 animate-sv-in">
      <BackLink onClick={() => { setChoice(null); setError(null); }} />
      <p className="text-[13px] leading-relaxed text-text-tertiary">
        Ce club sera signalé à SportVision comme club non partenaire. Il ne devient pas partenaire
        SportVision pour autant.
      </p>
      <Field
        id="ac-dc-name"
        label="Nom du club"
        placeholder="US Exemple"
        value={declareName}
        onChange={(e) => setDeclareName(e.target.value)}
        error={touched && !declareName.trim() ? "Renseignez le nom du club." : null}
      />
      <Field
        id="ac-dc-city"
        label="Ville"
        placeholder="Nemours"
        value={declareCity}
        onChange={(e) => setDeclareCity(e.target.value)}
        error={touched && !declareCity.trim() ? "Renseignez la ville." : null}
      />
      <Field
        id="ac-dc-team"
        label="Équipe ou catégorie · facultatif"
        placeholder="U18"
        value={declareTeam}
        onChange={(e) => setDeclareTeam(e.target.value)}
      />
      {error && <ErrorBanner message={error} />}
      <Button onClick={handleDeclare} loading={busy} className="w-full">
        Ajouter à mon profil
      </Button>
    </div>
  );
}

function ChoiceCard({
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
        <span className="material-symbols-rounded !text-[23px]" style={{ color: iconColor }} aria-hidden="true">
          {icon}
        </span>
      </span>
      <span className="flex flex-col gap-1">
        <span className="font-sora text-[16px] font-semibold text-text">{label}</span>
        <span className="text-[13px] leading-snug text-text-tertiary">{sub}</span>
      </span>
      <span className="material-symbols-rounded ml-auto !text-[22px] text-text-label" aria-hidden="true">chevron_right</span>
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
      <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
      Retour
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
      <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
      <span className="text-[13px] leading-relaxed text-[#FBCFE8]">{message}</span>
    </div>
  );
}
