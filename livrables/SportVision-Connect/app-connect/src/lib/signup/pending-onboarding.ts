import type { SupabaseClient } from "@supabase/supabase-js";

// Rejeu de l'inscription après confirmation d'e-mail — même filet de sécurité que app-next
// (src/lib/signup/pending-onboarding.ts) : la confirmation d'e-mail est active sur ce projet
// Supabase, donc `auth.signUp()` ne renvoie AUCUNE session tant que le lien reçu par e-mail
// n'a pas été cliqué — impossible d'appeler une Edge Function authentifiée juste après
// l'inscription. On mémorise donc l'action prévue et on la rejoue au premier login réussi,
// une fois la session réelle disponible.
//
// localStorage (pas de cookie) : lu uniquement côté client, jamais transmis au serveur.
//
// ── Et une copie dans le compte lui-même (10/09/2026) ──
// Le localStorage ne vit que dans le navigateur de l'inscription. Or le cas le PLUS fréquent est
// l'inverse : on s'inscrit dans le navigateur intégré de WhatsApp (lien partagé dans le groupe de
// l'équipe) et on ouvre l'e-mail de confirmation dans Gmail ou Safari. Mesuré en production le
// 10/09 (parent invité, lien de confirmation ouvert dans un second navigateur, puis connexion) :
// aucune ligne `connect_profile_settings`, le parent atterrissait dans l'Espace JOUEUR, et un
// joueur perdait de la même façon le club choisi à l'étape 4. Le choix est donc aussi transmis à
// signUp() dans les métadonnées du compte (`sv_inscription`) : il suit la personne sur n'importe
// quel appareil. Ces métadonnées sont modifiables par leur propriétaire, exactement comme le
// localStorage : elles ne portent qu'une INTENTION, que connect-player-onboarding revalide.

const STORAGE_KEY = "sv_connect_pending_signup";

/** Clé des métadonnées du compte qui transporte l'intention d'inscription (voir ci-dessus). */
export const CLE_META_INSCRIPTION = "sv_inscription";
/** Posée à `true` une fois l'intention rejouée, n'importe où. Sans elle, le navigateur de
 *  l'inscription (qui garde sa copie locale) la rejouait une seconde fois à la connexion suivante
 *  — deux demandes d'adhésion pour un joueur. Une clé à part, parce que Supabase SUPPRIME une clé
 *  de métadonnées mise à `null` (constaté le 10/09/2026) : « null » et « jamais posée » (compte
 *  antérieur à ce correctif) seraient indiscernables. */
export const CLE_META_REJOUEE = "sv_inscription_rejouee";

/** N'accepte qu'un chemin interne ("/xxx"), jamais "//hote" ni une URL absolue : `next` voyage
 *  dans des liens et des e-mails, il ne doit jamais devenir une redirection ouverte. */
export function cheminInterne(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  return v;
}

export interface PendingPlayerOnboarding {
  action: "join" | "declare" | "skip";
  orgId?: string;
  orgName?: string;
  name?: string;
  city?: string;
  team?: string;
  prenom?: string;
  nom?: string;
  dateNaissance?: string;
  // Type de compte choisi à l'étape Profil du tunnel (signup-context.tsx) — 'joueur' pour
  // joueur/sportif, 'particulier' pour particulier/parent/autre (voir migration-connect-v51-
  // espace-particulier.sql §1). Rejoué ici pour la même raison que l'action club : auth.signUp()
  // ne renvoie aucune session tant que l'e-mail n'est pas confirmé, donc rien n'est écrivable
  // avant le premier login réel — voir consumePendingOnboarding ci-dessous.
  accountType?: "joueur" | "particulier";
  // Choix précis fait à l'étape Profil pour un compte particulier (agent/parent/tuteur/autre —
  // colonne connect_profile_settings.profil_particulier, migration-connect-v67-distinction-
  // parent-agent.sql §1). Absent (undefined) pour un profil joueur/sportif ou pour le choix
  // générique "particulier" (aucune valeur du CHECK ne correspond à ce cas précis) — la colonne
  // reste alors NULL, traitée comme "pas de plafond" par connect_particulier_limit(), exactement
  // comme un compte antérieur à la migration.
  profilParticulier?: "agent" | "parent" | "tuteur" | "autre";
  // Sport choisi à l'étape Sport du tunnel (signup-context.tsx, state.sport/otherSport) —
  // uniquement pour un profil joueur/sportif (voir isSportLike dans signup/sport/page.tsx,
  // le champ n'existe pas pour particulier/parent/agent/autre). Rejoué comme le reste (voir
  // ci-dessus) car auth.signUp() ne renvoie aucune session tant que l'e-mail n'est pas confirmé.
  // Résolu en pôle réel côté serveur par resolve_pole_by_sport() (migration-poles-v13) quand
  // connect_resolve_beneficiary_client_id() crée la ligne clients — jamais côté client, cette
  // table n'étant pas lisible par un compte Connect (voir migration-poles-v13-connect-sport-
  // coherence.sql).
  sport?: string;
  // Adresse de l'inscription (10/09/2026). Un téléphone se prête en famille : sans elle, l'entrée
  // laissée par l'inscription inachevée d'un parent se rejouait sur le compte de l'enfant qui se
  // connectait ensuite sur le même appareil (et le basculait en compte particulier).
  email?: string;
  // Page à ouvrir une fois le compte actif (10/09/2026) — typiquement /mes-invitations ou
  // /join/<code>, d'où la personne est partie pour créer son compte. Filet pour qui revient se
  // connecter sans passer par le lien de confirmation (qui porte déjà `next`).
  suite?: string;
}

