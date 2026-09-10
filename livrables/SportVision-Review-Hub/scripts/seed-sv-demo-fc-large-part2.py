"""
Seed etendu SV Demo FC — partie 2 : effectifs, calendrier a forte charge,
matchs, invitations, droits a l'image, communication.

A lancer apres seed-sv-demo-fc-large.py (qui ecrit large-seed-state.json).
Idempotent (ids deterministes uuid5, ON CONFLICT DO NOTHING).
"""
import json, os, random, subprocess, tempfile, uuid, datetime

PROJECT_REF = "ffjktzmsezfrwmrtlhzo"
MGMT_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
MGMT_TOKEN = os.environ["SUPABASE_MANAGEMENT_TOKEN"]
NAMESPACE = uuid.UUID("f6a5b9a0-0000-4000-8000-000000000001")

HERE = os.path.dirname(os.path.abspath(__file__))
PERSONAS = json.load(open(os.path.join(HERE, "personas.json")))
STATE = json.load(open(os.path.join(HERE, "large-seed-state.json")))
CLUB_SV = PERSONAS["ids"]["club_sv_demo"]
ALEX_ADMIN_ID = PERSONAS["personas"]["alex_admin"]["id"]

random.seed(43)


def uid(*parts):
    return str(uuid.uuid5(NAMESPACE, "|".join(parts)))


BATCH = []

def queue(query):
    BATCH.append(query)

def flush(label=""):
    global BATCH
    if not BATCH:
        return True
    wrapped = "set local request.jwt.claim.role = 'service_role';\n" + "\n".join(BATCH)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump({"query": wrapped}, tf)
        body_path = tf.name
    try:
        proc = subprocess.run(
            ["curl", "-s", "-X", "POST", MGMT_URL,
             "-H", f"Authorization: Bearer {MGMT_TOKEN}",
             "-H", "Content-Type: application/json",
             "--data-binary", f"@{body_path}", "-w", "\n%{http_code}"],
            capture_output=True, text=True, timeout=90,
        )
        out = proc.stdout
        code = out.strip().splitlines()[-1] if out.strip() else "?"
        body = "\n".join(out.strip().splitlines()[:-1])
        ok = code.startswith("2")
        if not ok:
            print(f"  FAIL [{label}] HTTP {code}: {body[:300]}")
        BATCH = []
        return ok
    finally:
        os.unlink(body_path)


def esc(s):
    if s is None:
        return "null"
    return "'" + str(s).replace("'", "''") + "'"


PRENOMS = ["Lucas","Enzo","Nathan","Hugo","Gabriel","Louis","Raphael","Tom","Ethan","Mohamed",
           "Adam","Noah","Liam","Sacha","Jules","Mathis","Rayan","Yanis","Maxime","Theo",
           "Emma","Jade","Louise","Alice","Lina","Chloe","Manon","Lea","Camille","Zoe",
           "Ines","Sarah","Nina","Anna","Julia","Eva","Mila","Rose","Lucie","Agathe"]
NOMS = ["Martin","Bernard","Dubois","Thomas","Robert","Richard","Petit","Durand","Leroy","Moreau",
        "Simon","Laurent","Lefebvre","Michel","Garcia","David","Bertrand","Roux","Vincent","Fournier"]
OPPONENTS = ["AS Vertville","FC Montclair","Racing Brancourt","US Lanoue","Olympique Ferray",
             "Stade Corbigny","ES Vaubourg","FC Perrichamps","AS Meillon","US Tourcelles"]

# ---------------------------------------------------------------------------
# 1. Effectifs (joueurs + team_memberships) — completude variable par equipe
# ---------------------------------------------------------------------------
print("== 1. Effectifs ==")
no_roster = set(STATE["no_roster_keys"])
partial_roster = set(STATE["partial_roster_keys"])
players_by_team = {}

