"""
Seed etendu SV Demo FC pour Club+ Review (Phase 3).

Genere ~40 equipes realistes (grand club amateur fictif), avec un melange
deliberement incomplet : equipes sans coach, joueurs sans droit a l'image,
invitations en attente, resultats manquants, calendrier a forte charge
(1000+ evenements), demandes de communication non traitees, contenus a
divers stades.

Idempotent : chaque objet a un id deterministe derive de son nom via
uuid5, donc rejouable sans dupliquer (upsert via ON CONFLICT DO NOTHING/
DO UPDATE selon les tables).

Usage :
  export SUPABASE_MANAGEMENT_TOKEN=...
  python3 seed-sv-demo-fc-large.py
"""
import json, os, random, subprocess, tempfile, uuid, datetime

PROJECT_REF = "ffjktzmsezfrwmrtlhzo"
MGMT_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
MGMT_TOKEN = os.environ["SUPABASE_MANAGEMENT_TOKEN"]
NAMESPACE = uuid.UUID("f6a5b9a0-0000-4000-8000-000000000001")  # namespace fixe -> ids deterministes

HERE = os.path.dirname(os.path.abspath(__file__))
PERSONAS = json.load(open(os.path.join(HERE, "personas.json")))
CLUB_SV = PERSONAS["ids"]["club_sv_demo"]
ALEX_ADMIN_ID = PERSONAS["personas"]["alex_admin"]["id"]
NICOLAS_ID = PERSONAS["personas"]["nicolas_coach"]["id"]
TEAM_U14_D1 = PERSONAS["ids"]["team_u14_d1"]
TEAM_U18_F = PERSONAS["ids"]["team_u18_f"]

random.seed(42)  # deterministe


def uid(*parts):
    return str(uuid.uuid5(NAMESPACE, "|".join(parts)))


def sql(query, label=""):
    wrapped = "set local request.jwt.claim.role = 'service_role';\n" + query
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump({"query": wrapped}, tf)
        body_path = tf.name
    try:
        proc = subprocess.run(
            ["curl", "-s", "-X", "POST", MGMT_URL,
             "-H", f"Authorization: Bearer {MGMT_TOKEN}",
             "-H", "Content-Type: application/json",
             "--data-binary", f"@{body_path}", "-w", "\n%{http_code}"],
            capture_output=True, text=True, timeout=60,
        )
        out = proc.stdout
        code = out.strip().splitlines()[-1] if out.strip() else "?"
        body = "\n".join(out.strip().splitlines()[:-1])
        if not code.startswith("2"):
            print(f"  FAIL [{label}] HTTP {code}: {body[:300]}")
            return False
        return True
    finally:
        os.unlink(body_path)


def esc(s):
    if s is None:
        return "null"
    return "'" + str(s).replace("'", "''") + "'"


# ---------------------------------------------------------------------------
# 1. Plan des equipes (~40), categories realistes d'un gros club amateur
# ---------------------------------------------------------------------------
PRENOMS = ["Lucas","Enzo","Nathan","Hugo","Gabriel","Louis","Raphael","Tom","Ethan","Mohamed",
           "Adam","Noah","Liam","Sacha","Jules","Mathis","Rayan","Yanis","Maxime","Theo",
           "Emma","Jade","Louise","Alice","Lina","Chloe","Manon","Lea","Camille","Zoe",
           "Ines","Sarah","Nina","Anna","Julia","Eva","Mila","Rose","Lucie","Agathe"]
NOMS = ["Martin","Bernard","Dubois","Thomas","Robert","Richard","Petit","Durand","Leroy","Moreau",
        "Simon","Laurent","Lefebvre","Michel","Garcia","David","Bertrand","Roux","Vincent","Fournier",
        "Girard","Bonnet","Lambert","Fontaine","Rousseau","Vidal","Muller","Lefevre","Faure","Andre"]
COACH_PRENOMS = ["Fabrice","Karim","Julien","Sandrine","Marc","Christophe","Laetitia","Olivier","Nadia","Bruno",
                  "Stephanie","Damien","Sophie","Vincent","Aurelie"]

def rand_name(prenoms):
    return f"{random.choice(prenoms)} {random.choice(NOMS)}"


