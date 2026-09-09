-- ═══════════════════════════════════════════════════════════════════════════════
-- Derniere exposition inter-clubs mesurable : les droits de modules
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Apres la fermeture des surfaces sensibles, ce qu'un CM cloisonne lit encore est de l'outillage
-- qui sert son travail : modeles Studio, modeles de communication, centre de ressources,
-- catalogue de formation, produits media. On les laisse.
--
-- Une exception mesuree : organization_entitlements exposait les 84 lignes de TOUTES les
-- organisations — donc quels modules chaque club de SportVision possede. Ce n'est pas une donnee
-- personnelle, mais ce n'est pas son perimetre non plus.
--
-- La session Club+ en a besoin pour SES clubs : c'est ce qui deverrouille ses modules. On borne,
-- on ne ferme pas.

begin;

drop policy if exists cm_hors_perimetre_organization_entitlements on organization_entitlements;
create policy cm_hors_perimetre_organization_entitlements on organization_entitlements
  as restrictive for all to authenticated
  using (not est_cm_cloisonne() or organization_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or organization_id in (select cm_clubs_autorises()));

-- reseaux_sociaux_comptes : verifie, ce sont les comptes de SPORTVISION par pole, pas ceux des
-- clubs (colonne pole_id, aucun client_id). Rien a cloisonner la, c'est de l'outillage interne.

commit;

select 'OK' as verdict;