for t in STATE["all_teams"]:
    key = t["key"]
    if key in no_roster:
        players_by_team[t["id"]] = []
        continue
    n = random.randint(4, 8) if key in partial_roster else random.randint(14, 20)
    roster = []
    for i in range(n):
        pid = uid("player", key, str(i))
        prenom, nom = random.choice(PRENOMS), random.choice(NOMS)
        age_map = {"U6":5,"U7":6,"U8":7,"U9":8,"U10":9,"U11":10,"U12":11,"U13":12,"U14":13,"U15":14,"U16":15,"U18":17,"Seniors":22}
        base_age = age_map.get(t["categorie"], 15)
        birth_year = 2026 - base_age - random.randint(0,1)
        dob = f"{birth_year}-{random.randint(1,12):02d}-{random.randint(1,28):02d}"
        roster.append((pid, prenom, nom, dob))
        queue(f"""
        insert into player_profiles (id, club_id, prenom, nom, date_naissance, account_status)
        values ('{pid}', '{CLUB_SV}', {esc(prenom)}, {esc(nom)}, '{dob}', 'sans_compte')
        on conflict (id) do nothing;
        """)
        queue(f"""
        insert into team_memberships (player_id, team_id, club_id, saison, statut)
        values ('{pid}', '{t['id']}', '{CLUB_SV}', '2026-2027', 'active')
        on conflict (player_id, team_id, saison) do nothing;
        """)
    players_by_team[t["id"]] = roster
    if len(BATCH) > 200:
        flush(f"roster {key}")

flush("roster final")
print(f"Effectifs générés pour {len(players_by_team)} équipes.")

with open(os.path.join(HERE, "large-seed-players.json"), "w") as f:
    json.dump({tid: [p[0] for p in roster] for tid, roster in players_by_team.items()}, f)

