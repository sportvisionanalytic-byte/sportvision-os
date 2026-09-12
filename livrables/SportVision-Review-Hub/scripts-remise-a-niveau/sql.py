#!/usr/bin/env python3
"""Exécute du SQL via l'API Management Supabase.

Garde-fou : REVIEW = ffjktzmsezfrwmrtlhzo (écriture autorisée),
PROD = lulgezzpvrlbftbykzrc (LECTURE SEULE, refus de tout mot-clé d'écriture).
"""
import json, os, re, subprocess, sys, tempfile

REVIEW = "ffjktzmsezfrwmrtlhzo"
PROD = "lulgezzpvrlbftbykzrc"

def _token():
    for l in open("/Users/fouka/Downloads/jarvis-starter-kit/.env"):
        l = l.strip()
        if l.startswith("SUPABASE_MANAGEMENT_TOKEN="):
            return l.split("=", 1)[1].strip().strip('"')
    raise SystemExit("token introuvable")

WRITE = re.compile(r"\b(insert|update|delete|drop|create|alter|grant|revoke|truncate|comment\s+on|do\s*\$|refresh|reindex|vacuum|set\s+)\b", re.I)

def run(ref, sql, timeout=180):
    if ref == PROD and WRITE.search(sql):
        raise SystemExit("REFUS: écriture tentée sur la PRODUCTION")
    if ref not in (REVIEW, PROD):
        raise SystemExit(f"REFUS: ref inconnu {ref}")
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump({"query": sql}, tf)
        p = tf.name
    try:
        r = subprocess.run(["curl", "-s", "-w", "\n%{http_code}", "-X", "POST",
            f"https://api.supabase.com/v1/projects/{ref}/database/query",
            "-H", f"Authorization: Bearer {_token()}",
            "-H", "Content-Type: application/json",
            "--data-binary", f"@{p}"], capture_output=True, text=True, timeout=timeout)
        out = r.stdout.strip()
        lines = out.splitlines()
        code = lines[-1] if lines else "?"
        payload = "\n".join(lines[:-1])
        return code, payload
    finally:
        os.unlink(p)

def q(ref, sql):
    code, payload = run(ref, sql)
    if not code.startswith("2"):
        raise SystemExit(f"HTTP {code}: {payload[:3000]}")
    try:
        return json.loads(payload)
    except Exception:
        return payload

if __name__ == "__main__":
    ref = {"review": REVIEW, "prod": PROD}[sys.argv[1]]
    sql = sys.stdin.read() if sys.argv[2] == "-" else sys.argv[2]
    code, payload = run(ref, sql)
    print(code)
    print(payload[:20000])
