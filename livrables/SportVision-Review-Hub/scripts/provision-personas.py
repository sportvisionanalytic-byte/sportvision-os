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
# Sans cette ligne, connect_profile_settings.account_type retombe sur son défaut
# 'joueur' et l'espace /particulier de Connect redirige Marie vers /dashboard —
# trouvé en testant Connect Review en réel (Phase 4).
sql(f"""
insert into connect_profile_settings (user_id, account_type, profil_particulier)
values ('{marie['id']}', 'particulier', 'parent')
on conflict (user_id) do update set account_type = 'particulier', profil_particulier = 'parent';
""")

print("== 5. Affectation nominative CM (club_cm_affectations) ==")
# Sans cette ligne, cm_mes_clubs() (RPC lue par le dashboard OS "Mes clubs") et
# cm_clubs_autorises() (périmètre CM côté Club+) renvoient vide pour Camille —
# cette ligne avait été ajoutée à la main en Phase 2, jamais dans les scripts
# de seed persistants : un reset la supprimait sans la recréer (trouvé en
# testant OS Review en réel, Phase 5).
sql(f"""
insert into club_cm_affectations (id, club_id, cm_id, role, date_debut, actif)
values ('50ec2dd2-79ec-5dfd-a92c-5cb463fde14a', '{IDS['club_sv_demo']}', '{PERSONAS["camille_cm"]["id"]}', 'principal', current_date, true)
on conflict (id) do update set actif = true, date_fin = null;
""")

print("== 6. Clients OS (CRM) — liaison avec les clubs Review ==")
# L'OS a son propre modèle commercial (table clients, cm_id = "structure confiée"),
# séparé de clubs/club_teams côté Club+ — lié par clubs.portail_client_id. Sans
# cette ligne, "Mes structures" de Camille dans l'OS affiche "Aucun club confié"
# alors que club_cm_affectations existe côté Club+ : deux systèmes réels et
# distincts, pas un bug (trouvé en testant OS Review en réel, Phase 5).
POLE_FOOTBALL = "713031b4-50b7-4177-838f-612285263be4"
# ids déterministes (uuid5, namespace f6a5b9a0-0000-4000-8000-000000000001, même
# schéma que les scripts seed-sv-demo-fc-large*) — fixés en dur ici pour ne pas
# dépendre du module uuid, cohérents avec les lignes déjà en base.
client_sv = "ebbe6444-b20f-5b5f-bd72-f27c00193dc6"
client_other = "a9d64c0e-4ce7-56c8-986c-880aefb00e78"
sql(f"""
insert into clients (id, statut, type_client, nom, email, sport, cm_id, statut_relation, etape_pipeline, pole_id, created_by)
values ('{client_sv}', 'client', 'club', 'SV Demo FC', 'contact@sv-demo-fc.invalid', 'Football', '{PERSONAS["camille_cm"]["id"]}', 'client', 'gagne', '{POLE_FOOTBALL}', '{PERSONAS["alex_admin"]["id"]}')
on conflict (id) do update set cm_id = excluded.cm_id, pole_id = excluded.pole_id;
""")
sql(f"""
insert into clients (id, statut, type_client, nom, email, sport, statut_relation, etape_pipeline, pole_id, created_by)
values ('{client_other}', 'client', 'club', 'OTHER DEMO FC', 'contact@other-demo-fc.invalid', 'Football', 'client', 'gagne', '{POLE_FOOTBALL}', '{PERSONAS["alex_admin"]["id"]}')
on conflict (id) do nothing;
""")
sql(f"update clubs set portail_client_id = '{client_sv}' where id = '{IDS['club_sv_demo']}';")
sql(f"update clubs set portail_client_id = '{client_other}' where id = '{IDS['club_other_demo']}';")

print("DONE")