export function savePendingOnboarding(pending: PendingPlayerOnboarding) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Stockage indisponible (navigation privée stricte, etc.) : l'inscription elle-même
    // n'est pas bloquée, seul le rattachement club ne pourra pas se rejouer automatiquement.
  }
}

export function hasPendingOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Rejoue l'action de club en attente avec la session courante (réelle, disponible juste après
 * la confirmation d'e-mail au premier login). Ne supprime PAS l'entrée du stockage tant que
 * l'appel n'a pas réussi — un échec (fonction pas encore déployée, réseau) laisse la tentative
 * disponible pour un prochain login plutôt que de la perdre silencieusement.
 */
export async function consumePendingOnboarding(
  supabase: SupabaseClient,
): Promise<{ ok: boolean; hasClub?: boolean; orgNom?: string; suite?: string | null } | null> {
  const {
    data: { user: compte },
  } = await supabase.auth.getUser();
  if (!compte) return null;

  const meta = (compte.user_metadata ?? {}) as Record<string, unknown>;
  const dejaRejouee = meta[CLE_META_REJOUEE] === true;
  const depuisCompte =
    !dejaRejouee && meta[CLE_META_INSCRIPTION] && typeof meta[CLE_META_INSCRIPTION] === "object"
      ? (meta[CLE_META_INSCRIPTION] as PendingPlayerOnboarding)
      : null;

  let local: PendingPlayerOnboarding | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) local = JSON.parse(raw);
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignoré
    }
  }
  // L'entrée locale d'une AUTRE adresse (appareil partagé) n'est pas pour ce compte : on la laisse
  // à sa propriétaire. Une entrée sans adresse date d'avant le 10/09 : comportement historique.
  if (local?.email && local.email.toLowerCase() !== (compte.email ?? "").toLowerCase()) local = null;
  // Déjà rejouée depuis un autre navigateur (le lien de confirmation ouvert ailleurs) : la rejouer
  // ici créerait une seconde demande d'adhésion au club.
  if (local && dejaRejouee) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignoré
    }
    local = null;
  }

  const pending = local ?? depuisCompte;
  if (!pending) return null;

  // Type de compte — écriture directe (pas d'edge function nécessaire : la policy
  // "cps_self_all" de connect_profile_settings autorise déjà un self-upsert, voir migration-
  // connect-personnel-accueil-profil-acces.sql §1). Fait AVANT l'appel à connect-player-
  // onboarding : un échec de résolution club (rate limit, réseau) ne doit jamais empêcher le
  // compte de se retrouver dans le bon espace (particulier vs joueur) au prochain chargement du
  // dashboard. On ne vide jamais explicitement le localStorage ici — en cas d'échec, l'exception
  // remonte et laisse l'entrée disponible pour être rejouée au prochain login, comme le reste de
  // cette fonction.
  if (pending.accountType) {
    {
      const payload: {
        user_id: string;
        account_type: "joueur" | "particulier";
        profil_particulier?: string;
        sport?: string;
      } = {
        user_id: compte.id,
        account_type: pending.accountType,
      };
      // profil_particulier (migration-connect-v67) : n'écrit la colonne QUE si un choix précis a
      // été capturé (voir le commentaire de PendingPlayerOnboarding.profilParticulier ci-dessus) —
      // ne jamais envoyer explicitement `undefined`/`null` dans le payload upsert, ce qui
      // écraserait une valeur déjà posée par un rejeu précédent avec NULL.
      if (pending.profilParticulier) payload.profil_particulier = pending.profilParticulier;
      // sport (migration-poles-v13, 31/08/2026) : même garde — n'écrit que si capturé (profil
      // joueur/sportif), pour ne jamais écraser une valeur déjà éditée depuis "Mon profil".
      if (pending.sport) payload.sport = pending.sport;
      const { error: cpsError } = await supabase
        .from("connect_profile_settings")
        .upsert(payload, { onConflict: "user_id" });
      if (cpsError) throw cpsError;
    }
  }

  const { data, error } = await supabase.functions.invoke("connect-player-onboarding", {
    body: {
      action: pending.action,
      orgId: pending.orgId,
      name: pending.name,
      city: pending.city,
      team: pending.team,
      prenom: pending.prenom,
      nom: pending.nom,
      dateNaissance: pending.dateNaissance,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  if (local) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignoré
    }
  }
  // Marque l'intention comme rejouée, sur le compte : l'autre navigateur (celui de l'inscription,
  // qui garde sa copie locale) ne la rejouera pas une seconde fois. Échec sans conséquence grave
  // (au pire un rejeu idempotent côté profil), donc jamais bloquant.
  if (depuisCompte || local) {
    await supabase.auth
      .updateUser({ data: { [CLE_META_INSCRIPTION]: null, [CLE_META_REJOUEE]: true } })
      .catch(() => null);
  }
  return {
    ok: true,
    hasClub: data?.hasClub,
    orgNom: data?.orgNom ?? pending.orgName,
    suite: cheminInterne(pending.suite),
  };
}
