// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// request-password-reset → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — request-password-reset
// Remplace l'appel direct à /auth/v1/recover (e-mail générique Supabase, non
// brandé) par le Communication Hub — e-mail SportVision réel (AUTH-04),
// utilisable depuis l'OS et le Portail (les deux envoient juste email +
// redirect_url).
//
// Appelée par un visiteur NON authentifié (par définition, il a perdu son mot
// de passe) — donc pas de vérification JWT ici, mais :
//  - réponse toujours générique (jamais de fuite sur l'existence du compte)
//  - limite de fréquence par adresse ET par IP (même mécanisme que
//    create-guest-rdv/create-guest-request, table guest_rate_limits)
// Secrets requis : aucun secret supplémentaire (SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY déjà présents par défaut).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Où atterrit la personne qui clique son lien ──────────────────────────────
//
// INCIDENT DU 13/09/2026 (voir invite-collaborateur). Supabase n'honore une redirection que si
// elle figure dans la liste blanche du projet ; sinon il la remplace SILENCIEUSEMENT par le Site
// URL — `https://connect.sportvision-an.fr`. Un collaborateur qui réinitialise son mot de passe
// depuis l'OS atterrissait donc sur Connect, où son compte n'a rien à faire.
//
// Cette fonction-ci sert les trois applications : on ne peut pas imposer une destination. On
// valide donc ce qui est proposé contre les origines connues, et à défaut on choisit selon le
// compte lui-même : un collaborateur SportVision (il a une ligne dans `profiles`) va sur l'OS,
// tout le monde sinon va sur Connect.
const OS_URL = Deno.env.get("OS_URL") ?? "https://bc6m3cgdz.sportvision-an.fr/";
const CLUBPLUS_URL = Deno.env.get("CLUBPLUS_URL") ?? "https://clubplus.sportvision-an.fr";
const CONNECT_URL = "https://connect.sportvision-an.fr";
function origineConnue(propose: unknown): string | null {
  try {
    const u = new URL(String(propose ?? ""));
    for (const connue of [OS_URL, CLUBPLUS_URL, CONNECT_URL]) {
      if (u.origin === new URL(connue).origin) return u.origin + u.pathname;
    }
  } catch { /* URL absente ou illisible */ }
  return null;
}

