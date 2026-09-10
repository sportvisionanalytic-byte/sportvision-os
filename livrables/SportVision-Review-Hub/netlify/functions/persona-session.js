// Echange "Voir comme <persona>" -> vraie session Supabase Review.
//
// Ne prend jamais de mot de passe depuis le client : le client envoie
// seulement une clef de persona (ex. "nicolas_coach"), cette fonction
// retrouve le mot de passe Review correspondant dans une variable
// d'environnement Netlify (jamais exposee au navigateur, jamais commit),
// et echange ca contre un vrai access_token/refresh_token via l'API Auth
// du projet Supabase Review (signInWithPassword cote serveur).
//
// Le resultat (JWT) EST une vraie session Supabase pour ce vrai
// auth.users : le frontend qui l'utilise ensuite est donc reellement
// soumis aux policies RLS de cette persona, pas a un simple changement
// visuel de role.
//
// Aucune cle service_role, aucun mot de passe n'est jamais renvoye au
// client — uniquement le token de session que Supabase donnerait de
// toute facon a un vrai login.

const SUPABASE_URL = "https://ffjktzmsezfrwmrtlhzo.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmamt0em1zZXpmcndtcnRsaHpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNDI1NjQsImV4cCI6MjEwNDYxODU2NH0.vMaxNqi1pogfWq58bjESlvYnJmW6Jdr9baV5RVpR3W4";

// Cle => email Review (non secret, sert d'identifiant, pas de credential).
const PERSONA_EMAILS = {
  alex_admin: "alex.admin.demo@sportvision-review.invalid",
  camille_cm: "camille.cm.demo@sportvision-review.invalid",
  pierre_president: "pierre.president.demo@sportvision-review.invalid",
  diane_dirigeante: "diane.dirigeante.demo@sportvision-review.invalid",
  nicolas_coach: "nicolas.coach.demo@sportvision-review.invalid",
  sarah_coach: "sarah.coach.demo@sportvision-review.invalid",
  lucas_joueur: "lucas.joueur.demo@sportvision-review.invalid",
  marie_parent: "marie.parent.demo@sportvision-review.invalid",
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let persona;
  try {
    persona = JSON.parse(event.body || "{}").persona;
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const email = PERSONA_EMAILS[persona];
  if (!email) {
    return { statusCode: 400, body: "Unknown persona" };
  }

  // Un seul secret JSON cote serveur : { "nicolas_coach": "motdepasse", ... }
  let passwords;
  try {
    passwords = JSON.parse(process.env.REVIEW_PERSONA_PASSWORDS || "{}");
  } catch {
    return { statusCode: 500, body: "Server misconfiguration" };
  }
  const password = passwords[persona];
  if (!password) {
    return { statusCode: 500, body: "Persona credentials not configured" };
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { statusCode: 502, body: `Sign-in failed: ${text}` };
  }

  const data = await res.json();
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      persona,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
    }),
  };
};
