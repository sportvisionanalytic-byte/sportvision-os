-- ============================================================================
-- migration-audit-25-08-corrections-batch1.sql
-- ============================================================================
-- Corrections issues de l'audit complet du 25/08/2026 (6 agents, tests réels).
-- Regroupe les correctifs base de données qui ne touchent pas d'edge function.
-- ============================================================================

-- ── 1. Délégation CM : club_member_has_client_access() ne reconnaissait pas
-- cm_agency_club_access / cm_super_access, contrairement à is_club_member()
-- déjà étendue. Corrige d'un coup l'accès aux "contenus" (contenus_client_
-- select l'utilise déjà) et à client_cm (idem) pour un CM délégué.
create or replace function club_member_has_client_access(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from club_members cm
    join clubs c on c.id = cm.club_id
    where cm.user_id = auth.uid()
      and cm.status = 'actif'
      and c.portail_client_id = target_client_id
  )
  or exists (
    select 1
    from clubs c
    join cm_agency_club_access caa on caa.club_id = c.id
    join memberships m on m.organization_id = caa.cm_agency_org_id
    where c.portail_client_id = target_client_id
      and m.user_id = auth.uid()
      and m.status = 'actif'
      and (caa.expires_at is null or caa.expires_at >= current_date)
  )
  or (
    exists (
      select 1 from memberships m
      join organizations o on o.id = m.organization_id
      where m.user_id = auth.uid() and m.status = 'actif' and m.cm_super_access = true
        and o.organization_type = 'cm_agency'
    )
    and exists (select 1 from clubs c where c.portail_client_id = target_client_id)
  );
$$;

-- ── 2. messages_client : le contrôle "membre de club" était une jointure
-- brute dupliquée (jamais mise à jour pour la délégation), au lieu de
-- réutiliser club_member_has_client_access() comme le reste du projet.
-- Remplace la sous-requête club_members par un appel à la fonction
-- (maintenant étendue ci-dessus) — corrige la délégation ET supprime la
-- duplication de logique en un seul geste.
drop policy if exists "mc_client_select" on messages_client;
create policy "mc_client_select" on messages_client for select
using (
  (exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id))
  or club_member_has_client_access(client_id)
  or player_has_client_access(client_id)
  or (connect_owner_client_id(auth.uid()) = client_id)
  or (exists (
    select 1 from connect_access_relationships car
    where car.grantee_user_id = auth.uid() and car.status = 'acceptee' and car.right_voir
      and connect_owner_client_id(car.owner_user_id) = messages_client.client_id
  ))
  or (exists (select 1 from managed_athlete_profiles map where map.owner_user_id = auth.uid() and map.client_id = messages_client.client_id))
);

drop policy if exists "mc_client_insert" on messages_client;
create policy "mc_client_insert" on messages_client for insert
with check (
  auteur_type = 'client'
  and (auteur_client_id = auth.uid() or auteur_client_id is null)
  and (
    (exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = messages_client.client_id))
    or club_member_has_client_access(client_id)
    or player_has_client_access(client_id)
    or (connect_owner_client_id(auth.uid()) = client_id)
    or (exists (
      select 1 from connect_access_relationships car
      where car.grantee_user_id = auth.uid() and car.status = 'acceptee' and car.right_voir
        and connect_owner_client_id(car.owner_user_id) = messages_client.client_id
    ))
    or (exists (select 1 from managed_athlete_profiles map where map.owner_user_id = auth.uid() and map.client_id = messages_client.client_id))
  )
);

-- ── 3. v_rentabilite_missions : lisible par n'importe quel authenticated
-- (ex. un joueur via player_has_client_access sur `prestations`), affichant
-- une marge nette faussée à la hausse (coûts internes filtrés à 0 par la RLS
-- des tables sous-jacentes, jamais exposés, mais le calcul reste trompeur).
-- Filtre explicite is_staff() plutôt qu'une dépendance implicite fragile sur
-- la RLS de 5 tables différentes.
create or replace view v_rentabilite_missions as
select
  p.id as prestation_id,
  p.reference,
  p.type_prestation,
  p.client_id,
  c.nom as client_nom,
  p.date_prestation,
  p.statut_financier,
  coalesce(p.montant_ht, 0::numeric) as revenu_ht,
  coalesce(re.total_remunerations, 0::numeric) as cout_remunerations,
  coalesce(fr.total_frais, 0::numeric) as cout_frais,
  coalesce(de.total_depenses, 0::numeric) as cout_depenses_directes,
  (coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'forfait_par_mission' limit 1), 0::numeric)
    + (coalesce(p.montant_ht, 0::numeric) * coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'pourcentage_ca' limit 1), 0::numeric) / 100.0)
  ) as cout_indirect_alloue,
  ((((coalesce(p.montant_ht, 0::numeric) - coalesce(re.total_remunerations, 0::numeric)) - coalesce(fr.total_frais, 0::numeric)) - coalesce(de.total_depenses, 0::numeric))
    - (coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'forfait_par_mission' limit 1), 0::numeric)
      + (coalesce(p.montant_ht, 0::numeric) * coalesce((select cost_allocations.valeur from cost_allocations where cost_allocations.actif = true and cost_allocations.methode = 'pourcentage_ca' limit 1), 0::numeric) / 100.0))
  ) as marge_nette
from prestations p
  left join clients c on c.id = p.client_id
  left join (
    select prestation_id, sum(remuneration) as total_remunerations
    from prestations_equipe where statut = 'acceptée' group by prestation_id
  ) re on re.prestation_id = p.id
  left join (
    select prestation_id, sum(montant) as total_frais
    from frais where statut = any (array['validé','remboursé']) group by prestation_id
  ) fr on fr.prestation_id = p.id
  left join (
    select prestation_id, sum(montant_ht) as total_depenses
    from expenses where statut = any (array['engagee','payee','comptabilisee']) group by prestation_id
  ) de on de.prestation_id = p.id
where p.statut <> all (array['annulée','refusée']::statut_prestation[])
  and is_staff();

-- ── 4. Hygiène des grants (même geste que migration-securite-v101, deux vues
-- oubliées à l'époque) : ces droits d'écriture sont inertes aujourd'hui (vues
-- à jointure, Postgres refuse nativement toute mutation) mais ne doivent pas
-- rester "GRANT ALL" visibles sur des vues sensibles.
revoke insert, update, delete, truncate on client_cm from authenticated, anon;
revoke insert, update, delete, truncate on client_media_livrables from authenticated, anon;

-- ── 5. Rate limiting atomique — le motif COUNT puis INSERT séparés (répété
-- dans ~20 edge functions) laisse une fenêtre de course entre deux appels
-- concurrents. Fonction atomique via verrou transactionnel scopé à
-- l'identifiant, à appeler à la place du COUNT+INSERT manuel.
create or replace function check_and_record_rate_limit(p_identifiant text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_identifiant, 0));
  select count(*) into v_count from guest_rate_limits
    where identifiant = p_identifiant and created_at >= now() - (p_window_seconds || ' seconds')::interval;
  if v_count >= p_max then
    return false;
  end if;
  insert into guest_rate_limits (identifiant) values (p_identifiant);
  return true;
end;
$$;

-- ── 6. Colonne clients.club_plus_actif : jamais lue nulle part dans l'OS
-- (vérifié par grep exhaustif), jamais synchronisée non plus (affichait
-- "non actif" pour V340 SC qui l'est réellement) — code mort trompeur,
-- supprimée plutôt que rafistolée. Aucune vue/trigger n'en dépend (vérifié).
alter table clients drop column if exists club_plus_actif;
alter table clients drop column if exists club_plus_plan;
