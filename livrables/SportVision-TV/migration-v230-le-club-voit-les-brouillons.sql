-- v230 — Le club voit aussi les brouillons de son planning éditorial.
--
-- DEMANDE DE FOUKA, 14/09/2026 : « je veux qu'il voie les brouillons du planning éditorial ».
--
-- La v229 (le matin même) avait ouvert au club les contenus « prêts ». Fouka va plus loin : le
-- planning est un outil partagé avec le club, pas une vitrine de ce qui est déjà fini. Un
-- président doit pouvoir voir qu'une publication est PRÉVUE pour samedi, même si elle n'est
-- encore qu'un titre posé dans la grille. C'est justement ce qui lui permet de dire « ajoutez
-- plutôt les féminines » avant que le travail soit fait, et non après.
--
-- CE QUE ÇA CHANGE POUR LE CM : ses brouillons sont désormais lus par le club. Un brouillon est
-- souvent un titre jeté, sans texte ni visuel. L'écran le dit — le statut « Brouillon » est
-- affiché tel quel côté Club+, aucun contenu n'est présenté comme abouti.
--
-- CE QUI RESTE FERMÉ, et c'est délibéré. Deux statuts ne sont pas du travail en cours mais des
-- relectures en cours :
--   · a_valider_interne — SportVision se relit avant de montrer. Un client n'a pas à lire la
--     version que son agence est justement en train de corriger.
--   · a_valider_tuteur — un CM Junior soumet son travail à son tuteur. Un débutant n'a pas à
--     être corrigé sous les yeux du club dont il s'occupe.
--
-- LECTURE SEULE, inchangé : aucun droit d'écriture n'est ouvert. Le club valide par
-- client_valider_contenu et par elle seule, il ne touche jamais `statut` à la main.
--
-- Idempotent : la policy est recréée à l'identique à un statut près.

drop policy if exists contenus_client_select on contenus;

create policy contenus_client_select on contenus
  for select
  using (
    statut <> all (array['a_valider_interne','a_valider_tuteur'])
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
  'Le club et le client lisent tout leur planning éditorial, brouillons compris (v230) : le planning est un outil partagé, pas une vitrine de ce qui est fini. Seules les relectures en cours restent chez SportVision — relecture interne et relecture du tuteur d''un CM Junior. Lecture seule : la validation passe par client_valider_contenu.';
