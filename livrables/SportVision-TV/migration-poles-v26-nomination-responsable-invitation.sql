-- ============================================================================
-- migration-poles-v26-nomination-responsable-invitation.sql
-- Fouka : "je veux pouvoir le faire depuis l'OS soit créer un responsable
-- pôle directement soit modifier un collaborateur pour le mettre responsable
-- de pôle" (31/08/2026). Étend ensure_default_pole_affectation() (migration-
-- poles-v14) pour lire p_meta->'responsable_pole_ids' (sous-ensemble de
-- pole_ids à affecter directement en role_pole='responsable' plutôt que
-- 'membre') — posé par invite-collaborateur (edge function, restreint à
-- l'admin, cf. migration-poles-v25 pour le pendant RLS côté fiche existante).
-- ============================================================================

create or replace function public.ensure_default_pole_affectation(p_user_id uuid, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_pole_ids uuid[];
  v_responsable_ids uuid[];
  v_single uuid;
  v_id uuid;
begin
  v_role := p_meta->>'role';
  if v_role = 'rh' then
    return; -- accès global par rôle (is_admin_or_rh()), pas par pole_affectations
  end if;

  v_pole_ids := null;
  if jsonb_typeof(p_meta->'pole_ids') = 'array' then
    begin
      select array_agg((elem)::uuid) into v_pole_ids
        from jsonb_array_elements_text(p_meta->'pole_ids') as elem
        where elem is not null and elem <> '';
    exception when others then
      v_pole_ids := null;
    end;
  end if;

  if v_pole_ids is null or array_length(v_pole_ids, 1) is null then
    -- Compat ascendante : ancien format à pôle unique (migration-poles-v11/v12).
    begin
      v_single := nullif(p_meta->>'pole_id', '')::uuid;
    exception when others then
      v_single := null;
    end;
    if v_single is not null then
      v_pole_ids := array[v_single];
    end if;
  end if;

  -- Filtre les ids invalides (pôle inexistant) plutôt que d'échouer.
  if v_pole_ids is not null then
    select array_agg(x) into v_pole_ids
      from unnest(v_pole_ids) x
      where exists (select 1 from public.poles where id = x);
  end if;

  if v_pole_ids is null or array_length(v_pole_ids, 1) is null then
    v_pole_ids := array[pole_football_id()];
  end if;

  -- Sous-ensemble de v_pole_ids à affecter directement en Responsable (migration-poles-v26,
  -- 31/08/2026) : validé côté edge function invite-collaborateur (admin uniquement, subset de
  -- pole_ids) — filtré ici une seconde fois par prudence (pôle inexistant ou hors pole_ids).
  v_responsable_ids := null;
  if jsonb_typeof(p_meta->'responsable_pole_ids') = 'array' then
    begin
      select array_agg((elem)::uuid) into v_responsable_ids
        from jsonb_array_elements_text(p_meta->'responsable_pole_ids') as elem
        where elem is not null and elem <> '' and (elem)::uuid = any (v_pole_ids);
    exception when others then
      v_responsable_ids := null;
    end;
  end if;

  foreach v_id in array v_pole_ids loop
    insert into public.pole_affectations (pole_id, user_id, role_pole)
    values (v_id, p_user_id, case when v_id = any (coalesce(v_responsable_ids, array[]::uuid[])) then 'responsable' else 'membre' end)
    on conflict (pole_id, user_id) do nothing;
  end loop;
end;
$function$;

-- ROLLBACK : restaurer ensure_default_pole_affectation() sans responsable_pole_ids (voir
-- migration-poles-v14-separation-collaborateurs.sql pour le corps exact pré-v26).
