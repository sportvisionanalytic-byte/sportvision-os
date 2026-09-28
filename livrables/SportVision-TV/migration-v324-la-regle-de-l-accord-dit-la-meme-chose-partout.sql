-- v324 — 28/09/2026 : la policy de l'accord et la fonction ne disaient pas la même chose
--
-- LA FONCTION `donner_consentement_biometrie` connaît trois titres pour donner l'accord :
--   joueur_majeur   le sportif, majeur
--   joueur_15_17    le sportif de 15 à 17 ans, qui consent SEUL — seuil du RGPD et de la loi
--                   Informatique et Libertés, repris tel quel
--   parent          le parent dont le lien est confirmé
-- et elle refuse explicitement avant 15 ans, en renvoyant vers le parent.
--
-- LA POLICY `cb_donner`, elle, n'acceptait que le parent confirmé ou le sportif MAJEUR. Le titre
-- `joueur_15_17` existait dans la contrainte de la colonne, la fonction savait le poser, et la
-- policy l'aurait refusé.
--
-- AUCUN UTILISATEUR N'EN A SOUFFERT, et c'est précisément ce qui rend le défaut sournois : la
-- fonction est SECURITY DEFINER, donc elle passe au-dessus de la policy. Les deux règles se
-- contredisaient sans conséquence visible, en attendant la première écriture qui ne passerait pas
-- par la fonction — un script, un correctif, un futur écran. Ce jour-là, un ado de 16 ans se
-- verrait refuser un accord que le produit lui accorde.
--
-- C'est la cinquième fois aujourd'hui qu'une même règle écrite à deux endroits finit par diverger.
-- On aligne la policy sur la fonction, qui fait foi : c'est elle qui porte la décision et la trace
-- du titre invoqué.
--
-- CE QUI NE CHANGE PAS : avant 15 ans, il faut le parent. Le seuil n'est pas déplacé d'un jour.
--
-- Idempotent.

drop policy if exists cb_donner on public.consentements_biometrie;

create policy cb_donner on public.consentements_biometrie
for insert to authenticated
with check (
  donne_par = auth.uid()
  and statut = 'accorde'
  and (
    -- Le parent dont le lien est confirmé par le club.
    public.is_confirmed_parent_of(player_id)
    -- Ou le sportif lui-même, a partir de 15 ans. `joueur_15_ans_ou_plus` couvre aussi la
    -- majorite : inutile de tester les deux, et deux tests seraient deux choses a maintenir.
    or (
      exists (select 1 from player_profiles p where p.id = player_id and p.user_id = auth.uid())
      and public.joueur_15_ans_ou_plus(player_id)
    )
  )
);
