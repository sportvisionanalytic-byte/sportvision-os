#!/usr/bin/env python3
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sql import q, REVIEW, PROD

Q = {
 "acl_fonctions": """select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' k,
   coalesce(array_to_string(p.proacl::text[],' | '),'(defaut)') h
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1""",
 "triggers": """select c.relname||' :: '||t.tgname k, md5(pg_get_triggerdef(t.oid)) h
   from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and not t.tgisinternal order by 1""",
 "vues": """select table_name k, md5(pg_get_viewdef((quote_ident(table_schema)||'.'||quote_ident(table_name))::regclass)) h
   from information_schema.views where table_schema='public' order by 1""",
 "rls_active": """select c.relname k, (c.relrowsecurity::text||'/'||c.relforcerowsecurity::text) h
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' order by 1""",
 "acl_tables": """select c.relname k, coalesce(array_to_string(c.relacl::text[],' | '),'(defaut)') h
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','v') order by 1""",
}
for name, sql in Q.items():
    rv = {r["k"]: r["h"] for r in q(REVIEW, sql)}
    pv = {r["k"]: r["h"] for r in q(PROD, sql)}
    op = sorted(set(pv) - set(rv)); orv = sorted(set(rv) - set(pv))
    df = sorted(k for k in set(pv) & set(rv) if pv[k] != rv[k])
    print(f"== {name}: review={len(rv)} prod={len(pv)} manquants={len(op)} en_trop={len(orv)} differents={len(df)}")
    for k in op[:40]: print("   MANQUANT ", k)
    for k in df[:60]: print(f"   DIFFERENT {k}\n      review={rv[k][:220]}\n      prod  ={pv[k][:220]}")
