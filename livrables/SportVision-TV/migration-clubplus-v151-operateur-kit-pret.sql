-- v151 : l'opérateur peut dire « kit prêt » le matin du match (11/09/2026).
--
-- Trouvé en répétant la première mission réelle (SF Villemomble, 12/09/2026) : une mission
-- affectée reste « équipe affectée » tant que personne ne la passe « prête ». L'écran de parcours
-- propose à l'opérateur « ✓ Kit prêt, je peux partir » (équipe affectée → prête), mais
-- protect_prestation_operational_fields ne l'ouvrait pas au collaborateur : erreur à l'écran, et
-- le Mode Jour J n'affichait aucun bouton à ce statut. On ouvre ce seul passage, qui ne touche
-- ni au lieu, ni à l'horaire, ni au reste de la mission.
-- Test : tests/operateur-jour-j.test.sql

create or replace function public.protect_prestation_operational_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  is_privileged boolean;
  is_valid_transition boolean;
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Le regroupement de missions (v133) tient à jour horaire, équipes et description de la mission
  -- commune, au nom du CM qui ajoute un match. Le marqueur n'est posé que par
  -- rafraichir_mission_regroupee (interne, non exécutable depuis l'API) et ne vit que le temps de
  -- sa mise à jour.
  if current_setting('sv.ecriture_systeme', true) = 'regroupement_mission' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod','compta')
  ) into is_privileged;

  if is_privileged then
    return new;
  end if;

  if new.lieu is distinct from old.lieu
     or new.adresse_complete is distinct from old.adresse_complete
     or new.contact_sur_place is distinct from old.contact_sur_place
     or new.telephone_sur_place is distinct from old.telephone_sur_place
     or new.date_prestation is distinct from old.date_prestation
     or new.heure_debut is distinct from old.heure_debut
     or new.heure_fin is distinct from old.heure_fin
     or new.heure_rdv is distinct from old.heure_rdv
     or new.type_prestation is distinct from old.type_prestation
     or new.reference is distinct from old.reference
     or new.description_besoin is distinct from old.description_besoin
     or new.livrables_demandes is distinct from old.livrables_demandes
     or new.notes_internes is distinct from old.notes_internes
     or new.sport is distinct from old.sport
     or new.equipes is distinct from old.equipes
     or new.responsable_prod_id is distinct from old.responsable_prod_id
     or new.responsable_prestation_id is distinct from old.responsable_prestation_id
  then
    raise exception 'Modification non autorisée : le lieu, l''horaire et les informations de mission d''une prestation sont réservés au secrétariat/à la production.';
  end if;

  if new.statut is distinct from old.statut then
    is_valid_transition := (
      (old.statut = 'planifiée' and new.statut = 'équipe_affectée')
      or (old.statut = 'équipe_affectée' and new.statut = 'planifiée')
      or (old.statut = 'confirmée' and new.statut = 'équipe_en_route')
      or (old.statut = 'équipe_affectée' and new.statut = 'équipe_en_route')
      -- v151 : « ✓ Kit prêt, je peux partir », proposé à l'opérateur mais refusé jusqu'ici.
      or (old.statut = 'équipe_affectée' and new.statut = 'prête')
      or (old.statut = 'planifiée' and new.statut = 'équipe_en_route')
      or (old.statut = 'prête' and new.statut = 'équipe_en_route')
      or (old.statut = 'prête' and new.statut = 'production_démarrée')
      or (old.statut = 'équipe_en_route' and new.statut = 'arrivée_sur_place')
      or (old.statut = 'arrivée_sur_place' and new.statut = 'production_démarrée')
      or (old.statut = 'production_démarrée' and new.statut = 'production_terminée')
      or (old.statut = 'production_terminée' and new.statut = 'médias_à_transférer')
      or (old.statut = 'médias_à_transférer' and new.statut = 'médias_complets')
    );
    if not is_valid_transition then
      raise exception 'Modification non autorisée : ce changement de statut n''est pas ouvert au collaborateur affecté (réservé au secrétariat/à la production).';
    end if;
  end if;

  return new;
end;
$function$;
