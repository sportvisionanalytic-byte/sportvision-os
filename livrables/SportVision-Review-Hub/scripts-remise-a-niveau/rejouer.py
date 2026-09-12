#!/usr/bin/env python3
"""Rejoue les migrations manquantes contre REVIEW uniquement, une par une, et journalise."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sql import run, REVIEW

SCR = os.path.dirname(os.path.abspath(__file__))
REPO = "/Users/fouka/Downloads/jarvis-starter-kit/.claude/worktrees/agent-ad689c4b0c74244ce"

plan = json.load(open(f"{SCR}/plan_rejeu.json"))
log_path = f"{SCR}/journal_rejeu.json"
journal = json.load(open(log_path)) if os.path.exists(log_path) else {}

start = sys.argv[1] if len(sys.argv) > 1 else None
stop_on_fail = os.environ.get("CONTINUE") != "1"
only = sys.argv[2] if len(sys.argv) > 2 else None

started = start is None
for path in plan:
    b = os.path.basename(path)
    if not started:
        if b == start:
            started = True
        else:
            continue
    if journal.get(b, {}).get("code", "").startswith("2") and b != start:
        continue
    sql = open(os.path.join(REPO, path), encoding="utf-8", errors="replace").read()
    code, payload = run(REVIEW, sql, timeout=300)
    journal[b] = {"code": code, "erreur": None if code.startswith("2") else payload[:1200]}
    json.dump(journal, open(log_path, "w"), indent=1, ensure_ascii=False)
    if code.startswith("2"):
        print(f"OK    {b}")
    else:
        print(f"ECHEC {b}\n      {payload[:900]}")
        if stop_on_fail:
            sys.exit(1)
print("fin")
