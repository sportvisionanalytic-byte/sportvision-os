-- Migration : accès kits pour les photographes/vidéastes
-- À exécuter dans Supabase → SQL Editor
-- Permet aux collaborateurs de voir les kits réservés pour leurs prestations

-- Nouvelle policy SELECT : un collaborateur peut voir les kit_reservations
-- des prestations auxquelles il est assigné (via prestations_equipe)
create policy "kit_resa_via_equipe" on kit_reservations
  for select using (
    exists (
      select 1 from prestations_equipe
      where prestation_id = kit_reservations.prestation_id
        and collaborateur_id = auth.uid()
    )
  );

-- Note : la policy "kit_resa_acces" existante couvre déjà le cas
-- where collaborateur_id = auth.uid() (kit attribué directement à la personne).
-- Cette nouvelle policy ajoute la visibilité via appartenance à l'équipe.
