import json, os, subprocess, tempfile

PROJECT_REF = "ffjktzmsezfrwmrtlhzo"
PROJECT_URL = f"https://{PROJECT_REF}.supabase.co"
ANON_KEY = open("/tmp/.review-anon.key").read().strip()

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, "personas.json")))
IDS = DATA["ids"]
PERSONAS = DATA["personas"]


def curl(method, url, headers, body=None, timeout=20):
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


def sign_in(email, password):
    code, body = curl("POST", f"{PROJECT_URL}/auth/v1/token?grant_type=password", [
        f"apikey: {ANON_KEY}",
        "Content-Type: application/json",
    ], {"email": email, "password": password})
    if not code.startswith("2"):
        return None, body
    return json.loads(body).get("access_token"), None


sessions = {}
print("== Connexion des personas (vrai signInWithPassword) ==")
for key, p in PERSONAS.items():
    if not p.get("email"):
        continue
    token, err = sign_in(p["email"], p["password"])
    if token:
        sessions[key] = token
        print(f"  OK: {key} -> JWT obtenu")
    else:
        print(f"  FAIL: {key} -> {err}")

SV = IDS["club_sv_demo"]
OTHER = IDS["club_other_demo"]
NOAH = PERSONAS["noah_demo"]["id"]
LUCAS = PERSONAS["lucas_joueur"]["id"]
U14 = IDS["team_u14_d1"]
U18F = IDS["team_u18_f"]
U10A = IDS["team_u10_a"]
OTHER_TEAM = IDS["team_other_demo"]


def rest_get(persona_key, path):
    token = sessions[persona_key]
    code, body = curl("GET", f"{PROJECT_URL}/rest/v1/{path}", [
        f"apikey: {ANON_KEY}",
        f"Authorization: Bearer {token}",
    ])
    try:
        rows = json.loads(body)
        n = len(rows) if isinstance(rows, list) else None
    except Exception:
        n = None
    return code, n, body


def rest_patch(persona_key, path, body_data):
    token = sessions[persona_key]
    code, body = curl("PATCH", f"{PROJECT_URL}/rest/v1/{path}", [
        f"apikey: {ANON_KEY}",
        f"Authorization: Bearer {token}",
        "Content-Type: application/json",
        "Prefer: return=representation",
    ], body_data)
    try:
        rows = json.loads(body)
        n = len(rows) if isinstance(rows, list) else None
    except Exception:
        n = None
    return code, n, body


