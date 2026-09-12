#!/usr/bin/env python3
import difflib, json, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sql import q, REVIEW, PROD

names = sys.argv[1:]
lst = ",".join("'" + n.replace("'", "''") + "'" for n in names)
SQL = f"""select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' k,
 pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ({lst}) order by 1"""
r = {x["k"]: x["d"] for x in q(REVIEW, SQL)}
p = {x["k"]: x["d"] for x in q(PROD, SQL)}
for k in sorted(set(r) | set(p)):
    if r.get(k) == p.get(k):
        continue
    print("=" * 90)
    print(k)
    a = (r.get(k) or "").replace("; ", ";\n").splitlines()
    b = (p.get(k) or "").replace("; ", ";\n").splitlines()
    for line in difflib.unified_diff(a, b, "REVIEW", "PROD", lineterm="", n=1):
        print(line[:400])
