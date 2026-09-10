import uuid, json, secrets, string, os

def pw():
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(20))

ids = {
    "club_sv_demo": str(uuid.uuid4()),
    "club_other_demo": str(uuid.uuid4()),
    "team_u14_d1": str(uuid.uuid4()),
    "team_u18_f": str(uuid.uuid4()),
    "team_seniors_r2": str(uuid.uuid4()),
    "team_u10_a": str(uuid.uuid4()),
    "team_other_demo": str(uuid.uuid4()),
}

personas = {
    "alex_admin":    {"email": "alex.admin.demo@sportvision-review.invalid",    "prenom": "Alex",    "nom": "Admin Demo",     "kind": "os",      "os_role": "admin"},
    "camille_cm":    {"email": "camille.cm.demo@sportvision-review.invalid",    "prenom": "Camille", "nom": "CM Demo",        "kind": "os_and_club", "os_role": "cm", "club_role": "cm_externe", "club": "club_sv_demo"},
    "pierre_president": {"email": "pierre.president.demo@sportvision-review.invalid", "prenom": "Pierre", "nom": "Président Demo", "kind": "club", "club_role": "president", "club": "club_sv_demo"},
    "diane_dirigeante": {"email": "diane.dirigeante.demo@sportvision-review.invalid", "prenom": "Diane", "nom": "Dirigeante Demo", "kind": "club", "club_role": "membre_bureau", "club": "club_sv_demo"},
    "nicolas_coach": {"email": "nicolas.coach.demo@sportvision-review.invalid", "prenom": "Nicolas", "nom": "Coach Demo", "kind": "club", "club_role": "coach", "club": "club_sv_demo", "team": "team_u14_d1"},
    "sarah_coach":   {"email": "sarah.coach.demo@sportvision-review.invalid",   "prenom": "Sarah",   "nom": "Coach Demo", "kind": "club", "club_role": "coach", "club": "club_sv_demo", "team": "team_u18_f"},
    "lucas_joueur":  {"email": "lucas.joueur.demo@sportvision-review.invalid",  "prenom": "Lucas",   "nom": "Joueur Demo", "kind": "player", "club": "club_sv_demo", "team": "team_seniors_r2"},
    "marie_parent":  {"email": "marie.parent.demo@sportvision-review.invalid",  "prenom": "Marie",   "nom": "Parent Demo", "kind": "parent"},
    "noah_demo":     {"email": None, "prenom": "Noah", "nom": "Demo", "kind": "child_player", "club": "club_sv_demo", "team": "team_u10_a"},
}

for key, p in personas.items():
    p["id"] = str(uuid.uuid4())
    if p.get("email"):
        p["password"] = pw()

out = {"ids": ids, "personas": personas}
out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "personas.json")
with open(out_path, "w") as f:
    json.dump(out, f, indent=2)

print(f"Ecrit dans {out_path} (NE JAMAIS COMMIT — contient des mots de passe).")
print("ids:", list(ids.keys()))
print("personas:", list(personas.keys()))
