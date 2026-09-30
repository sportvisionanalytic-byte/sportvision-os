// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Supabase Dashboard → Edge Functions → federation-sync-matchs → Deploy.

// Supabase Edge Function — federation-sync-matchs
//
// Rafraîchit les matchs des clubs dont une source fédérale est enregistrée. Appelée par pg_cron
// une fois par semaine, ou à la main depuis l'OS.
//
// ── Ce qu'elle apporte, et ce qu'elle n'apporte pas ──
// La source expose deux surfaces. Cette fonction n'interroge QUE l'API JSON, qui rend une fenêtre
// glissante d'environ trois semaines. C'est peu, mais c'est la seule qui porte les LIEUX, et c'est
// exactement la fenêtre utile : au moment d'envoyer quelqu'un sur le terrain.
// La saison complète, elle, se charge à la main (scripts/charger-saison-federale.mjs) : elle exige
// d'évaluer un bloc de code du site, ce qui n'a pas sa place dans un automatisme nocturne que
// personne ne surveille. Décision de Fouka, 09/09/2026.
//
// ── Le score officiel (10/09/2026) ──
// L'audit de la source a montré qu'elle publie le score des rencontres jouées
// (`home_score`/`outside_score`). La fonction le recopie désormais, à trois conditions strictes :
// le match est passé, la source donne les DEUX scores, et le club n'a RIEN écrit dessus (ni score,
// ni buteurs, ni homme du match, ni commentaire, et le statut est resté « à venir »). Jamais un
// écrasement : ce qu'un coach a saisi après le match lui appartient, et cette règle ne bouge pas.
//
// Le statut, lui, n'est pas touché : il reste le marqueur du passage d'un humain. Un match avec un
// score officiel et un statut inchangé s'affiche « Score officiel, à compléter » dans le Match
// Center, et reste dans la file à traiter — parce que la source ne publie NI les buteurs, NI les
// passeurs, NI l'homme du match, c'est-à-dire rien de ce qui sert à faire un contenu.
//
// Les matchs arrêtés (`stopped`) sont exclus : leur score n'est pas définitif.
//
// ── Ce qu'elle ne touche jamais ──
// Les buteurs, l'homme du match, le commentaire, les contenus, le statut de production. Le
// rattachement à une équipe (`team_id`) confirmé par un humain n'est jamais défait non plus.
//
// Sécurité : la clé partagée FEDERATION_SYNC_KEY, même mécanisme que dispatch-notifications.
// Aucun jeton utilisateur n'entre ici : la fonction agit sur tous les clubs configurés.
//
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FEDERATION_SYNC_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API = "https://api.sportcorico.com/api/clubs";
const PROVIDER = "SPORTCORICO";
const DELAI_MS = 20000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Le premier jour qui compte. Avant cette date, la saison n'est que de la préparation : aucune
// prestation SportVision ne la couvre. Une date plutôt qu'un calcul sur la saison active, parce
// que la saison démarre au 1er juillet en base et que ce n'est pas la question posée.
const DEBUT_COMPETITION = "2026-09-01";

const BUCKET_ECUSSONS = "federation-logos";

/**
 * L'ECUSSON D'UN NOUVEL ADVERSAIRE, RAMENE AU PASSAGE (30/09/2026).
 *
 * LE DEFAUT. Cette synchronisation enregistre `opponent_club_slug` sur chaque match, et l'ecusson
 * est « resolu a l'affichage » depuis `federation_clubs`. Mais elle ne remplit JAMAIS cet annuaire :
 * il est peuple a la main, par `importer-ecussons-federaux.py`, quand on charge une saison. Un
 * adversaire qui apparait en cours de saison n'a donc jamais d'ecusson — et deux matchs voisins
 * s'affichent differemment sans que personne comprenne pourquoi.
 *
 * Mesure du 30/09 : « arnouville-f-as », rencontre une fois, sans ecusson chez nous. Or l'API donne
 * son `logo_filename` quand on le lui demande. On recevait la reponse et on la jetait.
 *
 * ON COPIE L'IMAGE, ON NE POINTE PAS DESSUS. C'est la regle posee par le script d'import : un
 * visuel matchday publie doit continuer de s'afficher dans six mois, et pointer vers le stockage
 * d'un tiers revient a accepter qu'il casse le jour ou celui-ci reorganise ses fichiers.
 *
 * BORNEE ET SANS CONSEQUENCE EN CAS D'ECHEC. Au plus huit clubs par passage — c'est un rattrapage,
 * pas un import de masse — et toute erreur est avalee : un ecusson manquant ne doit jamais empecher
 * un calendrier de se synchroniser.
 */
