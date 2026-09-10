-- La Production voit les collaborateurs de son pôle, pour pouvoir les affecter.
--
-- Première mission réelle, 10/09/2026 : christian (Responsable Production, pôle Football) ouvre
-- SV-2026-0268 et la liste « Opérateur » ne propose… que lui-même. L'OS filtre les candidats par
-- pôle en lisant `pole_affectations` ; or cette table ne montrait à un profil Production que SA
-- ligne (`pole_affectations_self_select`). Aucun photographe ne passait le filtre : depuis le
-- filtrage par pôle (migration-poles-v19, 31/08), personne en Production n'a pu affecter un
-- opérateur par l'OS — seul l'administrateur le pouvait. Aucun test ne passait par ce chemin avec
-- un vrai rôle Production.
--
-- Ici : la Production et le secrétariat — les deux rôles qui affectent (rpc_ajouter_membre_equipe)
-- — lisent les affectations des pôles auxquels ils appartiennent eux-mêmes. Rien de plus : ni les
-- autres pôles, ni l'écriture.

begin;

drop policy if exists pole_affectations_meme_pole_select on public.pole_affectations;
create policy pole_affectations_meme_pole_select on public.pole_affectations for select using (
  pole_id = any (get_my_pole_ids())
  and exists (select 1 from profiles where id = auth.uid() and role in ('prod', 'sec'))
);

commit;
