-- v229 — Le club voit le planning éditorial que SportVision prépare pour lui.
--
-- DEMANDE DE FOUKA, 14/09/2026 : « il faut aussi bien que le président des clubs voie le planning
-- éditorial ».
--
-- LE DÉFAUT. Le Centre communication du CM (v141, 11/09) a introduit un statut `pret` : le contenu
-- est écrit, relu, daté, il ne reste qu'à le programmer. La policy de lecture côté club datait
-- d'avant ce flux : elle masquait `pret` exactement comme un brouillon. Résultat, un président
-- ouvrait « Planning éditorial » sur un écran vide pendant que le travail était fait. Au moment
-- d'écrire cette migration, les neuf contenus de SF Villemomble sont TOUS en `pret` : le planning
-- du club était donc vide à 100 %, pas partiellement.
--
-- Le même club voyait pourtant ces contenus dans son calendrier, par club_contenus_calendrier qui
-- ne filtre pas les statuts. Deux écrans du même produit, deux réponses différentes sur la même
-- donnée : c'est ce désaccord qu'on solde ici, dans le sens de ce que le club doit voir.
--
-- CE QUI NE CHANGE PAS. Le travail en cours reste chez SportVision : `brouillon` (idée jetée),
-- `a_valider_interne` (relecture SportVision) et `a_valider_tuteur` (relecture du tuteur d'un CM
-- Junior) ne se montrent toujours pas. Un club n'a pas à lire une phrase avant qu'elle soit
-- relue, et un Junior n'a pas à être corrigé sous les yeux de son client.
--
-- LECTURE SEULE, comme avant : aucun droit d'écriture n'est ouvert. Le club valide par
-- client_valider_contenu et par elle seule ; il ne touche jamais `statut` à la main.
--
-- Idempotent : la policy est recréée à l'identique à un statut près.

drop policy if exists contenus_client_select on contenus;

create policy contenus_client_select on contenus
  for select
  using (
    statut <> all (array['brouillon','a_valider_interne','a_valider_tuteur'])
    and (
      exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = contenus.client_id)
      or club_member_has_client_access(client_id)
      or exists (
        select 1 from organizations o
        where o.legacy_client_id = contenus.client_id
          and o.organization_type = 'event'
          and is_org_member(o.id)
      )
    )
  );

comment on policy contenus_client_select on contenus is
  'Le club et le client lisent leur planning éditorial dès qu''un contenu est prêt (v229). Le travail en cours de SportVision — brouillon, relecture interne, relecture de tuteur — reste invisible. Lecture seule : la validation passe par client_valider_contenu.';
