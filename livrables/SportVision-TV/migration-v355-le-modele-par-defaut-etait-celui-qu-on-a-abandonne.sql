-- v355 — LE MODÈLE PAR DÉFAUT ÉTAIT CELUI QU'ON A ABANDONNÉ (29/09/2026)
--
-- `reconnaissance_joueurs_prets(p_album_id, p_modele default 'face-api-1.7.15-ssd128')`.
--
-- Ce modèle a été abandonné le 28/09, quand on est passé à InsightFace : c'est la session où l'on a
-- découvert que les seuils 0,42 / 0,55 étaient euclidiens alors que pgvector `<=>` rend le cosinus,
-- et que 79 photos sur 110 étaient parties au mauvais enfant. Plus une seule empreinte de production
-- ne porte ce nom.
--
-- CE QUE ÇA CASSAIT, EN PRODUCTION. L'OS appelle cette fonction AVEC UN SEUL ARGUMENT
-- (`recoJoueursPrets` dans SportVision-OS-Full.html) : il prenait donc le défaut, demandait
-- « cette photo de référence a-t-elle une empreinte pour face-api-1.7.15-ssd128 ? », et la réponse
-- était non pour toutes, définitivement. L'écran annonçait au staff que rien n'était calculé alors
-- que tout l'était.
--
-- Et le moteur, qui passe le bon modèle explicitement, ne souffrait pas — donc rien ne se voyait du
-- côté qui travaille. Seul l'écran mentait. C'est la forme la plus durable d'un défaut : celle qui
-- n'empêche personne de travailler.
--
-- COMMENT IL A ÉTÉ TROUVÉ, et ça vaut la peine de l'écrire : par un test qui ne s'exécutait même
-- pas. `plusieurs-photos-de-reference` était en CASSE (« permission denied », ma v351). Une fois le
-- droit rendu, il est passé ROUGE sur la vraie mesure : « la SECONDE photo reste à calculer :
-- attendu 1, obtenu 2 ». Un test qui ne s'exécute pas ne prouve rien — mais il ne se contente pas
-- de ne rien prouver, il CACHE ce qu'il aurait prouvé.
--
-- On ne change que la valeur par défaut. Même signature, mêmes noms de colonnes, même corps : une
-- signature qui bouge, c'est une surcharge, et on l'a payée trois fois aujourd'hui (v350).

create or replace function public.reconnaissance_joueurs_prets(
  p_album_id uuid,
  -- LE MODÈLE COURANT, et il doit suivre le moteur. Si l'on change de moteur de reconnaissance, ce
  -- défaut se change dans la même migration, sinon l'OS reposera la question à un modèle disparu.
  p_modele text default 'insightface-buffalo_l-arcface512')
returns table (player_id uuid, joueur text, face_ref_id uuid, chemin_photo text, a_une_empreinte boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_teams uuid[];
begin
  if not peut_marquer_galerie(p_album_id) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  v_teams := public.media_equipes_de_la_galerie(p_album_id);

  return query
  select p.id,
         coalesce(nullif(btrim(p.prenom || ' ' || p.nom), ''), 'Sportif'),
         fr.id,
         fr.storage_path,
         -- LE MODÈLE FAIT PARTIE DE LA QUESTION. Sans lui, une empreinte d'un autre moteur fait
         -- croire que le travail est fait.
         exists (select 1 from visages_reference vr
                  where vr.face_ref_id = fr.id and vr.modele = p_modele)
    from player_profiles p
    join team_memberships tm on tm.player_id = p.id and tm.statut = 'active'
    -- Jointure ouverte : cette fonction dit aussi QUI peut être marqué, et un sportif sans photo
    -- de référence doit rester proposé au marquage manuel.
    left join player_face_refs fr on fr.player_id = p.id
   where coalesce(cardinality(v_teams), 0) > 0
     and tm.team_id = any(v_teams)
     and consentement_biometrie_actif(p.id)
   group by p.id, p.prenom, p.nom, fr.id, fr.storage_path, fr.created_at
   order by 2, fr.created_at;
end $$;

-- v351 avait fermé cette fonction au moteur seul, ce qui vidait l'écran de l'OS (voir v354). Un
-- `create or replace` ne touche pas aux droits, mais on le redit : ils doivent rester.
grant execute on function public.reconnaissance_joueurs_prets(uuid, text) to authenticated, service_role;
revoke all on function public.reconnaissance_joueurs_prets(uuid, text) from public, anon;

notify pgrst, 'reload schema';