# ---------------------------------------------------------------------------
# 2. Droits à l'image — AUTORISÉ / EN ATTENTE / REFUSÉ / NON RENSEIGNÉ
# ---------------------------------------------------------------------------
print("== 2. Droits à l'image ==")
DROIT_IMAGE_TYPE = "a258f6ed-68c5-45c6-8189-f72942013cc9"
DROIT_IMAGE_VERSION = "7f706e96-bc41-4bc9-8719-453dcb7bd0eb"
all_players = [(pid, tid) for tid, roster in players_by_team.items() for pid in [p[0] for p in roster]]
random.shuffle(all_players)
n = len(all_players)
i_autorise = all_players[: n // 3]
i_attente = all_players[n // 3 : 2 * n // 3]
i_refuse = all_players[2 * n // 3 : int(2 * n / 3 + n / 10)]
# le reste (~23%) = NON RENSEIGNÉ : aucune ligne

for pid, _ in i_autorise:
    queue(f"""
    insert into parental_authorizations (id, player_id, authorization_type_id, version_id, statut, methode, date_signature)
    values ('{uid('auth', pid)}', '{pid}', '{DROIT_IMAGE_TYPE}', '{DROIT_IMAGE_VERSION}', 'valide', 'signature_numerique', now())
    on conflict (id) do nothing;
    """)
for pid, _ in i_attente:
    queue(f"""
    insert into parental_authorizations (id, player_id, authorization_type_id, version_id, statut)
    values ('{uid('auth', pid)}', '{pid}', '{DROIT_IMAGE_TYPE}', '{DROIT_IMAGE_VERSION}', 'en_attente')
    on conflict (id) do nothing;
    """)
for pid, _ in i_refuse:
    queue(f"""
    insert into parental_authorizations (id, player_id, authorization_type_id, version_id, statut)
    values ('{uid('auth', pid)}', '{pid}', '{DROIT_IMAGE_TYPE}', '{DROIT_IMAGE_VERSION}', 'refusee')
    on conflict (id) do nothing;
    """)
    if len(BATCH) > 200:
        flush("droits image")
flush("droits image final")
print(f"Droits à l'image : {len(i_autorise)} autorisés, {len(i_attente)} en attente, {len(i_refuse)} refusés, {n - len(i_autorise) - len(i_attente) - len(i_refuse)} non renseignés.")

# ---------------------------------------------------------------------------
# 3. Calendrier à forte charge : 1000+ événements sur la saison
# ---------------------------------------------------------------------------
print("== 3. Calendrier (objectif 1000+ événements) ==")
season_start = datetime.date(2026, 9, 1)
season_end = datetime.date(2027, 6, 30)
n_days = (season_end - season_start).days

event_count = 0
for t in STATE["all_teams"]:
    # ~2 entrainements/semaine sur toute la saison + quelques matchs
    n_weeks = n_days // 7
    for w in range(n_weeks):
        for d_offset in (2, 5):  # mardi et vendredi (approx)
            event_date = season_start + datetime.timedelta(days=w * 7 + d_offset)
            if event_date > season_end:
                continue
            eid = uid("event", t["key"], "train", str(w), str(d_offset))
            queue(f"""
            insert into club_calendar_events (id, club_id, event_date, type, title, team, team_id, event_time, location)
            values ('{eid}', '{CLUB_SV}', '{event_date.isoformat()}', 'entrainement', {esc('Entraînement ' + t['name'])}, {esc(t['name'])}, '{t['id']}', '18:30', 'Stade municipal SV Demo')
            on conflict (id) do nothing;
            """)
            event_count += 1
            if len(BATCH) > 300:
                flush(f"calendrier train {t['key']} s{w}")
    # ~1 match toutes les 2 semaines en saison de match (sept-mai)
    for w in range(0, n_weeks, 2):
        event_date = season_start + datetime.timedelta(days=w * 7 + 6)
        if event_date > season_end or event_date.month == 7:
            continue
        eid = uid("event", t["key"], "match", str(w))
        queue(f"""
        insert into club_calendar_events (id, club_id, event_date, type, title, team, team_id, event_time, location)
        values ('{eid}', '{CLUB_SV}', '{event_date.isoformat()}', 'match', {esc('Match ' + t['name'])}, {esc(t['name'])}, '{t['id']}', '15:00', 'Stade municipal SV Demo')
        on conflict (id) do nothing;
        """)
        event_count += 1
        if len(BATCH) > 300:
            flush(f"calendrier match {t['key']} s{w}")

flush("calendrier final")
print(f"Événements calendrier créés : {event_count}")

# ---------------------------------------------------------------------------
# 4. Matchs (club_matches) — avec résultats manquants sur une partie
# ---------------------------------------------------------------------------
print("== 4. Matchs (club_matches) avec résultats parfois manquants ==")
match_count = 0
for t in STATE["all_teams"][:20]:  # sous-ensemble représentatif, pas toutes les 44 équipes
    for w in range(0, 10, 2):
        event_date = season_start + datetime.timedelta(days=w * 7 + 6)
        if event_date > season_end:
            continue
        mid = uid("clubmatch", t["key"], str(w))
        is_past = event_date < datetime.date(2026, 10, 1)
        opponent = random.choice(OPPONENTS)
        if is_past and random.random() < 0.75:
            # résultat renseigné
            score = f"{random.randint(0,4)}-{random.randint(0,4)}"
            status, sport_status = "recu", "completed"
        elif is_past:
            # résultat manquant volontairement (cas incomplet demandé)
            score = "null"
            status, sport_status = "a_transmettre", "completed"
        else:
            score = "null"
            status, sport_status = "a_venir", "scheduled"
        score_sql = esc(score) if score != "null" else "null"
        queue(f"""
        insert into club_matches (id, club_id, team, team_id, opponent, match_date, status, sport_status, score, provider, is_home)
        values ('{mid}', '{CLUB_SV}', {esc(t['name'])}, '{t['id']}', {esc(opponent)}, '{event_date.isoformat()}', '{status}', '{sport_status}', {score_sql}, 'MANUAL', {str(random.random()<0.5).lower()})
        on conflict (id) do nothing;
        """)
        match_count += 1
        if len(BATCH) > 200:
            flush(f"match {t['key']}")
flush("matchs final")
print(f"Matchs créés (avec résultats manquants sur une partie) : {match_count}")

print("\n== Phase seed part 2 terminée ==")
