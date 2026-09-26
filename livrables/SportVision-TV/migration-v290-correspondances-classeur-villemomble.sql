-- v290 — 26/09/2026 : ce que le classeur de Villemomble appelle ses équipes
--
-- L'import du classeur laissait 20 lignes sans équipe. Fouka en a tranché une : « c'est pas U14 D1
-- mais D2 ». La base lui donne raison, et de façon vérifiable — l'équipe nommée « U14 D1 » ne joue
-- dans AUCUN championnat de ce nom :
--
--     U15 D1  22 matchs        U14 D2  18 matchs
--
-- Elle est engagée dans deux championnats, ce qui est courant, et portait un nom qui ne
-- correspondait ni à l'un ni à l'autre. Renommée en U14 D2.
--
-- LES DEUX CORRESPONDANCES DÉDUITES, ET LEURS PREUVES
--
--   « U15 D1 » -> U14 D2   parce que c'est cette équipe, et elle seule, qui joue ce championnat.
--                          « U15 F » joue « U15F D1 », ce n'est pas le même.
--   « U14 B »  -> U14 D4   deux signaux indépendants : un match déjà rattaché à U14 D4 porte le
--                          libellé « U14B », et la fédération numérote U14 1 / 2 / 3 dans l'ordre
--                          A / B / C, or U14 D4 est « U14 2 ».
--
-- CE QUI N'EST PAS DÉDUIT, ET NE LE SERA PAS PAR MOI
--
--   « Séniors D3 »  le club a D1, D2, R2, Féminines, Anciens D1 et Super Vétérans. Pas de D3.
--                   C'est soit une équipe nouvelle, soit une faute de frappe. Deviner reviendrait
--                   à envoyer les photos d'une équipe aux familles d'une autre.
--   « U14 », « U16 », « U6/U7 », « U8 - U9 »  designent plusieurs équipes à la fois. Un plateau
--                   « U6/U7 » est même DEUX matchs sur une ligne : aucun rapprochement automatique
--                   ne peut faire ça honnêtement.
--
-- Idempotent.

insert into club_team_source_mappings
  (club_id, saison_id, team_id, provider, external_team_id, external_team_name, confidence, status,
   confirmed_at)
select c.id, s.id, t.id, 'FOOTCLUBS_XLSX', v.libelle, v.libelle, 1.0, 'confirmed', now()
  from (values ('U15 D1', 'U14 D2'), ('U14 B', 'U14 D4')) as v(libelle, equipe)
  join clubs c on c.nom = 'SF Villemomble'
  join club_teams t on t.club_id = c.id and t.name = v.equipe and coalesce(t.archivee,false) = false
  join saisons s on current_date between s.date_debut and s.date_fin
 where not exists (
   select 1 from club_team_source_mappings m
    where m.club_id = c.id and m.provider = 'FOOTCLUBS_XLSX' and m.external_team_id = v.libelle);
