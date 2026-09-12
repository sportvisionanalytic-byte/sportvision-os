#!/usr/bin/env python3
import json, os, re
SCR = os.path.dirname(os.path.abspath(__file__))
REPO = "/Users/fouka/Downloads/jarvis-starter-kit/.claude/worktrees/agent-ad689c4b0c74244ce"

cur = None; order = []; seen = set()
for l in open(f"{SCR}/mig_added.txt"):
    l = l.rstrip("\n")
    if not l.strip(): continue
    if "|" in l and "/" not in l:
        cur = l.split("|")[1]; continue
    if l.endswith(".sql") and l not in seen:
        seen.add(l); order.append((cur, l))
order.sort()

CUT = "2026-09-10 16:52"
EXCEPTIONS = ["migration-coverage-wishes-e24-e25.sql",
              "migration-operateur-v1-cloisonnement-livraisons.sql",
              "migration-federation-v20-exclusions-synchro.sql"]

plan = []
for d, p in order:
    b = os.path.basename(p)
    if not os.path.exists(os.path.join(REPO, p)):
        continue
    if d >= CUT or b in EXCEPTIONS:
        plan.append((d, p))
plan.sort(key=lambda x: (EXCEPTIONS.index(os.path.basename(x[1])) if os.path.basename(x[1]) in EXCEPTIONS else 99, x[0]))
# exceptions d'abord (dans leur ordre chronologique), puis le reste chronologique
exc = sorted([x for x in plan if os.path.basename(x[1]) in EXCEPTIONS])
rest = sorted([x for x in plan if os.path.basename(x[1]) not in EXCEPTIONS])
plan = exc + rest

DANGER = re.compile(r"\b(truncate|drop\s+table|drop\s+schema|delete\s+from)\b", re.I)
print(f"{len(plan)} migrations à rejouer\n")
for d, p in plan:
    sql = open(os.path.join(REPO, p), encoding="utf-8", errors="replace").read()
    flags = []
    for m in DANGER.finditer(sql):
        line = sql[:m.start()].count("\n") + 1
        flags.append(f"L{line}:{m.group(0)}")
    md5 = "MD5-GUARD" if re.search(r"md5\s*\(", sql, re.I) else ""
    print(f"{d} {os.path.basename(p):65s} {md5:10s} {' '.join(flags[:5])}")
json.dump([p for _, p in plan], open(f"{SCR}/plan_rejeu.json", "w"), indent=1)
