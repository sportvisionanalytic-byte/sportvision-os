-- Aligner qui peut affecter un CM sur la regle qui existait DEJA.
--
-- protect_client_cm_assignment(), en place avant ce chantier, autorise l'administrateur ET le
-- Responsable CM (niveau_cm = 'cm_lead' ou cm_niveau_autonomie = 'responsable') a changer
-- l'affectation d'un client. En posant la RLS de club_cm_affectations sur admin et com
-- uniquement, la phase 1 a retire ce droit au Responsable CM sans que personne ne l'ait demande.
--
-- C'est une regression introduite par moi. On restaure la regle d'origine, en y ajoutant `com`
-- qui pilote la relation client. Un CM ordinaire reste exclu : il ne s'affecte pas lui-meme.

begin;

drop policy if exists cca_direction_all on club_cm_affectations;
create policy cca_direction_all on club_cm_affectations for all
  using (exists (
    select 1 from profiles p where p.id = auth.uid()
      and (p.role in ('admin','com')
           or (p.role = 'cm' and (p.niveau_cm = 'cm_lead' or p.cm_niveau_autonomie = 'responsable')))
  ))
  with check (exists (
    select 1 from profiles p where p.id = auth.uid()
      and (p.role in ('admin','com')
           or (p.role = 'cm' and (p.niveau_cm = 'cm_lead' or p.cm_niveau_autonomie = 'responsable')))
  ));

comment on policy cca_direction_all on club_cm_affectations is
  'Qui affecte un CM a un club : administrateur, communication, et Responsable CM — exactement la regle que protect_client_cm_assignment() applique deja sur clients.cm_id. Un CM ordinaire ne s''affecte jamais lui-meme.';

commit;
