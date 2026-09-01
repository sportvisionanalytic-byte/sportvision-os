-- ============================================================================
-- migration-poles-v24-fix-recursion-kit-reservations.sql
-- Corrige un piège de récursion RLS trouvé en testant migration-poles-v23 en
-- réel (INSERT sur kits -> "infinite recursion detected in policy for
-- relation kits", 42P17) : kits_select (policy déjà existante) fait une
-- sous-requête brute vers kit_reservations ; la nouvelle policy
-- kit_resa_responsable_pole_all (v23) faisait, elle, une sous-requête brute
-- vers kits -- exactement le cycle croisé entre deux tables déjà rencontré 3
-- fois cette nuit (Lot 3, prestations/prestations_equipe). Remplace la
-- sous-requête brute par un helper SECURITY DEFINER (bypass RLS), même
-- correctif que pour les cas précédents.
-- ============================================================================

create or replace function public.is_pole_responsable_of_kit(p_kit_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable())
  from kits where id = p_kit_id;
$function$;

comment on function public.is_pole_responsable_of_kit(uuid) is 'Vrai si le compte appelant est Responsable du pôle auquel appartient ce kit (ou Responsable de n''importe quel pôle si le kit est Commun) -- SECURITY DEFINER pour éviter la récursion RLS croisée kits<->kit_reservations (migration-poles-v24).';

drop policy if exists kit_resa_responsable_pole_all on public.kit_reservations;
create policy kit_resa_responsable_pole_all on public.kit_reservations
  for all
  using (is_pole_responsable_of_kit(kit_id))
  with check (is_pole_responsable_of_kit(kit_id));

-- ROLLBACK : drop policy kit_resa_responsable_pole_all on public.kit_reservations;
--            drop function public.is_pole_responsable_of_kit(uuid);
--            (puis recréer kit_resa_responsable_pole_all avec la sous-requête
--            brute de migration-poles-v23 si un rollback complet est voulu).
