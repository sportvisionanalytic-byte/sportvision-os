-- ============================================================================
-- migration-poles-v29-materiel-responsable-restriction.sql
-- Corrige un déséquilibre trouvé en audit : migration-poles-v23 avait donné
-- à un Responsable un accès FOR ALL sur kits/materiels (DELETE inclus,
-- aucune colonne protégée), alors que Fouka veut l'inverse — gestion
-- complète du quotidien (créer, modifier nom/localisation/statut/notes,
-- réserver) mais AUCUN pouvoir de suppression, de modification de la valeur
-- comptable, ni de réaffectation définitive entre pôles (pole_id/
-- pole_exclusif) : ça reste Direction (admin).
--
-- Remplace le FOR ALL par SELECT + INSERT + UPDATE (jamais DELETE — seules
-- kits_write/materiels_write, déjà admin/prod/(sec|compta), gardent ce
-- droit) et ajoute un trigger BEFORE UPDATE qui bloque toute tentative de
-- changer valeur/valeur_totale/pole_id/pole_exclusif pour qui n'est pas
-- admin -- protection réelle, pas seulement des champs masqués côté UI (qui
-- reste la première ligne de défense, cf. commentaire dans le HTML).
-- ============================================================================

drop policy if exists kits_responsable_pole_all on public.kits;
create policy kits_responsable_pole_select on public.kits
  for select
  using (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()));
create policy kits_responsable_pole_insert on public.kits
  for insert
  with check (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()));
create policy kits_responsable_pole_update on public.kits
  for update
  using (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()))
  with check (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()));

drop policy if exists materiels_responsable_pole_all on public.materiels;
create policy materiels_responsable_pole_select on public.materiels
  for select
  using (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()));
create policy materiels_responsable_pole_insert on public.materiels
  for insert
  with check (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()));
create policy materiels_responsable_pole_update on public.materiels
  for update
  using (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()))
  with check (is_pole_responsable(pole_id) or (pole_id is null and is_any_pole_responsable()));

create or replace function public.protect_kit_materiel_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_admin boolean;
begin
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin') into v_is_admin;
  if v_is_admin then
    return new;
  end if;
  if new.pole_id is distinct from old.pole_id then
    raise exception 'Seul un administrateur peut réaffecter ce matériel à un autre pôle.';
  end if;
  if new.pole_exclusif is distinct from old.pole_exclusif then
    raise exception 'Seul un administrateur peut modifier le statut Commun/Dédié/Priorité de ce matériel.';
  end if;
  if new.valeur is distinct from old.valeur then
    raise exception 'Seul un administrateur peut modifier la valeur comptable de ce matériel.';
  end if;
  if TG_TABLE_NAME = 'kits' and new.valeur_totale is distinct from old.valeur_totale then
    raise exception 'Seul un administrateur peut modifier la valeur comptable de ce kit.';
  end if;
  return new;
end;
$function$;

comment on function public.protect_kit_materiel_sensitive_fields() is 'Bloque toute modification de pole_id/pole_exclusif/valeur(_totale) sur kits/materiels pour qui n''est pas admin -- protection réelle en complément des champs masqués côté UI pour un Responsable de pôle (migration-poles-v29).';

drop trigger if exists trg_protect_kits_sensitive on public.kits;
create trigger trg_protect_kits_sensitive
  before update on public.kits
  for each row execute function public.protect_kit_materiel_sensitive_fields();

drop trigger if exists trg_protect_materiels_sensitive on public.materiels;
create trigger trg_protect_materiels_sensitive
  before update on public.materiels
  for each row execute function public.protect_kit_materiel_sensitive_fields();

-- ============================================================================
-- ROLLBACK (documenté, non exécuté) :
--   drop trigger trg_protect_kits_sensitive on public.kits;
--   drop trigger trg_protect_materiels_sensitive on public.materiels;
--   drop function public.protect_kit_materiel_sensitive_fields();
--   drop policy kits_responsable_pole_select/insert/update on public.kits;
--   drop policy materiels_responsable_pole_select/insert/update on public.materiels;
--   recréer kits_responsable_pole_all/materiels_responsable_pole_all FOR ALL
--   (voir migration-poles-v23-espace-responsable.sql pour le corps exact).
-- ============================================================================
