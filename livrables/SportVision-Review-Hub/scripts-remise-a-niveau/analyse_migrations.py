#!/usr/bin/env python3
"""Pour chaque migration ajoutée depuis une date, dit si ses objets sont présents dans Review."""
import json, os, re, sys

SCR = os.path.dirname(os.path.abspath(__file__))
REPO = "/Users/fouka/Downloads/jarvis-starter-kit/.claude/worktrees/agent-ad689c4b0c74244ce"
diff = json.load(open(f"{SCR}/diff.json"))

missing_fn = {s.split("(")[0] for s in diff["fonctions"]["absent_de_review"]}
diff_fn = {s.split("(")[0] for s in diff["fonctions"]["different"]}
missing_col = set(diff["colonnes"]["absent_de_review"])
missing_pol = set(diff["policies"]["absent_de_review"])
diff_pol = set(diff["policies"]["different"])
missing_tab = set(diff["tables"]["absent_de_review"])

# ordre chronologique des migrations
cur = None
order = []
seen = set()
for l in open(f"{SCR}/mig_added.txt"):
    l = l.rstrip("\n")
    if not l.strip():
        continue
    if "|" in l and "/" not in l:
        cur = l.split("|")[1]
        continue
    if l.endswith(".sql") and l not in seen:
        seen.add(l)
        order.append((cur, l))
order.sort()

CUTOFF = sys.argv[1] if len(sys.argv) > 1 else "2026-09-09"

RE_FN = re.compile(r"create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?\"?([a-z0-9_]+)\"?\s*\(", re.I)
RE_COL = re.compile(r"alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?\"?([a-z0-9_]+)\"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?\"?([a-z0-9_]+)\"?", re.I)
RE_POL = re.compile(r"create\s+policy\s+\"?([^\"\n]+?)\"?\s+on\s+(?:public\.)?\"?([a-z0-9_]+)\"?", re.I)
RE_TAB = re.compile(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?\"?([a-z0-9_]+)\"?", re.I)

rows = []
for date, path in order:
    if date < CUTOFF:
        continue
    full = os.path.join(REPO, path)
    if not os.path.exists(full):
        rows.append((date, path, "FICHIER SUPPRIME", ""))
        continue
    sql = open(full, encoding="utf-8", errors="replace").read()
    fns = set(RE_FN.findall(sql))
    cols = {f"{t}.{c}" for t, c in RE_COL.findall(sql)}
    pols = {f"public.{t} :: {p}" for p, t in RE_POL.findall(sql)}
    tabs = set(RE_TAB.findall(sql))

    absent = []
    absent += [f"fn:{f}" for f in sorted(fns & missing_fn)]
    absent += [f"col:{c}" for c in sorted(cols & missing_col)]
    absent += [f"pol:{p}" for p in sorted(pols & missing_pol)]
    absent += [f"tab:{t}" for t in sorted(tabs & missing_tab)]
    divergent = [f"fn!:{f}" for f in sorted(fns & diff_fn)] + [f"pol!:{p}" for p in sorted(pols & diff_pol)]
    total = len(fns) + len(cols) + len(pols) + len(tabs)
    if total == 0:
        statut = "SANS OBJET DETECTABLE"
    elif absent:
        statut = "MANQUANTE"
    elif divergent:
        statut = "PRESENTE MAIS DIVERGENTE"
    else:
        statut = "APPLIQUEE"
    rows.append((date, os.path.basename(path), statut, "; ".join(absent[:6] + divergent[:4])))

for d, n, s, det in rows:
    print(f"{d} | {s:26s} | {n}")
    if det:
        print(f"{'':19s} |{'':28s}| {det}")
print()
from collections import Counter
print(Counter(r[2] for r in rows))
json.dump([{"date": d, "fichier": n, "statut": s, "detail": det} for d, n, s, det in rows],
          open(f"{SCR}/statut_migrations.json", "w"), indent=1, ensure_ascii=False)
