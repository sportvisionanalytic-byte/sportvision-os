-- Migration : scope portefeuille sur les briefs de production CM.
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- "Briefs de production" n'a pas besoin d'une nouvelle table : prestations
-- porte déjà description_besoin/livrables_demandes/briefing_vu_at, consommés
-- tels quels par loadProdBriefings() côté Responsable Production, avec tout
-- le pipeline média/postproduction/livraison déjà construit derrière
-- (media_liens, media_postproductions, media_livrables). Une prestation
-- type_prestation='réseaux_sociaux' créée par un CM apparaît automatiquement
-- dans l'écran Briefings existant, sans rien à construire côté prod.
--
-- Découverte en marge : la policy prestations_acces (supabase-schema-v2.sql)
-- autorise déjà 'cm' à créer/voir des prestations type_prestation=
-- 'réseaux_sociaux', mais SANS AUCUN scoping par portefeuille — un CM
-- Junior pouvait déjà créer ou lire une prestation réseaux_sociaux pour
-- n'importe quel client de l'entreprise, contournant tout le travail des
-- migrations précédentes. Corrigé ici en réutilisant une fois de plus
-- contenus_visible_par_cm() (aucune logique dupliquée).
--
-- À exécuter APRÈS migration-client-affiliations.sql (dépend de
-- contenus_visible_par_cm()).
--
-- Idempotente : DROP ... IF EXISTS avant CREATE.

drop policy if exists "prestations_acces" on prestations;
create policy "prestations_acces" on prestations for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod','compta'))
  or exists (select 1 from prestations_equipe where prestation_id = prestations.id and collaborateur_id = auth.uid())
  or (
    type_prestation = 'réseaux_sociaux'
    and exists (
      select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and (
        p.niveau_cm = 'cm_lead' or contenus_visible_par_cm(prestations.client_id, auth.uid())
      )
    )
  )
);
