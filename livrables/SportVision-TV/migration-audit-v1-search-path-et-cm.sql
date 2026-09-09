-- ═══════════════════════════════════════════════════════════════════════════════
-- AUDIT — deux defauts sur staff_update_club_request_status()
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- 1. SEULE fonction SECURITY DEFINER du schema sans search_path fige. C'est le motif classique
--    d'escalade de privileges : la fonction s'execute avec les droits de son proprietaire, et un
--    appelant qui manipule son search_path peut lui faire resoudre une table ou une fonction vers
--    un objet a lui. Aucune exploitation constatee ; on ferme la porte.
--
-- 2. Un CM AFFILIE ne peut pas prendre en charge une demande de son club. L'autorisation passe par
--    contenus_visible_par_cm(), qui ne connait que l'ancien modele (client_affiliations,
--    clients.cm_id, niveau_cm). C'est le meme angle mort que celui trouve sur les presences : on
--    ajoute le chemin cm_clubs_autorises() sans rien retirer.
--
-- Le reste du corps est repris a l'identique.

create or replace function public.staff_update_club_request_status(p_request_id uuid, p_status text)
returns club_requests
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row club_requests;
  v_old_status text;
  v_credits integer;
  v_authorized boolean;
begin
  select * into v_row from club_requests where id = p_request_id;
  if v_row.id is null then
    raise exception 'Demande introuvable.';
  end if;

  select exists(
    select 1 from clubs c
    where c.id = v_row.club_id and (
      exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      or (c.portail_client_id is not null and exists (
        select 1 from profiles p where p.id = auth.uid() and p.role = 'cm'
          and (p.niveau_cm = 'cm_lead' or contenus_visible_par_cm(c.portail_client_id, auth.uid()))
      ))
      -- Le CM affilie a ce club, modele actuel. Sans cette ligne, « Prendre en charge » lui est
      -- refuse sur ses propres clubs.
      or c.id in (select cm_clubs_autorises())
      or v_row.taken_by = auth.uid()
    )
  ) into v_authorized;
  if not v_authorized then
    raise exception 'Accès refusé.';
  end if;

  v_old_status := v_row.status;
  v_credits := coalesce(v_row.credits_reserved, 0);

  update club_requests set
    status = p_status,
    credits_reserved = case when p_status in ('terminee','refusee') then 0 else credits_reserved end
    where id = p_request_id
    returning * into v_row;

  if v_credits > 0 and p_status = 'terminee' and v_old_status <> 'terminee' then
    update clubs set
      credits_balance = greatest(0, credits_balance - v_credits),
      credits_reserved = greatest(0, credits_reserved - v_credits)
      where id = v_row.club_id;
    insert into club_credit_transactions (club_id, label, amount, created_by)
      values (v_row.club_id, coalesce(v_row.type,'Demande') || coalesce(' — ' || v_row.team, ''), -v_credits, auth.uid());
  elsif v_credits > 0 and p_status = 'refusee' and v_old_status <> 'refusee' then
    update clubs set credits_reserved = greatest(0, credits_reserved - v_credits) where id = v_row.club_id;
  end if;

  return v_row;
end $function$;

select 'OK — search_path fige et CM affilie autorise' as verdict;