// Deux plafonds, parce qu'ils protègent de deux choses différentes (13/09/2026).
//
// PAR ADRESSE E-MAIL : empêche de harceler une personne de messages. Cinq par heure suffit
// largement, et le sixième n'apporte rien à qui a vraiment perdu son mot de passe.
//
// PAR ADRESSE IP : empêche l'énumération massive. Il était réglé à 5 lui aussi — c'est-à-dire au
// niveau d'UNE personne, alors qu'une IP, c'est un foyer, un club house, une mairie, ou le NAT d'un
// opérateur mobile derrière lequel se trouvent des milliers d'abonnés. Cinq familles d'un même club
// qui font leurs démarches le même soir, et la sixième recevait « un e-mail vient d'être envoyé »
// sans qu'aucun e-mail ne parte. Trouvé pendant l'audit du 13/09 : la limite a sauté en une heure
// d'usage normal, sur une seule connexion.
//
// Le message générique reste le même dans tous les cas — c'est ce qui protège de l'énumération —
// mais il ne doit pas devenir un mensonge dès la sixième demande d'un quartier.
const RATE_LIMIT_MAX_EMAIL = 5;
const RATE_LIMIT_MAX_IP = 40;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
async function checkRateLimit(admin: any, identifiant: string, max: number) {
  // Fonction atomique (migration-audit-25-08-corrections-batch1.sql, 25/08/2026) : l'ancien
  // motif COUNT puis INSERT séparés laissait une fenêtre de course entre deux appels concurrents
  // (répété tel quel dans ~20 edge functions) — verrou transactionnel scopé à l'identifiant côté
  // Postgres, plus de race condition possible.
  const { data, error } = await admin.rpc("check_and_record_rate_limit", {
    p_identifiant: identifiant,
    p_max: max,
    p_window_seconds: RATE_LIMIT_WINDOW_MS / 1000,
  });
  if (error) return false;
  return data === true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Réponse générique unique, quel que soit le cas réel (compte existant ou non,
  // rate-limit atteint, erreur interne) — ne jamais laisser un attaquant
  // distinguer ces cas depuis l'écran.
  const genericResponse = { message: "Si un compte existe avec cette adresse, un e-mail de réinitialisation vient d'être envoyé." };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, serviceKey);

    const { email: saisie, redirect_url } = await req.json();
    // Adresse canonique : Supabase Auth compare en minuscules, mais la file d'envoi gardait la
    // saisie brute (« ZZ@EXAMPLE… », « Nophotopix@gmail.com » vus dans notification_outbox).
    const email = String(saisie ?? "").trim().toLowerCase();
    if (!email) return json(genericResponse, 200);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "inconnu";
    const okEmail = await checkRateLimit(admin, "pwreset:email:" + email.toLowerCase(), RATE_LIMIT_MAX_EMAIL);
    const okIp = await checkRateLimit(admin, "pwreset:ip:" + ip, RATE_LIMIT_MAX_IP);
    if (!okEmail || !okIp) return json(genericResponse, 200);

    // La destination se décide AVANT de générer le lien : après, il est trop tard, Supabase a
    // déjà substitué le Site URL sans le dire.
    let destination = origineConnue(redirect_url);
    if (!destination) {
      const { data: collaborateur } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      destination = collaborateur ? OS_URL : CONNECT_URL;
    }

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: destination },
    });
    // Compte inconnu ou erreur : même réponse générique, rien de plus.
    if (linkErr || !linkData?.user) return json(genericResponse, 200);

    // 24 h : Auth > mailer_otp_exp = 86400 s depuis le 11/09/2026 (decision de Fouka). L'e-mail
    // annonce cette echeance ; elle doit suivre le reglage Supabase, sinon il ment.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await admin.rpc("enqueue_notification", {
      p_event_type: "password.reset.requested",
      p_template_key: "auth.password_reset",
      p_channel: "EMAIL",
      // Bug réel trouvé le 23/08/2026 (Fouka, 340sportingclub@gmail.com "pas de mail reçu") :
      // arrondi à l'HEURE entière bloquait toute 2e demande légitime dans la même heure
      // (17:14 puis 17:27 UTC → même clé, `on conflict do nothing` dans enqueue_notification,
      // donc silencieusement AUCUN e-mail envoyé pour la 2e demande, alors que l'écran affichait
      // quand même "e-mail envoyé"). Fenêtre ramenée à 30s : assez pour absorber un vrai doublon
      // (double clic, retry réseau immédiat) sans jamais bloquer une nouvelle demande sincère.
      p_idempotency_key: "auth.password_reset:v1:" + linkData.user.id + ":" + Math.floor(Date.now() / 30000),
      p_recipient_email: email,
      p_recipient_user_id: linkData.user.id,
      p_entity_type: "collaborateur_ou_client",
      p_entity_id: linkData.user.id,
      p_payload: {
        // Connect et Club+ enregistrent le prénom sous `first_name`, l'OS sous `prenom`
        // (10/09/2026) : ne lire que `prenom` laissait « Bonjour , » à tout compte Connect. Rien
        // si aucun des deux : dispatch-notifications rend alors « Bonjour, ».
        first_name: String(linkData.user.user_metadata?.first_name || linkData.user.user_metadata?.prenom || "").trim(),
        expires_at_local: expiresAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "long" }),
        reset_url: linkData.properties.action_link,
      },
    });

    return json(genericResponse, 200);
  } catch (e) {
    // Même en cas d'erreur interne, ne pas renvoyer autre chose que la réponse
    // générique côté écran (l'erreur reste tracée côté serveur uniquement).
    console.error("request-password-reset error:", ((e as { message?: string })?.message ?? String(e)));
    return json(genericResponse, 200);
  }
});
