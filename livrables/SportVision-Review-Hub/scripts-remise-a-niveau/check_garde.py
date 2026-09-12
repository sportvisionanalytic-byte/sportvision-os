#!/usr/bin/env python3
"""Compare les empreintes attendues par un garde-fou md5 à celles de Review (et de prod)."""
import json, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sql import q, REVIEW, PROD

path = sys.argv[1]
src = open(path, encoding="utf-8", errors="replace").read()
blobs = re.findall(r"'(\{\"public\.[^']*\})'", src)
attendu = {}
for b in blobs:
    attendu.update(json.loads(b))
print(f"{len(attendu)} empreintes attendues")

keys = list(attendu)
sql_keys = ",".join("(" + repr(k).replace("'", "''").join(("'", "'")) + ")" for k in keys)
vals = ",".join("('" + k.replace("'", "''") + "')" for k in keys)
SQL = f"""
with k(sig) as (values {vals})
select sig,
  case when to_regprocedure(sig) is null then 'ABSENTE'
       else md5(pg_get_functiondef(sig::regprocedure)) end as h
from k order by 1"""
for label, ref in (("REVIEW", REVIEW), ("PROD", PROD)):
    got = {r["sig"]: r["h"] for r in q(ref, SQL)}
    bad = [(k, attendu[k], got.get(k)) for k in keys if got.get(k) != attendu[k]]
    print(f"-- {label}: {len(bad)} écarts sur {len(keys)}")
    for k, a, g in bad:
        print(f"   {k}  attendu={a[:8]} actuel={'ABSENTE' if g=='ABSENTE' else (g or '?')[:8]}")
