-- Le parcours de communication : une demande du club devient un contenu, au même endroit.
--
-- Demande de Fouka, 10/09/2026 (priorité 3) : « Demande du club → Brief → Production →
-- Validation éventuelle → Programmation → Publié. Le CM ne doit pas gérer ce workflow dans
-- plusieurs endroits différents. Demande : "Affiche tournoi U12" → Transformer en contenu, puis le
-- contenu apparaît automatiquement dans le centre communication. »
--
-- La donnée existait : `contenus.request_id` pointe déjà vers `club_requests`, et le Centre
-- communication lit `contenus`. Il manquait le geste qui relie les deux, et la lecture qui dit, pour
-- chaque demande, où en est son contenu. Rien de l'OS n'est construit ici.
--
--   • transformer_demande_en_contenu(demande, titre, date prévue, plateforme) : crée le contenu en
--     brouillon, relié à la demande, et passe la demande « en traitement ». Idempotent : une demande
--     déjà transformée rend son contenu existant, jamais un second.
--   • club_demandes_contenus(club) : pour chaque demande, son contenu et le statut de celui-ci.
--   • club_contenus_calendrier(club, du, au) : les publications prévues, pour le filtre
--     « Communication » du calendrier.
--
-- Accès : qui opère le club (`peut_operer_club`).

begin;

create or replace function public.transformer_demande_en_contenu(
  p_request_id uuid, p_titre text default null, p_date_prevue date default null, p_plateforme text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_req club_requests;
  v_client uuid;
  v_cm uuid;
  v_id uuid;
  v_titre text;
begin
  select * into v_req from club_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'Demande introuvable.';
  end if;
  if not peut_operer_club(v_req.club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if v_req.status = 'refusee' then
    raise exception 'Cette demande a été refusée : elle ne devient pas un contenu.';
  end if;

  select id into v_id from contenus
   where request_id = p_request_id and statut <> 'archive'
   order by created_at limit 1;
  if v_id is not null then
    return v_id;   -- déjà transformée : on rend le contenu existant, jamais un doublon
  end if;

  select c.portail_client_id, cl.cm_id into v_client, v_cm
    from clubs c left join clients cl on cl.id = c.portail_client_id
   where c.id = v_req.club_id;
  if v_client is null then
    raise exception 'Ce club n''est pas encore relié à sa fiche SportVision : aucun contenu ne peut lui être rattaché.';
  end if;
  -- Le contenu appartient à un CM (`cm_id` obligatoire) : celui qui transforme s'il est de
  -- l'équipe SportVision, sinon le CM référent du club.
  if exists (select 1 from profiles where id = auth.uid() and role in ('cm', 'com', 'admin')) then
    v_cm := auth.uid();
  end if;
  if v_cm is null then
    raise exception 'Aucun Community Manager n''est rattaché à ce club pour porter ce contenu.';
  end if;

  v_titre := coalesce(nullif(btrim(p_titre), ''),
                      initcap(replace(coalesce(v_req.type, 'Contenu'), '_', ' '))
                      || coalesce(' — ' || nullif(v_req.team, ''), ''));

  insert into contenus (client_id, cm_id, titre, description, statut, request_id, date_prevue, plateforme)
  values (v_client, v_cm, v_titre, v_req.detail, 'brouillon', p_request_id, p_date_prevue, nullif(btrim(p_plateforme), ''))
  returning id into v_id;

  update club_requests
     set status = case when status in ('recues', 'info_manquante') then 'en_traitement' else status end,
         taken_by = coalesce(taken_by, auth.uid()),
         updated_at = now()
   where id = p_request_id;

  return v_id;
end;
$$;

revoke execute on function public.transformer_demande_en_contenu(uuid, text, date, text) from public, anon;
grant execute on function public.transformer_demande_en_contenu(uuid, text, date, text) to authenticated;

create or replace function public.club_demandes_contenus(p_club_id uuid)
returns table (request_id uuid, contenu_id uuid, titre text, statut text, date_prevue date, date_publication date)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select c.request_id, c.id, c.titre, c.statut, c.date_prevue, c.date_publication::date
    from contenus c
    join club_requests r on r.id = c.request_id
   where r.club_id = p_club_id and c.statut <> 'archive';
end;
$$;

revoke execute on function public.club_demandes_contenus(uuid) from public, anon;
grant execute on function public.club_demandes_contenus(uuid) to authenticated;

create or replace function public.club_contenus_calendrier(p_club_id uuid, p_du date, p_au date)
returns table (id uuid, titre text, date_prevue date, statut text, plateforme text, equipe text, request_id uuid)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_client uuid;
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select cl.portail_client_id into v_client from clubs cl where cl.id = p_club_id;
  return query
  select c.id, c.titre, c.date_prevue, c.statut, c.plateforme,
         coalesce((select m.team from club_matches m where m.id = c.match_id),
                  (select e.team from club_calendar_events e where e.id = c.calendar_event_id),
                  (select r.team from club_requests r where r.id = c.request_id)),
         c.request_id
    from contenus c
   where v_client is not null and c.client_id = v_client
     and c.date_prevue between p_du and p_au
     and c.statut <> 'archive';
end;
$$;

revoke execute on function public.club_contenus_calendrier(uuid, date, date) from public, anon;
grant execute on function public.club_contenus_calendrier(uuid, date, date) to authenticated;

commit;