# (persona, description, kind[get/patch], path, patch_body, expect: "nonzero"|"zero"|"2xx"|"not2xx")
TESTS = [
    ("camille_cm", "CM voit les equipes de SON club (SV Demo FC)", "get", f"club_teams?club_id=eq.{SV}&select=id,name", None, "nonzero"),
    ("camille_cm", "CM NE voit PAS les equipes d'un AUTRE club (OTHER DEMO FC)", "get", f"club_teams?club_id=eq.{OTHER}&select=id,name", None, "zero"),
    ("camille_cm", "CM voit les membres de son club", "get", f"club_members?club_id=eq.{SV}&select=id,role", None, "nonzero"),
    ("camille_cm", "CM peut modifier une equipe de son club", "patch", f"club_teams?id=eq.{U14}", {"coach": "Nicolas Coach Demo (via CM)"}, "2xx"),
    ("camille_cm", "CM NE PEUT PAS modifier une equipe d'un autre club", "patch", f"club_teams?id=eq.{OTHER_TEAM}", {"coach": "Tentative CM externe"}, "not2xx_or_zero"),

    ("nicolas_coach", "Coach voit les equipes de son club", "get", f"club_teams?club_id=eq.{SV}&select=id,name", None, "nonzero"),
    ("nicolas_coach", "Coach NE voit PAS les equipes d'un autre club", "get", f"club_teams?club_id=eq.{OTHER}&select=id,name", None, "zero"),
    ("nicolas_coach", "Coach NE PEUT PAS modifier le club (niveau club)", "patch", f"clubs?id=eq.{SV}", {"ville": "Ville modifiee par coach"}, "not2xx_or_zero"),
    ("nicolas_coach", "Coach NE PEUT PAS modifier une equipe d'un autre club", "patch", f"club_teams?id=eq.{OTHER_TEAM}", {"coach": "Tentative coach externe"}, "not2xx_or_zero"),
    ("nicolas_coach", "Coach NE PEUT PAS modifier une equipe hors de son perimetre (U18F, meme club)", "patch", f"club_teams?id=eq.{U18F}", {"coach": "Tentative Nicolas sur equipe de Sarah"}, "not2xx_or_zero"),

    ("marie_parent", "Parent voit son enfant (Noah)", "get", f"player_profiles?id=eq.{NOAH}&select=id,prenom,nom", None, "nonzero"),
    ("marie_parent", "Parent NE voit PAS un joueur d'une autre famille (Lucas)", "get", f"player_profiles?id=eq.{LUCAS}&select=id,prenom,nom", None, "zero"),
    ("marie_parent", "Parent voit l'equipe de son enfant", "get", f"club_teams?id=eq.{U10A}&select=id,name", None, "nonzero"),

    ("lucas_joueur", "Joueur voit son propre profil", "get", f"player_profiles?id=eq.{LUCAS}&select=id,prenom,nom", None, "nonzero"),
    ("lucas_joueur", "Joueur NE voit PAS le profil d'un autre enfant (Noah, autre famille)", "get", f"player_profiles?id=eq.{NOAH}&select=id,prenom,nom", None, "zero"),
    ("lucas_joueur", "Joueur NE PEUT PAS lire club_members (donnee admin club)", "get", f"club_members?club_id=eq.{SV}&select=id,role", None, "zero"),

    ("pierre_president", "President voit toutes les equipes de son club", "get", f"club_teams?club_id=eq.{SV}&select=id,name", None, "nonzero"),
    ("pierre_president", "President peut modifier une equipe de son club", "patch", f"club_teams?id=eq.{U18F}", {"coach": "Sarah Coach Demo (via president)"}, "2xx"),
    ("pierre_president", "President NE PEUT PAS toucher formule/plan (reserve staff SportVision)", "patch", f"clubs?id=eq.{SV}", {"plan": "performance_hack"}, "not2xx_or_zero"),
    ("pierre_president", "President NE voit PAS un autre club", "get", f"club_teams?club_id=eq.{OTHER}&select=id,name", None, "zero"),

    ("diane_dirigeante", "Dirigeante (membre_bureau) voit les equipes de son club", "get", f"club_teams?club_id=eq.{SV}&select=id,name", None, "nonzero"),
    ("diane_dirigeante", "Dirigeante NE voit PAS un autre club", "get", f"club_teams?club_id=eq.{OTHER}&select=id,name", None, "zero"),

    ("alex_admin", "Admin SportVision voit TOUS les clubs (y compris OTHER DEMO FC)", "get", f"club_teams?club_id=eq.{OTHER}&select=id,name", None, "nonzero"),
    ("alex_admin", "Admin SportVision voit la table clubs entiere", "get", "clubs?select=id,nom", None, "nonzero"),
]

results = []
print("\n== Execution des tests RLS (vrais appels REST avec le JWT de chaque persona) ==")
for persona, desc, kind, path, body, expect in TESTS:
    if kind == "get":
        code, n, raw = rest_get(persona, path)
    else:
        code, n, raw = rest_patch(persona, path, body)

    if expect == "nonzero":
        passed = code.startswith("2") and (n or 0) > 0
    elif expect == "zero":
        passed = code.startswith("2") and (n or 0) == 0
    elif expect == "2xx":
        passed = code.startswith("2") and (n is None or n > 0)
    elif expect == "not2xx_or_zero":
        passed = (not code.startswith("2")) or (n == 0)
    else:
        passed = False

    results.append({
        "persona": persona, "desc": desc, "kind": kind, "path": path,
        "http": code, "rows": n, "expect": expect, "passed": passed,
        "raw": raw[:300],
    })
    mark = "PASS" if passed else "FAIL"
    print(f"  [{mark}] {persona:18s} | {desc}  (HTTP {code}, rows={n})")

npass = sum(1 for r in results if r["passed"])
nfail = len(results) - npass
print(f"\nRLS TESTS\nPassed : {npass}\nFailed : {nfail}")

with open("/tmp/review-rls-results.json", "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

if nfail:
    print("\n== Détail des échecs ==")
    for r in results:
        if not r["passed"]:
            print(f"- {r['persona']} | {r['desc']}")
            print(f"  attendu: {r['expect']}  obtenu: HTTP {r['http']} rows={r['rows']}")
            print(f"  reponse brute: {r['raw']}")
