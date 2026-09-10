"""
RESET REVIEW — remet le projet Supabase Review dans un état initial connu.

dataset initial -> personas Auth cohérentes -> memberships restaurées ->
invitations initiales -> droits à l'image initiaux -> contenus/événements
initiaux -> Outbox réinitialisée.

GARDE-FOU ABSOLU : ce script refuse de s'exécuter si le project ref n'est
pas exactement celui du projet Review. Aucune variable, aucun argument,
aucun contournement ne peut changer cette valeur — elle est en dur, et
vérifiée par un appel réel à l'API Management avant toute écriture (pas
seulement comparée à une chaîne locale, pour se protéger d'une éventuelle
erreur de configuration locale qui pointerait ailleurs).

Usage :
  export SUPABASE_MANAGEMENT_TOKEN=...
  python3 reset-review.py --confirm
"""
import json, os, subprocess, sys, tempfile

# ============================================================================
# GARDE-FOU — ne pas modifier cette valeur, ne pas la rendre configurable.
# ============================================================================
EXPECTED_PROJECT_REF = "ffjktzmsezfrwmrtlhzo"

HERE = os.path.dirname(os.path.abspath(__file__))
MGMT_TOKEN = os.environ.get("SUPABASE_MANAGEMENT_TOKEN")


def sql(query, label=""):
    wrapped = "set local request.jwt.claim.role = 'service_role';\n" + query
    url = f"https://api.supabase.com/v1/projects/{EXPECTED_PROJECT_REF}/database/query"
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump({"query": wrapped}, tf)
        body_path = tf.name
    try:
        proc = subprocess.run(
            ["curl", "-s", "-X", "POST", url,
             "-H", f"Authorization: Bearer {MGMT_TOKEN}",
             "-H", "Content-Type: application/json",
             "--data-binary", f"@{body_path}", "-w", "\n%{http_code}"],
            capture_output=True, text=True, timeout=60,
        )
        out = proc.stdout
        code = out.strip().splitlines()[-1] if out.strip() else "?"
        body = "\n".join(out.strip().splitlines()[:-1])
        ok = code.startswith("2")
        if not ok:
            print(f"  FAIL [{label}] HTTP {code}: {body[:300]}")
        return ok
    finally:
        os.unlink(body_path)


def verify_project_ref_live():
    """Vérifie par un VRAI appel à l'API Management que ce ref existe et
    correspond bien au projet nommé 'sportvision-review' — pas seulement
    une comparaison de chaîne locale. Refuse si le nom ne correspond pas
    non plus (double vérification : ref ET nom)."""
    if not MGMT_TOKEN:
        print("REFUS : SUPABASE_MANAGEMENT_TOKEN absent de l'environnement.")
        sys.exit(1)
    proc = subprocess.run(
        ["curl", "-s", "https://api.supabase.com/v1/projects",
         "-H", f"Authorization: Bearer {MGMT_TOKEN}"],
        capture_output=True, text=True, timeout=30,
    )
    try:
        projects = json.loads(proc.stdout)
    except Exception:
        print("REFUS : impossible de vérifier le projet via l'API Management.")
        sys.exit(1)
    match = next((p for p in projects if p.get("id") == EXPECTED_PROJECT_REF), None)
    if not match:
        print(f"REFUS : le project ref {EXPECTED_PROJECT_REF} n'existe pas ou n'est pas accessible.")
        sys.exit(1)
    if match.get("name") != "sportvision-review":
        print(f"REFUS : le projet {EXPECTED_PROJECT_REF} existe mais s'appelle "
              f"'{match.get('name')}', pas 'sportvision-review'. Arrêt par précaution "
              f"(le nom a peut-être changé, ou ce n'est pas le bon projet).")
        sys.exit(1)
    print(f"Vérifié en direct : {EXPECTED_PROJECT_REF} = projet 'sportvision-review'. Poursuite autorisée.")


def main():
    if "--confirm" not in sys.argv:
        print("Ce script modifie des données. Relancer avec --confirm pour exécuter réellement.")
        print(f"Cible : {EXPECTED_PROJECT_REF} (vérifiée en direct avant toute écriture, jamais la production).")
        sys.exit(0)

    verify_project_ref_live()

    print("\n== 1. Suppression des données Review (ordre sûr vis-à-vis des clés étrangères) ==")
    tables_in_fk_order = [
        "review_outbox",
        "club_newsroom_items",
        "club_requests",
        "club_invitations",
        "parental_authorizations",
        "team_memberships",
        "club_matches",
        "club_calendar_events",
        "player_profiles",
        "club_cm_affectations",
        "club_members",
        "club_teams",
    ]
    for t in tables_in_fk_order:
        ok = sql(f"delete from {t};", f"purge {t}")
        print(f"  {'OK' if ok else 'FAIL'} : {t} vidée")

    print("\n== 2. Re-provisioning (personas, équipes, effectifs, calendrier, communication) ==")
    scripts = [
        "provision-personas.py",
        "seed-sv-demo-fc-large.py",
        "seed-sv-demo-fc-large-part2.py",
        "seed-sv-demo-fc-large-part3.py",
    ]
    for s in scripts:
        print(f"\n--- {s} ---")
        result = subprocess.run(
            [sys.executable, os.path.join(HERE, s)],
            env={**os.environ, "SUPABASE_MANAGEMENT_TOKEN": MGMT_TOKEN},
        )
        if result.returncode != 0:
            print(f"ARRÊT : {s} a échoué (code {result.returncode}). État partiellement réinitialisé — "
                  f"relancer ce même script pour reprendre (idempotent).")
            sys.exit(1)

    print("\n== RESET REVIEW terminé ==")
    print("Dataset initial restauré : SV Demo FC (34 équipes, 461 joueurs), OTHER DEMO FC,")
    print("8 personas Auth (inchangées, mots de passe conservés), memberships, invitations,")
    print("droits à l'image, calendrier (3672 événements), matchs, communication, Outbox.")


if __name__ == "__main__":
    main()
