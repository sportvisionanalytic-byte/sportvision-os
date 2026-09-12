#!/usr/bin/env python3
"""Obtient un vrai JWT de persona Review sans toucher aux mots de passe (magiclink admin)."""
import json, os, subprocess, tempfile

SCR = os.path.dirname(os.path.abspath(__file__))
REF = "ffjktzmsezfrwmrtlhzo"
URL = f"https://{REF}.supabase.co"
ANON = open(f"{SCR}/key_anon.txt").read().strip()
SRV = open(f"{SCR}/key_service_role.txt").read().strip()

PERSONAS = {
    "alex_admin": "alex.admin.demo@sportvision-review.invalid",
    "camille_cm": "camille.cm.demo@sportvision-review.invalid",
    "pierre_president": "pierre.president.demo@sportvision-review.invalid",
    "diane_dirigeante": "diane.dirigeante.demo@sportvision-review.invalid",
    "nicolas_coach": "nicolas.coach.demo@sportvision-review.invalid",
    "sarah_coach": "sarah.coach.demo@sportvision-review.invalid",
    "lucas_joueur": "lucas.joueur.demo@sportvision-review.invalid",
    "marie_parent": "marie.parent.demo@sportvision-review.invalid",
}


def _curl(method, url, headers, body=None, timeout=40):
    p = None
    if body is not None:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
            json.dump(body, tf)
            p = tf.name
    cmd = ["curl", "-s", "-X", method, url, "-w", "\n%{http_code}"]
    for h in headers:
        cmd += ["-H", h]
    if p:
        cmd += ["--data-binary", f"@{p}"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        lines = r.stdout.strip().splitlines()
        return (lines[-1] if lines else "?"), "\n".join(lines[:-1])
    finally:
        if p:
            os.unlink(p)


def token_for(email):
    code, body = _curl("POST", f"{URL}/auth/v1/admin/generate_link",
                       [f"apikey: {SRV}", f"Authorization: Bearer {SRV}", "Content-Type: application/json"],
                       {"type": "magiclink", "email": email})
    if not code.startswith("2"):
        raise RuntimeError(f"generate_link {code}: {body[:400]}")
    hashed = json.loads(body).get("hashed_token")
    code, body = _curl("POST", f"{URL}/auth/v1/verify",
                       [f"apikey: {ANON}", "Content-Type: application/json"],
                       {"type": "magiclink", "token_hash": hashed})
    if not code.startswith("2"):
        raise RuntimeError(f"verify {code}: {body[:400]}")
    return json.loads(body)["access_token"]


def rest(token, path, method="GET", body=None, extra=None):
    h = [f"apikey: {ANON}", f"Authorization: Bearer {token}", "Content-Type: application/json"]
    if extra:
        h += extra
    return _curl(method, f"{URL}/rest/v1/{path}", h, body)


def rpc(token, name, args):
    return rest(token, f"rpc/{name}", "POST", args)


if __name__ == "__main__":
    out = {}
    for k, e in PERSONAS.items():
        try:
            out[k] = token_for(e)
            print("OK  ", k)
        except Exception as ex:
            print("FAIL", k, ex)
    json.dump(out, open(f"{SCR}/tokens.json", "w"))
