-- Deux versions d'une même fonction, appelables avec le même nombre d'arguments : Postgres refuse
-- de choisir, et l'appelant reçoit 42725 « is not unique ».
--
-- CE QUI A RENDU CE TEST NÉCESSAIRE (26/09/2026). La v269 a ajouté un brief à
-- `cm_definir_couverture` avec `create or replace function ...(p_ref, p_type, p_brief default
-- null)`. Une signature différente ne remplace pas, elle SURCHARGE. Les deux versions ont vécu
-- côte à côte, et `p_brief default null` rendait l'ancienne appelable de la même façon.
-- `cm_select_coverage_wish` — le geste par lequel le CM ACCEPTE la demande d'un club — appelle avec
-- deux arguments : il échouait depuis la veille au soir. Club+ appelle avec trois arguments nommés,
-- donc le chemin le plus visible marchait, et personne n'a rien vu.
--
-- Le test compte, par nom de fonction, les plages d'arité appelables (de « obligatoires » à
-- « tous »). Deux plages qui se chevauchent = un appel ambigu possible.

do $$
declare v text := ''; n int := 0; f record;
begin
  for f in
    with sig as (
      select p.proname,
             p.pronargs - p.pronargdefaults as mini,
             p.pronargs as maxi
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.prokind = 'f'
    )
    select a.proname, a.mini amini, a.maxi amaxi, b.mini bmini, b.maxi bmaxi
      from sig a join sig b on a.proname = b.proname and a.maxi < b.maxi
     where a.mini <= b.maxi and b.mini <= a.maxi   -- les plages se chevauchent
     order by a.proname
  loop
    n := n + 1;
    v := v || format(E'\n  %s : arites %s-%s et %s-%s se chevauchent', f.proname, f.amini, f.amaxi, f.bmini, f.bmaxi);
  end loop;

  if n > 0 then
    raise exception 'ROUGE : % fonction(s) surchargee(s) de facon ambigue%', n, v;
  end if;
  raise notice 'VERT : aucune fonction publique n''a deux versions appelables du meme nombre d''arguments';
end $$;
