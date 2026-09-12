#!/usr/bin/env python3
"""Verifie les 5 blocages de l'audit Review par le chemin reel (PostgREST, vrais JWT)."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jwt import rest, rpc

T = json.load(open("" + SCR + "/tokens.json"))
SV = "5bda3729-7369-417a-812c-822156cd8634"
OTHER = "65293170-3d87-4be4-86eb-b6299504f487"
DU, AU = "2026-07-01", "2027-06-30"


def show(titre, code, body, n=260):
    try:
        d = json.loads(body)
        taille = len(d) if isinstance(d, list) else "obj"
    except Exception:
        d, taille = None, "?"
    print(f"  [{code}] {titre} -> {taille} lignes | {body[:n]}")
    return code, d


print("== BLOCAGE 1 — calendrier du coach borne a ses equipes ==")
for who in ("nicolas_coach", "sarah_coach", "pierre_president", "marie_parent"):
    t0 = time.time()
    code, body = rpc(T[who], "club_calendrier", {"p_club_id": SV, "p_du": DU, "p_au": AU})
    ms = int((time.time() - t0) * 1000)
    c, d = show(f"{who} club_calendrier ({ms} ms)", code, body, 80)
    if isinstance(d, list) and d:
        eq = {}
        for r in d:
            eq[r.get("equipe")] = eq.get(r.get("equipe"), 0) + 1
        print("      equipes vues:", json.dumps(eq, ensure_ascii=False)[:400])

print("\n== BLOCAGE 1bis — membre_borne_a_ses_equipes ==")
for who in ("nicolas_coach", "sarah_coach", "pierre_president", "camille_cm"):
    code, body = rpc(T[who], "membre_borne_a_ses_equipes", {"p_club_id": SV})
    show(f"{who}", code, body, 60)

print("\n== BLOCAGE 2 — espace du CM affilie (Camille) ==")
for path in ("clients?select=id,nom&limit=20", "contrats?select=id,client_id&limit=20",
             "clubs?select=id,nom&limit=20", "club_teams?select=id,nom&limit=5"):
    code, body = rest(T["camille_cm"], path)
    show(f"camille GET {path.split('?')[0]}", code, body, 200)
print("  -- controle de vitalite : le meme appel pour un persona sans droit --")
code, body = rest(T["lucas_joueur"], "clients?select=id,nom&limit=20")
show("lucas GET clients (doit etre vide)", code, body, 120)

print("\n== BLOCAGE 3 — cm_tableau_de_bord ==")
for who in ("camille_cm", "alex_admin"):
    t0 = time.time()
    code, body = rpc(T[who], "cm_tableau_de_bord", {})
    ms = int((time.time() - t0) * 1000)
    show(f"{who} cm_tableau_de_bord ({ms} ms)", code, body, 300)

print("\n== BLOCAGE 5 — widgets, temps de reponse ==")
appels = [
    ("club_equipes_etat", {"p_club_id": SV}),
    ("club_membres_coordonnees", {"p_club_id": SV}),
    ("club_donnees_restreintes", {"p_club_id": SV}),
    ("club_presences_sportvision", {"p_club_id": SV}),
    ("liens_parents_a_decider", {"p_club_id": SV}),
]
for who in ("pierre_president", "nicolas_coach", "diane_dirigeante", "camille_cm"):
    print(f"  -- {who} --")
    for nom, args in appels:
        t0 = time.time()
        code, body = rpc(T[who], nom, args)
        ms = int((time.time() - t0) * 1000)
        show(f"{nom} ({ms} ms)", code, body, 90)
    for path in ("club_teams?select=id,nom&limit=50", "club_members?select=id,role&limit=50",
                 "membership_requests?select=id&limit=50", "club_creations?select=id&limit=50"):
        t0 = time.time()
        code, body = rest(T[who], path)
        ms = int((time.time() - t0) * 1000)
        show(f"GET {path.split('?')[0]} ({ms} ms)", code, body, 60)

print("\n== ISOLATION — le club temoin reste ferme ==")
for who in ("nicolas_coach", "pierre_president", "camille_cm"):
    code, body = rpc(T[who], "club_calendrier", {"p_club_id": OTHER, "p_du": DU, "p_au": AU})
    show(f"{who} club_calendrier(OTHER DEMO FC) doit etre vide/refuse", code, body, 120)
