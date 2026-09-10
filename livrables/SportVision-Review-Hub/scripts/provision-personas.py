import json, os, subprocess, tempfile, sys

PROJECT_REF = "ffjktzmsezfrwmrtlhzo"
PROJECT_URL = f"https://{PROJECT_REF}.supabase.co"
MGMT_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
MGMT_TOKEN = os.environ["SUPABASE_MANAGEMENT_TOKEN"]

# Récupère la clé service_role en direct via l'API Management (pas de fichier
# intermédiaire à préparer à la main) — nécessaire pour que le reset (Phase 4,
# reset-review.py) soit exécutable de bout en bout sans étape manuelle.
_keys_proc = subprocess.run(
    ["curl", "-s", f"https://api.supabase.com/v1/projects/{PROJECT_REF}/api-keys?reveal=true",
     "-H", f"Authorization: Bearer {MGMT_TOKEN}"],
    capture_output=True, text=True, timeout=30,
)
_keys = json.loads(_keys_proc.stdout)
SERVICE_ROLE = next(k["api_key"] for k in _keys if k["name"] == "service_role")

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "personas.json")) as f:
    DATA = json.load(f)
IDS = DATA["ids"]
PERSONAS = DATA["personas"]


def curl_json(method, url, headers, body=None, timeout=30):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        if body is not None:
            json.dump(body, tf)
        body_path = tf.name
    cmd = ["curl", "-s", "-X", method, url, "-w", "\n%{http_code}"]
    for h in headers:
        cmd += ["-H", h]
    if body is not None:
        cmd += ["--data-binary", f"@{body_path}"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        out = proc.stdout
        code = out.strip().splitlines()[-1] if out.strip() else "?"
        payload = "\n".join(out.strip().splitlines()[:-1])
        return code, payload
    finally:
        os.unlink(body_path)


def sql(query):
    # Le endpoint Management API execute en tant que 'postgres' (connexion directe),
    # pas via PostgREST : auth.role() y est NULL par defaut, ce qui bloque les
    # triggers de protection (protect_sensitive_club_member_fields, etc.) qui
    # attendent explicitement 'service_role'. On positionne le GUC que PostgREST
    # aurait positionne pour un vrai appel service_role, uniquement pour cette
    # requete (SET LOCAL = portee transaction/requete courante).
    wrapped = "set local request.jwt.claim.role = 'service_role';\n" + query
    code, body = curl_json("POST", MGMT_URL, [
        f"Authorization: Bearer {MGMT_TOKEN}",
        "Content-Type: application/json",
    ], {"query": wrapped})
    if not code.startswith("2"):
        print(f"  SQL FAIL ({code}): {body[:300]}")
        return False
    return True


def create_auth_user(persona_key, p):
    body = {
        "id": p["id"],
        "email": p["email"],
        "password": p["password"],
        "email_confirm": True,
        "user_metadata": {"review_persona": persona_key, "prenom": p["prenom"], "nom": p["nom"]},
    }
    code, resp = curl_json("POST", f"{PROJECT_URL}/auth/v1/admin/users", [
        f"Authorization: Bearer {SERVICE_ROLE}",
        f"apikey: {SERVICE_ROLE}",
        "Content-Type: application/json",
    ], body)
    if code.startswith("2"):
        print(f"  auth.users OK: {persona_key}")
        return True
    if "already been registered" in resp or "already exists" in resp:
        print(f"  auth.users already exists (idempotent): {persona_key}")
        return True
    print(f"  auth.users FAIL ({code}) {persona_key}: {resp[:300]}")
    return False


print("== 1. Clubs ==")
sql(f"""
insert into clubs (id, nom, ville, discipline, saison, plan, pilot_mode)
values ('{IDS['club_sv_demo']}', 'SV Demo FC', 'Ville Demo', 'Football', '2026-2027', 'free', true)
on conflict (id) do nothing;
""")
sql(f"""
insert into clubs (id, nom, ville, discipline, saison, plan, pilot_mode)
values ('{IDS['club_other_demo']}', 'OTHER DEMO FC', 'Autre Ville Demo', 'Football', '2026-2027', 'free', true)
on conflict (id) do nothing;
""")

print("== 2. Équipes ==")
teams = [
    (IDS["team_u14_d1"], IDS["club_sv_demo"], "U14 D1 Demo", "U14"),
    (IDS["team_u18_f"], IDS["club_sv_demo"], "U18 Féminines Demo", "U18"),
    (IDS["team_seniors_r2"], IDS["club_sv_demo"], "Seniors R2 Demo", "Seniors"),
    (IDS["team_u10_a"], IDS["club_sv_demo"], "U10 A Demo", "U10"),
    (IDS["team_other_demo"], IDS["club_other_demo"], "Équipe Témoin OTHER DEMO FC", "Seniors"),
]
for tid, cid, name, cat in teams:
    sql(f"""
    insert into club_teams (id, club_id, name, categorie)
    values ('{tid}', '{cid}', '{name}', '{cat}')
    on conflict (id) do nothing;
    """)

print("== 3. Comptes Auth (personas avec login) ==")
for key, p in PERSONAS.items():
    if p.get("email"):
        create_auth_user(key, p)

print("== 4. Lignes métier ==")

# profiles (OS staff)
for key in ("alex_admin", "camille_cm"):
    p = PERSONAS[key]
    role = p["os_role"]
    sql(f"""
    insert into profiles (id, role, prenom, nom, email, actif)
    values ('{p['id']}', '{role}', '{p['prenom']}', '{p['nom']}', '{p['email']}', true)
    on conflict (id) do update set role = excluded.role;
    """)

# club_members (Club+)
club_persona_keys = ["camille_cm", "pierre_president", "diane_dirigeante", "nicolas_coach", "sarah_coach"]
for key in club_persona_keys:
    p = PERSONAS[key]
    club_id = IDS[p["club"]]
    teams_json = "[]"
    if p.get("team"):
        teams_json = json.dumps([IDS[p["team"]]])
    sql(f"""
    insert into club_members (user_id, club_id, role, prenom, nom, teams, status)
    values ('{p['id']}', '{club_id}', '{p['club_role']}', '{p['prenom']}', '{p['nom']}', '{teams_json}'::jsonb, 'actif')
    on conflict (user_id, club_id) do update set role = excluded.role, teams = excluded.teams;
    """)

# player_profiles : Lucas (a un compte) + Noah (enfant, sans compte)
p = PERSONAS["lucas_joueur"]
sql(f"""
insert into player_profiles (id, club_id, user_id, prenom, nom, date_naissance, account_status)
values ('{p['id']}', '{IDS[p['club']]}', '{p['id']}', '{p['prenom']}', '{p['nom']}', '2007-03-14', 'actif')
on conflict (id) do nothing;
""")
sql(f"""
insert into team_memberships (player_id, team_id, club_id, saison, statut)
values ('{p['id']}', '{IDS[p['team']]}', '{IDS[p['club']]}', '2026-2027', 'active')
on conflict (player_id, team_id, saison) do nothing;
""")

noah = PERSONAS["noah_demo"]
sql(f"""
insert into player_profiles (id, club_id, user_id, prenom, nom, date_naissance, account_status)
values ('{noah['id']}', '{IDS[noah['club']]}', null, '{noah['prenom']}', '{noah['nom']}', '2016-06-01', 'sans_compte')
on conflict (id) do nothing;
""")
sql(f"""
insert into team_memberships (player_id, team_id, club_id, saison, statut)
values ('{noah['id']}', '{IDS[noah['team']]}', '{IDS[noah['club']]}', '2026-2027', 'active')
on conflict (player_id, team_id, saison) do nothing;
""")

# parent_profiles + lien parent-enfant
marie = PERSONAS["marie_parent"]
sql(f"""
insert into parent_profiles (id, user_id, prenom, nom)
values ('{marie['id']}', '{marie['id']}', '{marie['prenom']}', '{marie['nom']}')
on conflict (id) do nothing;
""")
sql(f"""
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
values ('{marie['id']}', '{noah['id']}', 'parent', 'confirme', now())
on conflict (parent_id, player_id) do nothing;
""")

print("DONE")
