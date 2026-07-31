-- ============================================================
-- SPORTVISION PORTAIL — Migration v6
-- Page "Mon organisation" : lecture/édition des infos du club/structure du client,
-- et liste des membres de son organisation (comme le prévoit le handoff de design :
-- gestion multi-utilisateurs avancée réservée à Club+, ici juste infos + membres).
-- Idempotente. À exécuter après migration-portail-v5.sql.
-- ============================================================

-- Vue : infos de l'organisation, colonnes internes (statut, notes, score_priorite,
-- origine_prospect, created_by, club_plus_*) volontairement exclues.
drop view if exists client_organisation;
create view client_organisation as
select c.id, c.nom, c.type_client, c.ville, c.code_postal, c.adresse, c.sport, c.ligue, c.division
from clients c
where exists (
  select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = c.id
);

-- Vue : membres de la même organisation (chaque client_user ne voit normalement
-- que sa propre ligne dans client_users ; cette vue élargit à "même client_id").
drop view if exists client_organisation_members;
create view client_organisation_members as
select cu.id, cu.prenom, cu.nom, cu.client_id
from client_users cu
where cu.client_id = (select client_id from client_users where id = auth.uid());

-- Mise à jour des infos d'organisation : fonction dédiée, ne touche jamais
-- aux colonnes internes (statut, notes, score_priorite...).
create or replace function client_update_organisation(
  p_nom text, p_ville text, p_code_postal text, p_adresse text, p_sport text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select client_id into v_client_id from client_users where id = auth.uid();
  if v_client_id is null then
    raise exception 'Non autorisé';
  end if;

  update clients
  set nom = coalesce(nullif(trim(p_nom), ''), nom),
      ville = p_ville, code_postal = p_code_postal, adresse = p_adresse, sport = p_sport,
      updated_at = now()
  where id = v_client_id;
end;
$$;

revoke all on function client_update_organisation(text, text, text, text, text) from public;
grant execute on function client_update_organisation(text, text, text, text, text) to authenticated;
