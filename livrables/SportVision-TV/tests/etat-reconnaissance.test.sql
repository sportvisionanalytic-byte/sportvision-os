-- Où en est la reconnaissance, et qui a le droit de le demander.
--
-- Deux vérifications. La première dit l'état réel des quatre marches (Pass, accord, photo de
-- référence, photos retrouvées) : c'est ce qui permet à l'écran de nommer la SUIVANTE au lieu
-- d'afficher « Rien pour le moment », vrai et inutile. La seconde vérifie qu'une famille ne peut pas
-- interroger l'enfant d'une autre.
--
-- Mesure du 26/09 qui a motivé tout ça : sur six joueurs, deux avaient donné leur accord, AUCUN
-- n'avait déposé de photo de référence, donc aucune empreinte, donc zéro photo retrouvée. Tout le
-- mécanisme fonctionnait, rien ne le disait.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_nathan uuid; v_user uuid; v_autre uuid; r record; rapport text := '';
begin
  select pp.id, pp.user_id into v_nathan, v_user from player_profiles pp where pp.prenom='Nathan' limit 1;
  select pp.user_id into v_autre from player_profiles pp where pp.id <> v_nathan and pp.user_id is not null limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  for r in select * from media_etat_reconnaissance(v_nathan) loop
    rapport := rapport || format(E'\n  Nathan lui-meme -> accord=%s photo=%s empreinte=%s photos=%s',
      r.consentement, r.photo_reference, r.empreinte, r.photos_trouvees);
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', v_autre::text)::text, true);
  begin
    perform * from media_etat_reconnaissance(v_nathan);
    rapport := rapport || E'\n  UN AUTRE JOUEUR -> PASSE (FAILLE)';
  exception when others then
    rapport := rapport || format(E'\n  un autre joueur -> refuse (%s)', sqlerrm);
  end;
  raise exception 'RAPPORT%', rapport;
end $$;
