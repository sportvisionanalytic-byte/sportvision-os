-- v143 : un opérateur voit avec qui il travaille (11/09/2026).
--
-- Trouvé en préparant les premières missions réelles (SV-2026-0274, Villemomble, 13/09) : Mikael
-- et Antoine sont sur la même mission, mais chacun ne voit que lui-même. Depuis le masquage des
-- rémunérations (v88, puis v127/v129/v136), prestations_equipe_display ne rend à un opérateur que
-- sa propre ligne. C'était voulu pour l'argent, pas pour les noms : la carte « Équipe sur mes
-- missions à venir » de l'OS n'a donc jamais rien affiché.
--
-- On n'élargit PAS la vue : ses colonnes portent frais, heures déclarées, statut de paiement.
-- Une fonction dédiée rend uniquement qui, quel rôle, quelle heure de RDV. Aucune colonne
-- d'argent n'existe dans son résultat, la frontière des rémunérations (v129) ne bouge pas.
--
-- Qui voit quoi : un opérateur dont la proposition est partie (proposée ou acceptée) voit les
-- collègues de la même mission qui sont proposés ou acceptés. Pas les « à envoyer » (la
-- Production n'a pas encore validé), pas ceux qui ont refusé, rien sur une mission annulée.
-- Test : tests/coequipiers-mission.test.sql

create or replace function public.mes_coequipiers(p_prestation_ids uuid[])
returns table (
  prestation_id uuid, reference text, date_prestation date, type_prestation text,
  collaborateur_id uuid, prenom text, nom text, role text,
  statut text, heure_rdv time, fonction text, est_responsable boolean
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, p.reference, p.date_prestation, p.type_prestation,
         pe.collaborateur_id, pr.prenom, pr.nom, pr.role,
         pe.statut::text, pe.heure_rdv, pe.fonction, pe.est_responsable
    from prestations p
    join prestations_equipe moi
      on moi.prestation_id = p.id and moi.collaborateur_id = auth.uid()
     and moi.statut in ('invitation_envoyée', 'en_attente', 'acceptée')
    join prestations_equipe pe
      on pe.prestation_id = p.id and pe.collaborateur_id <> auth.uid()
     and pe.statut in ('invitation_envoyée', 'en_attente', 'acceptée')
    join profiles pr on pr.id = pe.collaborateur_id
   where p.id = any(p_prestation_ids)
     and p.statut not in ('annulée', 'refusée')
   order by p.date_prestation, pr.prenom;
$$;

revoke execute on function public.mes_coequipiers(uuid[]) from public, anon;
grant execute on function public.mes_coequipiers(uuid[]) to authenticated;