TEAM_PLAN = []
categories = ["U6","U7","U8","U9","U10","U11","U12","U13","U14","U15","U16","U18","Seniors"]
for cat in categories:
    n_teams = 3 if cat in ("U10","U11","U12","U13") else (2 if cat in ("U8","U9","U14","U15","Seniors") else 1)
    for i in range(n_teams):
        suffix = f" {['A','B','C'][i]}" if n_teams > 1 else ""
        TEAM_PLAN.append({"key": f"{cat}{suffix}".replace(" ", "_"), "name": f"{cat}{suffix} SV Demo FC", "categorie": cat, "section": "Mixte" if cat in ("U6","U7","U8") else "Masculin"})
# Féminines dédiées
for cat, n in [("U14","1"),("U16","1"),("U18","1"),("Seniors","1")]:
    TEAM_PLAN.append({"key": f"{cat}_F", "name": f"{cat} Féminines SV Demo FC", "categorie": cat, "section": "Féminin"})

# Deja crees en Phase 2 (garder les mêmes ids), retirer les doublons de nom si presents
TEAM_PLAN = [t for t in TEAM_PLAN if t["name"] not in ("U14 D1 Demo","U18 Féminines Demo","Seniors R2 Demo","U10 A Demo")]

print(f"Plan : {len(TEAM_PLAN)} nouvelles équipes + 4 déjà créées en Phase 2 = {len(TEAM_PLAN)+4} au total")

# Marque 5 équipes "sans coach" et quelques "sans effectif" / "effectif partiel"
NO_COACH_KEYS = set(random.sample([t["key"] for t in TEAM_PLAN], 5))
NO_ROSTER_KEYS = set(random.sample([t["key"] for t in TEAM_PLAN if t["key"] not in NO_COACH_KEYS], 4))
PARTIAL_ROSTER_KEYS = set(random.sample(
    [t["key"] for t in TEAM_PLAN if t["key"] not in NO_COACH_KEYS and t["key"] not in NO_ROSTER_KEYS], 6))

team_rows = []
for t in TEAM_PLAN:
    tid = uid("team", t["key"])
    coach = None if t["key"] in NO_COACH_KEYS else rand_name(COACH_PRENOMS)
    resp_comm = rand_name(COACH_PRENOMS) if random.random() < 0.3 else None
    team_rows.append({**t, "id": tid, "coach": coach, "resp_comm": resp_comm})

print("== 1. Création des équipes ==")
for t in team_rows:
    sql(f"""
    insert into club_teams (id, club_id, name, categorie, section, coach, resp_comm)
    values ('{t['id']}', '{CLUB_SV}', {esc(t['name'])}, {esc(t['categorie'])}, {esc(t['section'])}, {esc(t['coach'])}, {esc(t['resp_comm'])})
    on conflict (id) do update set coach = excluded.coach, resp_comm = excluded.resp_comm;
    """, f"team {t['name']}")

# Inclut aussi les 4 équipes Phase 2 dans la suite du seed (matchs/calendrier dessus aussi)
all_teams = team_rows + [
    {"id": TEAM_U14_D1, "name": "U14 D1 Demo", "categorie": "U14", "key": "u14_d1_p2"},
    {"id": TEAM_U18_F, "name": "U18 Féminines Demo", "categorie": "U18", "key": "u18_f_p2"},
    {"id": PERSONAS["ids"]["team_seniors_r2"], "name": "Seniors R2 Demo", "categorie": "Seniors", "key": "sr2_p2"},
    {"id": PERSONAS["ids"]["team_u10_a"], "name": "U10 A Demo", "categorie": "U10", "key": "u10a_p2"},
]

print(f"Total équipes pour la suite du seed : {len(all_teams)}")
with open(os.path.join(HERE, "large-seed-state.json"), "w") as f:
    json.dump({
        "all_teams": all_teams,
        "no_coach_keys": list(NO_COACH_KEYS),
        "no_roster_keys": list(NO_ROSTER_KEYS),
        "partial_roster_keys": list(PARTIAL_ROSTER_KEYS),
    }, f, indent=2)
print("Etat sauvegardé dans large-seed-state.json pour les étapes suivantes.")
