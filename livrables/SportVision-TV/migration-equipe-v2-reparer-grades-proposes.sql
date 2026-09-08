-- Réparer les recommandations de grade laissées sans grade proposé.
--
-- Cause : _checkGradePromotion lisait calcGrade(xp).grade.id, mais les entrées de GRADES_DEF
-- n'ont pas de champ id (ils vivent dans SV_GRADES). grade_propose était donc toujours NULL, et
-- valider une de ces recommandations écrivait NULL dans profiles.grade — effaçant le grade de la
-- personne. Corrigé côté OS le 08/09 ; il reste à réparer les lignes déjà créées.
--
-- Ce script NE DÉCIDE RIEN. Il ne modifie aucun grade et ne valide ni ne refuse quoi que ce soit :
-- il recalcule seulement le grade que l'XP justifie, pour que Fouka puisse trancher depuis l'OS
-- avec la bonne information sous les yeux. Les seuils sont ceux de GRADES_DEF, à l'identique.

with rangs as (
  select r.id,
         case
           when p.xp >= 9000 then 5   -- Maître
           when p.xp >= 6500 then 4   -- Elite
           when p.xp >= 4000 then 3   -- Expert
           when p.xp >= 2000 then 2   -- Senior
           when p.xp >=  600 then 1   -- Confirmé
           else 0                     -- Débutant
         end as rang_merite
  from grade_recommendations r
  join profiles p on p.id = r.collaborateur_id
  where r.statut = 'en_attente' and r.grade_propose is null
)
update grade_recommendations g
   set grade_propose = rangs.rang_merite
  from rangs
 where g.id = rangs.id;

-- Ce que Fouka verra maintenant dans l'OS. Une ligne dont le grade proposé n'est pas supérieur
-- au grade actuel n'est pas une promotion : la recommandation n'aurait jamais dû être créée, et
-- l'écran le dira au lieu de proposer une validation qui ne changerait rien.
select p.prenom || ' ' || p.nom as personne,
       p.xp,
       r.grade_actuel,
       r.grade_propose,
       case when r.grade_propose > r.grade_actuel
            then 'promotion réelle'
            else 'aucune promotion — recommandation injustifiée' end as lecture
from grade_recommendations r
join profiles p on p.id = r.collaborateur_id
where r.statut = 'en_attente'
order by p.xp desc;
