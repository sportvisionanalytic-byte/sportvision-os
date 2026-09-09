-- ═══════════════════════════════════════════════════════════════════════════════
-- Etre le CM d'un client doit suffire a le voir
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Signale le 09/09/2026 : dans l'OS, la fiche d'un client n'affiche rien pour son propre CM — ni
-- les informations, ni le logo.
--
-- Cause mesuree : contenus_visible_par_cm() exige, pour la branche « je suis le CM de ce client »,
-- que le profil porte AUSSI un niveau_cm parmi trois valeurs. Le profil de Fouka a un niveau vide.
-- Resultat : clients.cm_id le designe bien comme CM du client, et il ne le voit pas.
--
-- C'est un contresens. L'affectation EST l'autorite : si `clients.cm_id` pointe sur vous, vous
-- etes le CM de ce client, quel que soit votre niveau. Le niveau sert a graduer l'autonomie sur
-- d'autres decisions, pas a decider si l'on voit son propre portefeuille.
--
-- On AJOUTE donc deux chemins sans rien retirer :
--   - etre designe par clients.cm_id, niveau ou pas ;
--   - accompagner le club de ce client via cm_clubs_autorises(), le modele actuel.
--
-- Ni l'un ni l'autre n'elargit au-dela du portefeuille : ils ne rendent visible que ce qui est
-- deja explicitement confie.

create or replace function public.contenus_visible_par_cm(p_client_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p_client_id is not null and (
    -- Responsable CM : vue globale, inchangee.
    exists (
      select 1 from profiles p
      where p.id = p_uid and p.role = 'cm' and p.cm_niveau_autonomie = 'responsable'
    )
    -- Affiliation explicite, modele historique, inchangee.
    or exists (
      select 1 from client_affiliations a, profiles p
      where a.client_id = p_client_id and a.user_id = p_uid and p.id = p_uid and p.role = 'cm'
        and a.role_on_client in ('cm_principal','cm_secondaire','cm_junior','lead_cm')
        and a.status = 'actif'
        and (a.end_date is null or a.end_date >= current_date)
    )
    -- NOUVEAU : designe comme CM de ce client. Sans condition de niveau.
    or exists (
      select 1 from clients cl, profiles p
      where cl.id = p_client_id and cl.cm_id = p_uid and p.id = p_uid and p.role = 'cm'
    )
    -- NOUVEAU : accompagne le club rattache a ce client (modele club_cm_affectations).
    or exists (
      select 1 from clubs c
      where c.portail_client_id = p_client_id
        and c.id in (select cm_clubs_autorises_de(p_uid))
    )
    -- Niveaux CM, modele historique, inchange.
    or exists (
      select 1 from profiles p, clients cl
      where p.id = p_uid and cl.id = p_client_id and p.role = 'cm' and (
        (p.niveau_cm in ('cm_junior','cm_confirme','cm_full_communication') and cl.cm_id = p_uid)
        or (p.niveau_cm = 'cm_club_plus_studio' and exists (
              select 1 from contrats c where c.client_id = cl.id
                and c.type_contrat = 'club_plus' and c.statut = 'actif'))
        or (p.niveau_cm = 'cm_evenement' and exists (
              select 1 from contrats c where c.client_id = cl.id
                and c.type_contrat = 'evenement' and c.statut = 'actif'))
      )
    )
  );
$function$;

select 'OK' as verdict;
