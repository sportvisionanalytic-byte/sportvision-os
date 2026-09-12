-- v192 — Le mois d'une facture Full Communication s'écrit en français (12/09/2026).
--
-- `to_char(v_period, 'TMMonth YYYY')` suit `lc_time`, qui vaut `en_US.UTF-8` sur la base de
-- production. La ligne de facture envoyée à un club français annonçait donc « Full
-- Communication — September 2026 ». C'est la seule facture réelle de la base, et c'est un
-- document qui part au client.
--
-- On ne touche à rien d'autre : mêmes montants, mêmes garde-fous, même idempotence par période.
-- Idempotente.

create or replace function public.mois_en_francais(p_date date)
returns text language sql immutable set search_path to 'public', 'pg_temp'
as $$
  select (array['janvier','février','mars','avril','mai','juin',
                'juillet','août','septembre','octobre','novembre','décembre'])[extract(month from p_date)::int]
         || ' ' || extract(year from p_date)::text;
$$;

do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src from pg_proc
   where proname = 'generate_full_com_monthly_invoices' and pronamespace = 'public'::regnamespace;
  if v_src is null then raise exception 'generate_full_com_monthly_invoices introuvable'; end if;
  if position('TMMonth' in v_src) = 0 then
    raise notice 'Déjà corrigée, rien à faire.';
    return;
  end if;
  v_src := replace(v_src,
    '''Full Communication — '' || to_char(v_period, ''TMMonth YYYY'')',
    '''Full Communication — '' || mois_en_francais(v_period)');
  execute v_src;
end $$;
