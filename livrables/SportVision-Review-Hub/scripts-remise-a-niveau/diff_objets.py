#!/usr/bin/env python3
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sql import q, REVIEW, PROD

QUERIES = {
 "fonctions": """select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as k,
   md5(coalesce(p.prosrc,'')) as h
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' order by 1""",
 "colonnes": """select c.table_name||'.'||c.column_name as k, c.data_type as h
   from information_schema.columns c where c.table_schema='public' order by 1""",
 "policies": """select schemaname||'.'||tablename||' :: '||policyname as k,
   md5(coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||cmd||'|'||array_to_string(roles,',')) as h
   from pg_policies where schemaname='public' order by 1""",
 "tables": """select table_name as k, table_type as h from information_schema.tables
   where table_schema='public' order by 1""",
}

out = {}
for name, sql in QUERIES.items():
    rv = {r["k"]: r["h"] for r in q(REVIEW, sql)}
    pv = {r["k"]: r["h"] for r in q(PROD, sql)}
    only_prod = sorted(set(pv) - set(rv))
    only_rev = sorted(set(rv) - set(pv))
    diff = sorted(k for k in set(pv) & set(rv) if pv[k] != rv[k])
    out[name] = {"n_review": len(rv), "n_prod": len(pv),
                 "absent_de_review": only_prod, "en_trop_review": only_rev,
                 "different": diff}
    print(f"== {name} == review={len(rv)} prod={len(pv)} | manquants_review={len(only_prod)} en_trop={len(only_rev)} differents={len(diff)}")

json.dump(out, open("" + SCR + "/diff.json", "w"), indent=1, ensure_ascii=False)
print("écrit diff.json")