// Le type du client varie selon la facon dont il a ete cree ; on ne decrit ici que ce qu'on en
// utilise, plutot que de recopier une signature qui bougera au prochain changement de version.
// deno-lint-ignore no-explicit-any
async function ramenerEcussons(admin: any, slugs: string[]): Promise<number> {
  const aVoir = [...new Set(slugs.filter(Boolean))];
  if (!aVoir.length) return 0;

  const { data: connus } = await admin
    .from("federation_clubs").select("slug").in("slug", aVoir).not("logo_url", "is", null);
  const deja = new Set((connus ?? []).map((c: { slug: string }) => c.slug));
  const manquants = aVoir.filter((s) => !deja.has(s)).slice(0, 8);

  let ramenes = 0;
  for (const slug of manquants) {
    try {
      const rep = await fetch(`${API}/${slug}`, { headers: { Accept: "application/json" } });
      if (!rep.ok) continue;
      const club = (await rep.json())?.club;
      const source = club?.logo_filename;
      if (!source) continue;

      const img = await fetch(source);
      if (!img.ok) continue;
      const octets = new Uint8Array(await img.arrayBuffer());
      // On garde l'extension de l'origine : le navigateur doit savoir ce qu'il recoit.
      const ext = (source.split("?")[0].match(/\.([a-z0-9]{2,4})$/i)?.[1] ?? "png").toLowerCase();
      const chemin = `${slug}.${ext}`;
      const envoi = await admin.storage.from(BUCKET_ECUSSONS)
        .upload(chemin, octets, { contentType: img.headers.get("content-type") ?? "image/png", upsert: true });
      if (envoi.error) continue;

      const { data: publique } = admin.storage.from(BUCKET_ECUSSONS).getPublicUrl(chemin);
      // Le client sans schema type infere `never[]` sur un upsert : on decrit la ligne a part.
      const ligne: Record<string, unknown> = {
        // « SPORTCORICO », EN MAJUSCULES : c'est la valeur des 34 583 fiches existantes et la
        // valeur par defaut de la colonne. Ecrit en minuscules, l'upsert sur (source, slug) ne
        // reconnait pas la fiche existante et en CREE UNE SECONDE — verifie, ca m'est arrive.
        source: "SPORTCORICO",
        slug,
        // `recherche` EST OBLIGATOIRE, et je l'avais oubliee : premier essai refuse en 23502.
        // C'est la forme comparable du nom — accents retires, tout ce qui n'est pas lettre ni
        // chiffre supprime — celle que produit `norm()` dans importer-ecussons-federaux.py. Sans
        // elle, la recherche d'un club par son nom ne retrouverait pas cette fiche.
        recherche: slug.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .toLowerCase().replace(/[^a-z0-9]+/g, ""),
        // `nom` ne s'ecrase pas : une fiche deja nommee a pu l'etre a la main, mieux que la source.
        nom: club?.name ?? null,
        logo_url: publique.publicUrl,
        logo_source_url: source,
      };
      const { error: eEcriture } = await admin.from("federation_clubs")
        .upsert(ligne as never, { onConflict: "source,slug", ignoreDuplicates: false });
      // ON LE DIT QUAND CA RATE. Premiere version : l'erreur etait avalee, et l'ecriture echouait
      // en silence sur une colonne obligatoire manquante — le fichier partait dans le seau, la
      // fiche n'etait jamais ecrite, et rien ne l'aurait signale. Un `catch` muet transforme un
      // defaut en mystere.
      if (eEcriture) { console.error(`ecusson ${slug} : fiche non ecrite —`, eEcriture.message); continue; }
      ramenes++;
    } catch (e) {
      // Un adversaire sans ecusson n'est pas une panne de synchronisation : on continue. Mais on
      // laisse une trace, sinon personne ne saura jamais que ca n'a pas marche.
      console.error(`ecusson ${slug} :`, String((e as Error)?.message ?? e).slice(0, 120));
    }
  }
  return ramenes;
}

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Ramène une heure à HH:MM, quelle que soit sa forme d'origine. Sert uniquement à comparer. */
function heure(v: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((v ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** JJ/MM/AAAA → AAAA-MM-JJ, ou null. Une date mal comprise vaut moins que pas de date. */
function versIso(v: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

interface MatchSource {
  id?: number;
  planned_date?: string | null;
  planned_time?: string | null;
  location?: string | null;
  championship_name?: string | null;
  home_team_name?: string | null;
  outside_team_name?: string | null;
  home_club_slug?: string | null;
  home_team_club_slug?: string | null;
  home_team_category_and_code_name?: string | null;
  outside_team_category_and_code_name?: string | null;
  home_club_slug_adv?: string | null;
  outside_club_slug?: string | null;
  postponed?: boolean;
  exempt?: boolean;
  /** Nuls tant que la rencontre n'est pas jouée. `status` n'est PAS utilisable pour ça : la source
   *  renvoyait encore « À venir » sur un match terminé 0-2, vérifié le 10/09/2026. */
  home_score?: number | null;
  outside_score?: number | null;
  /** Match interrompu : le score affiché n'est pas définitif. */
  stopped?: boolean;
}

/** Le score du point de vue du club, « pour-contre », dans la forme attendue par
 *  `club_matches.score` (voir parseScore côté Connect). `null` dès qu'un doute existe. */
function scoreOfficiel(m: MatchSource, domicile: boolean, dateIso: string | null): string | null {
  if (m.stopped) return null;
  if (typeof m.home_score !== "number" || typeof m.outside_score !== "number") return null;
  // Un match du jour peut porter des zéros avant le coup d'envoi : on n'accepte que le passé.
  const aujourdhui = new Date().toISOString().slice(0, 10);
  if (!dateIso || dateIso >= aujourdhui) return null;
  const pour = domicile ? m.home_score : m.outside_score;
  const contre = domicile ? m.outside_score : m.home_score;
  return `${pour}-${contre}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const attendue = Deno.env.get("FEDERATION_SYNC_KEY");
  const fournie = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!attendue || fournie !== attendue) return json({ error: "Non autorisé." }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Les evenements qu'un humain a supprimes et que la synchro ne doit pas recreer. Sans cette
  // liste, tout nettoyage manuel serait annule au passage suivant : la source expose toujours
  // l'evenement, et rien ici ne saurait qu'on n'en veut plus. Constate le 09/09/2026, un match
  // retire a la demande du club est revenu dans la minute.
  const { data: exclusions } = await admin
    .from("calendar_sync_exclusions")
    .select("club_id, external_event_id")
    .eq("provider", PROVIDER);
  const exclus = new Set((exclusions ?? []).map((x) => `${x.club_id}:${x.external_event_id}`));

  const { data: sources, error: errSources } = await admin
    .from("club_calendar_sources")
    .select("id, club_id, saison_id, external_club_id, external_club_name")
    .eq("provider", PROVIDER)
    .eq("is_enabled", true);

  if (errSources) return json({ error: "Lecture des sources impossible." }, 500);
  if (!sources?.length) return json({ traite: 0, message: "Aucune source fédérale active." });

  const rapport: unknown[] = [];

  for (const s of sources) {
    const debut = new Date().toISOString();
    // `scores` : combien de scores officiels recopies. C'est la seule ecriture nouvelle de cette
    // fonction, elle merite sa ligne au journal.
    let creees = 0, majs = 0, inchanges = 0, scores = 0, ignores = 0;
    // Les adversaires croises pendant ce passage : on ira chercher l'ecusson de ceux qu'on ne
    // connait pas encore. Un ensemble, parce qu'une equipe rencontre souvent le meme club deux fois.
    const adversairesVus = new Set<string>();
    const erreurs: string[] = [];
    let statut = "success";

    try {
      const slug = (s.external_club_id ?? "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug)) throw new Error("Identifiant de club invalide.");

      const controle = new AbortController();
      const minuteur = setTimeout(() => controle.abort(), DELAI_MS);
      let reponse: Response;
      try {
        reponse = await fetch(`${API}/${slug}`, {
          signal: controle.signal,
          headers: { Accept: "application/json" },
        });
      } finally {
        clearTimeout(minuteur);
      }
      if (!reponse.ok) throw new Error(`La source a répondu ${reponse.status}.`);

      const club = (await reponse.json())?.club;
      if (!club) throw new Error("Réponse inattendue de la source.");

      const matchs = [
        ...(club.previousMatches ?? []),
        ...(club.currentMatches ?? []),
        ...(club.nextMatches ?? []),
      ].flatMap((j: { matches?: MatchSource[] }) => j.matches ?? [])
        .filter((m) => m.id && !m.exempt && versIso(m.planned_date));

      for (const m of matchs) {
        const clubDomicile = m.home_club_slug ?? m.home_team_club_slug ?? null;
        const domicile = clubDomicile === slug;
        const adversaire = domicile ? m.outside_team_name : m.home_team_name;
        if (!adversaire) continue;
        const adversaireSlug = (domicile ? m.outside_club_slug : m.home_club_slug) ?? null;
        if (adversaireSlug) adversairesVus.add(adversaireSlug);

        const externalId = String(m.id);
        if (exclus.has(`${s.club_id}:${externalId}`)) {
          inchanges++;
          continue;
        }

        // 21/09/2026, décision de Fouka : « dans les plannings, retire tout ce qui est avant
        // août, on compte à partir de septembre 2026 ». Les matchs de préparation d'été ne sont
        // couverts par aucune prestation : ils encombrent le calendrier des clubs et le Match
        // Center sans qu'on ait jamais rien à en faire.
        //
        // Le filtre est ICI et pas seulement en base : une purge SQL seule n'aurait tenu que
        // jusqu'au prochain passage de la synchronisation, qui aurait tout recréé le lendemain.
        const dateMatch = versIso(m.planned_date);
        if (dateMatch && dateMatch < DEBUT_COMPETITION) {
          ignores++;
          continue;
        }
        const { data: existant } = await admin
          .from("club_matches")
          .select("id, match_date, kickoff_time, lieu, score, scorers, man_of_match, comment, status, champs_verrouilles")
          .eq("club_id", s.club_id)
          .eq("provider", PROVIDER)
          .eq("external_event_id", externalId)
          .maybeSingle();

        const ligne = {
          club_id: s.club_id,
          // Le libellé court (« U14 3 »), pas le nom complet (« Villemomble Sports U14 3 »).
          // Répéter le nom du club dans chacune de ses propres équipes n'apprend rien, et surtout
          // la garde anti-doublon compare `team` : deux écritures qui ne s'accordent pas sur la
          // forme du libellé recréeraient chaque match à côté de lui-même.
          team: (domicile ? m.home_team_category_and_code_name : m.outside_team_category_and_code_name)
            ?? (domicile ? m.home_team_name : m.outside_team_name)?.replace(/^.*?\bSports\s+/, "")
            ?? "—",
          opponent: adversaire,
          match_date: versIso(m.planned_date),
          kickoff_time: m.planned_time || null,
          // Le lieu ne sort de la fenêtre glissante que pour les matchs proches. On ne l'efface
          // jamais : sinon chaque passage viderait le lieu des matchs devenus lointains.
          lieu: m.location ?? existant?.lieu ?? null,
          competition: m.championship_name ?? null,
          is_home: domicile,
          provider: PROVIDER,
          external_event_id: externalId,
          saison_id: s.saison_id,
          // L'identifiant du club adverse, d'ou l'ecusson est resolu a l'affichage. Sans lui, un
          // match cree par la synchro quotidienne n'aurait jamais d'ecusson, la ou ceux de
          // l'import de saison en ont un : deux matchs voisins, deux rendus differents.
          opponent_club_slug: adversaireSlug,
          sport_status: m.postponed ? "postponed" : "scheduled",
          last_synced_at: new Date().toISOString(),
        };

        if (!existant) {
          // La source expose parfois DEUX identifiants pour une meme rencontre : le calendrier de
          // SENIORS 3 et celui de U14 2 etaient integralement dupliques (44 et 40 matchs au lieu
          // de 22 et 20), avec des ids differents mais memes date, heure, competition et equipes.
          // Se fier au seul identifiant ne pouvait pas le voir. On verifie donc aussi la
          // signature metier avant de creer.
          // On compare (date, adversaire, competition) et NON le libelle d'equipe : deux
          // ecritures peuvent nommer la meme equipe differemment (« SENIORS 3 » cote pages de
          // saison, « Seniors 3 » cote API), et un doublon est deja passe par cette faille.
          // 12/09/2026 — La regle « deux equipes d'un meme club ne s'affrontent jamais dans la
          // meme competition le meme jour » est FAUSSE, et la production le montre : chez SF
          // Villemomble, le 05/09 contre « Interne » en « Amical », HUIT lignes (U11 x4, U12 x4) ;
          // le 12/09 contre « My Events » en « Tournoi », quatre. Un plateau de jeunes viole la
          // regle systematiquement. Consequence : le premier match cree faisait passer tous les
          // suivants pour des doublons, et les matchs federaux des autres equipes n'etaient jamais
          // crees — sans erreur, sans trace, sans rien a comprendre.
          //
          // On garde la tolerance sur le LIBELLE d'equipe, qui etait la vraie raison de l'exclure
          // (« SENIORS 3 » vs « Seniors 3 »), mais on compare desormais ce libelle NORMALISE.
          const normEquipe = (v: unknown) =>
            String(v ?? "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]/g, "");

          let requete = admin
            .from("club_matches")
            .select("id, team")
            .eq("club_id", s.club_id)
            .eq("opponent", ligne.opponent)
            .eq("match_date", ligne.match_date!);
          requete = ligne.competition
            ? requete.eq("competition", ligne.competition)
            : requete.is("competition", null);
          const { data: candidats } = await requete.limit(50);
          const cible = normEquipe(ligne.team);
          const jumeau = (candidats ?? []).find((c: { team?: string | null }) =>
            // Une ligne sans equipe nommee reste traitee comme un jumeau possible : c'est le cas
            // historique d'avant la resolution d'equipe, et on ne veut pas la dupliquer.
            cible === "" || normEquipe(c.team) === "" || normEquipe(c.team) === cible,
          ) ?? null;
          if (jumeau) {
            inchanges++;
          } else {
            const officiel = scoreOfficiel(m, domicile, ligne.match_date);
            // `score` n'appartient pas a `ligne` : il ne doit JAMAIS partir dans une mise a jour
            // de calendrier, ou un `score: null` effacerait la saisie d'un coach.
            //
            // 21/09/2026 — Le score arrivait SANS toucher au statut, reste a « scheduled » quelques
            // lignes plus haut. 23 matchs de Villemomble et Fontainebleau portaient donc un score
            // tout en etant annonces « a venir » : ranges dans la mauvaise file du Match Center, et
            // affiches avec un resultat sur un match soi-disant a jouer dans le calendrier des
            // joueurs. La source publie un statut faux (leçon du 10/09), mais un score officiel
            // sur un match passe, lui, dit exactement une chose : il a ete joue.
            const aInserer: Record<string, unknown> = officiel
              ? { ...ligne, score: officiel, sport_status: "completed", status: "recu" }
              : ligne;
            const { error } = await admin.from("club_matches").insert(aInserer);
            if (error) erreurs.push(`${externalId} : ${error.message}`);
            else {
              creees++;
              if (officiel) scores++;
            }
          }
        } else {
          // 15/09/2026 (v237) — Un champ corrige a la main ne se fait plus ecraser. Le planning
          // que le club diffuse porte les ajustements reels : un match deplace d'un stade a
          // l'autre, un horaire decale. La federation, elle, publie ce qu'elle sait. Sans ce
          // garde, chaque passage de la synchro effacait la correction, et le club recorrigeait
          // en boucle sans comprendre pourquoi.
          const verrous: string[] = Array.isArray(existant.champs_verrouilles) ? existant.champs_verrouilles : [];
          for (const champ of verrous) {
            if (champ in ligne) delete (ligne as Record<string, unknown>)[champ];
          }
          const verrouille = (champ: string) => verrous.includes(champ);

          const calendrierChange =
            (!verrouille("match_date") && existant.match_date !== ligne.match_date) ||
            // Postgres rend une heure en HH:MM:SS, la source la donne en HH:MM. Comparer les deux
            // formes brutes declarait les 17 matchs « modifies » a CHAQUE passage : le journal
            // annoncait du changement la ou il n'y en avait aucun, et on reecrivait pour rien.
            (!verrouille("kickoff_time") && heure(existant.kickoff_time) !== heure(ligne.kickoff_time)) ||
            (!verrouille("lieu") && (existant.lieu ?? null) !== (ligne.lieu ?? null));

          // Le score n'est recopie que sur une ligne VIERGE de toute saisie du club. Tester le
          // seul champ `score` ne suffirait pas : un coach peut avoir renseigne les buteurs et le
          // commentaire avant le score, et ecrire par-dessus effacerait le sens de sa saisie.
          const officiel = scoreOfficiel(m, domicile, ligne.match_date);
          const vierge =
            existant.score === null &&
            existant.scorers === null &&
            existant.man_of_match === null &&
            existant.comment === null &&
            (existant.status === "a_venir" || existant.status === "a_transmettre");
          const scoreAEcrire = officiel && vierge ? officiel : null;

          if (calendrierChange || scoreAEcrire) {
            // `ligne` ne porte jamais `score` : sans ce choix explicite, une simple mise a jour de
            // lieu effacerait un score deja present.
            const patch: Record<string, unknown> = scoreAEcrire
              ? { ...ligne, score: scoreAEcrire, sport_status: "completed", status: "recu" }
              : ligne;
            const { error } = await admin.from("club_matches").update(patch).eq("id", existant.id);
            if (error) erreurs.push(`${externalId} : ${error.message}`);
            else {
              majs++;
              if (scoreAEcrire) scores++;
            }
          } else {
            inchanges++;
          }
        }
      }

      if (erreurs.length) statut = creees + majs > 0 ? "partial" : "error";
    } catch (e) {
      statut = "error";
      erreurs.push(e instanceof Error ? e.message : "Erreur inconnue.");
    }

    await admin.from("calendar_sync_runs").insert({
      club_id: s.club_id,
      saison_id: s.saison_id,
      source_id: s.id,
      provider: PROVIDER,
      trigger_kind: "scheduled",
      started_at: debut,
      finished_at: new Date().toISOString(),
      status: statut,
      events_created: creees,
      events_updated: majs,
      events_cancelled: 0,
      events_unchanged: inchanges,
      changes: scores > 0 ? { scores_officiels: scores } : {},
      errors: erreurs,
      source_label: s.external_club_name ?? s.external_club_id,
    });

    // LES ECUSSONS MANQUANTS, APRES LES MATCHS et jamais avant : si cette etape echoue, le
    // calendrier a deja ete enregistre. Un ecusson est un confort, un calendrier est le service.
    const ecussons = await ramenerEcussons(admin, [...adversairesVus])
      .catch(() => 0);

    await admin.from("club_calendar_sources").update({
      last_sync_at: new Date().toISOString(),
      sync_status: statut === "success" ? "ok" : statut === "partial" ? "partial" : "error",
      last_error: erreurs.length ? erreurs.slice(0, 3).join(" · ").slice(0, 500) : null,
    }).eq("id", s.id);

    rapport.push({
      club: s.external_club_name ?? s.external_club_id,
      statut, creees, majs, inchanges, scores, ignores, erreurs: erreurs.length,
      ecussons,
    });
  }

  return json({ traite: sources.length, rapport });
});
