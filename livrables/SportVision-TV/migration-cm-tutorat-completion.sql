-- CM Junior→Tuteur, complément (04/09/2026, audit transversal) — découverte majeure en creusant
-- la décision produit de Fouka : le système existe DÉJÀ intégralement en production (table
-- cm_tutorships, profiles.cm_niveau_autonomie, triggers contenus_valider_transition_statut +
-- protect_junior_content_publication, RLS contenus_tuteur_select/update — voir migration-audit-
-- final-schema-reconciliation.sql du 29/08). Les 2 audits lancés ce soir ne l'avaient pas trouvé
-- car ils cherchaient des noms de colonnes plausibles (valide_par_tuteur, cm_tutor_id) plutôt que
-- les vrais objets — leçon déjà notée plusieurs fois cette session : chercher aussi par nom de
-- table/trigger/fonction, jamais seulement par colonne. Ne PAS reconstruire ce système. Deux
-- vrais trous trouvés en le vérifiant en conditions réelles :

-- FIX 1 — contenus_client_select excluait 'brouillon'/'a_valider_interne' mais pas
-- 'a_valider_tuteur'/'pret' (ajoutés après coup par la migration du 29/08, jamais reportés dans
-- cette policy) : un client Full Communication pouvait voir un brouillon junior encore en attente
-- de relecture interne — exactement ce que Fouka demande d'empêcher ("Le club voit uniquement un
-- état simplifié. Il ne voit pas 'en attente du tuteur Jean'. Le processus est interne SportVision.")
drop policy if exists "contenus_client_select" on contenus;
create policy "contenus_client_select" on contenus for select using (
  (statut <> all (array['brouillon', 'a_valider_interne', 'a_valider_tuteur', 'pret']))
  and (
    (exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = contenus.client_id))
    or club_member_has_client_access(client_id)
    or (exists (select 1 from organizations o where o.legacy_client_id = contenus.client_id and o.organization_type = 'event' and is_org_member(o.id)))
  )
);

-- FIX 2 — cm_tutorships_write autorisait n'importe quel membre staff (is_staff() : admin/sec/prod/
-- photo/cm/compta/com/rh) à créer/modifier une affectation tuteur, alors que Fouka demande
-- explicitement "Admin SportVision ou Responsable CM" uniquement — un CM Junior aurait pu, par
-- exemple, réassigner son propre tuteur.
drop policy if exists "cm_tutorships_write" on cm_tutorships;
create policy "cm_tutorships_write" on cm_tutorships for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and (p.role = 'admin' or (p.role = 'cm' and p.cm_niveau_autonomie = 'responsable')))
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and (p.role = 'admin' or (p.role = 'cm' and p.cm_niveau_autonomie = 'responsable')))
);
