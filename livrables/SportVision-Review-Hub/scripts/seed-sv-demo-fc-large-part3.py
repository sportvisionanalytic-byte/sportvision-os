"""
Seed etendu SV Demo FC — partie 3 : invitations, demandes de communication,
contenus (newsroom).
"""
import json, os, random, subprocess, tempfile, uuid

PROJECT_REF = "ffjktzmsezfrwmrtlhzo"
MGMT_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
MGMT_TOKEN = os.environ["SUPABASE_MANAGEMENT_TOKEN"]
NAMESPACE = uuid.UUID("f6a5b9a0-0000-4000-8000-000000000001")

HERE = os.path.dirname(os.path.abspath(__file__))
PERSONAS = json.load(open(os.path.join(HERE, "personas.json")))
STATE = json.load(open(os.path.join(HERE, "large-seed-state.json")))
CLUB_SV = PERSONAS["ids"]["club_sv_demo"]
ALEX_ADMIN_ID = PERSONAS["personas"]["alex_admin"]["id"]
CAMILLE_ID = PERSONAS["personas"]["camille_cm"]["id"]

random.seed(44)


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
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"


# ---------------------------------------------------------------------------
# 1. Invitations — coach/dirigeant/joueur/parent, en attente + envoyées
# ---------------------------------------------------------------------------
print("== 1. Invitations ==")
invite_cases = [
    ("nicolas2.coach.demo@sportvision-review.invalid", "Fabrice", "Coach Demo 2", "coach", "envoyee"),
    ("dirigeant2.demo@sportvision-review.invalid", "Sandrine", "Dirigeante Demo 2", "membre_bureau", "preparee"),
    ("secretaire.demo@sportvision-review.invalid", "Julien", "Secrétaire Demo", "secretaire", "envoyee"),
    ("tresorier.demo@sportvision-review.invalid", "Nadia", "Trésorière Demo", "tresorier", "acceptee"),
    ("coach3.demo@sportvision-review.invalid", "Bruno", "Coach Demo 3", "coach", "envoyee"),
    ("resp-sponsors.demo@sportvision-review.invalid", "Stephanie", "Resp. Sponsors Demo", "sponsor_mgr", "preparee"),
]
for i, (email, prenom, nom, role, statut) in enumerate(invite_cases):
    iid = uid("invite", email)
    sql(f"""
    insert into club_invitations (id, club_id, email, prenom, nom, role, teams, token, statut, expire_at, created_by, sent_at)
    values ('{iid}', '{CLUB_SV}', {esc(email)}, {esc(prenom)}, {esc(nom)}, '{role}', '[]'::jsonb, '{uid('token', email)}', '{statut}', now() + interval '30 days', '{CAMILLE_ID}', {'now()' if statut != 'preparee' else 'null'})
    on conflict (id) do nothing;
    """, f"invitation {email}")

print(f"{len(invite_cases)} invitations créées (statuts variés).")

# ---------------------------------------------------------------------------
# 2. Demandes de communication (club_requests)
# ---------------------------------------------------------------------------
print("== 2. Demandes de communication ==")
teams_sample = random.sample(STATE["all_teams"], min(8, len(STATE["all_teams"])))
req_statuses = ["recues", "info_manquante", "en_traitement", "prete_a_creer", "terminee", "refusee"]
for i, t in enumerate(teams_sample):
    rid = uid("request", t["key"])
    status = req_statuses[i % len(req_statuses)]
    sql(f"""
    insert into club_requests (id, club_id, team, type, requester_id, requester_name, status, urgency, detail)
    values ('{rid}', '{CLUB_SV}', {esc(t['name'])}, 'contenu', '{CAMILLE_ID}', 'Camille CM Demo', '{status}', {esc('haute' if i % 3 == 0 else 'normale')}, {esc('Demande de contenu pour ' + t['name'])})
    on conflict (id) do nothing;
    """, f"request {t['key']}")
print(f"{len(teams_sample)} demandes de communication créées (statuts variés).")

# ---------------------------------------------------------------------------
# 3. Contenus (newsroom) — brouillon / prévu / publié / à valider
# ---------------------------------------------------------------------------
print("== 3. Contenus (newsroom) ==")
newsroom_statuses = ["recu", "a_verifier", "infos_manquantes", "pret_a_transformer", "en_creation", "programme", "publie", "archive"]
teams_sample2 = random.sample(STATE["all_teams"], min(10, len(STATE["all_teams"])))
for i, t in enumerate(teams_sample2):
    nid = uid("newsroom", t["key"])
    status = newsroom_statuses[i % len(newsroom_statuses)]
    ntype = "Résultat" if i % 2 == 0 else "Actualité"
    sql(f"""
    insert into club_newsroom_items (id, club_id, team, type, title, status, priority, author_id, author_name)
    values ('{nid}', '{CLUB_SV}', {esc(t['name'])}, '{ntype}', {esc(f"{ntype} — {t['name']}")}, '{status}', {esc('haute' if i % 4 == 0 else 'normale')}, '{CAMILLE_ID}', 'Camille CM Demo')
    on conflict (id) do nothing;
    """, f"newsroom {t['key']}")
print(f"{len(teams_sample2)} contenus créés (statuts variés).")

print("\n== Phase seed part 3 terminée ==")
