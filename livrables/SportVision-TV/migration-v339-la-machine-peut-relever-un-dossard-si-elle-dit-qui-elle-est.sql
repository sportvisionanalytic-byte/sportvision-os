-- v339 — LA MACHINE PEUT RELEVER UN DOSSARD, À CONDITION DE DIRE QUI ELLE EST (29/09/2026)
--
-- CE QUE LA v338 A FERMÉ, ET POURQUOI ON ROUVRE
--
-- Ce matin, `numeros_visibles` a été verrouillé : un moteur y avait écrit 110 numéros sur 59 photos,
-- et en ouvrant ces photos AUCUNE ne montrait de dossard. Il lisait des plis de maillot et des
-- sponsors. La porte a été fermée, et c'était la bonne décision.
--
-- Depuis, le lecteur a été refait. Il ne cherche plus dans l'image entière mais dans le haut du dos
-- des personnes détectées, il ignore les gens vus de face — un numéro se porte dans le dos — et il
-- lit avec le moteur de texte de macOS, entraîné sur des photos du monde réel, au lieu d'un OCR de
-- documents qui lisait « 1 » sur un « 2 » de trente centimètres.
--
-- MESURÉ SUR LES 110 PHOTOS DE LA GALERIE : 6 numéros relevés, 6 exacts, 0 inventé. Chacun a été
-- vérifié en ouvrant la photo. Il en rate (le 4 d'un joueur lointain, un 10 à l'arrière-plan) et
-- c'est assumé : rater coûte une photo non proposée, inventer coûte les photos d'un enfant envoyées
-- à la famille d'un autre.
--
-- CE QU'ON NE REFAIT PAS COMME AVANT
--
-- On ne rouvre pas la table à tout le monde. Le verrou de la v338 reste en place, et la machine
-- passe par une porte à elle, qui EXIGE qu'elle se nomme. `numeros_lus_par` garde le nom du lecteur
-- et sa version : le jour où un relevé se révèle faux, on sait lequel, on sait quoi effacer, et on
-- n'efface pas ce qu'un humain a saisi. La v338 avait dû deviner tout cela après coup.
--
-- Idempotente.

begin;

alter table media_assets
  add column if not exists numeros_lus_par text;

comment on column media_assets.numeros_lus_par is
  'v339 : le lecteur automatique qui a releve ces numeros, avec sa version. NULL = saisi par un humain depuis l''OS. Sert a effacer le travail d''un lecteur precis sans toucher au reste.';

-- ── LA PORTE DE LA MACHINE ─────────────────────────────────────────────────────────────────────
--
-- Réservée au service : c'est la clé des moteurs, et aucune session de navigateur ne l'a.
create or replace function public.media_numeros_lus(
  p_asset_id uuid, p_numeros smallint[], p_lecteur text)
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_album uuid; v_nettoyes smallint[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'Seul un lecteur automatique passe par ici. Les numéros saisis à la main vont dans media_numeros_de_la_photo.'
      using errcode = '42501';
  end if;
  if coalesce(trim(p_lecteur), '') = '' then
    raise exception 'Un lecteur doit se nommer : sans cela on ne saura pas quoi effacer le jour où il se trompe.'
      using errcode = '22023';
  end if;

  select album_id into v_album from media_assets where id = p_asset_id;
  if v_album is null then raise exception 'Photo introuvable.' using errcode = '22023'; end if;

  -- ON NE PASSE JAMAIS PAR-DESSUS UN HUMAIN. Si quelqu'un a saisi les numéros depuis l'OS, sa
  -- saisie fait foi : elle vient de quelqu'un qui a regardé la photo.
  if exists (select 1 from media_assets
              where id = p_asset_id and numeros_lus_par is null and cardinality(numeros_visibles) > 0) then
    return 0;
  end if;

  v_nettoyes := array(select distinct n from unnest(coalesce(p_numeros,'{}'::smallint[])) n
                       where n between 1 and 99 order by n);

  perform set_config('sportvision.numeros_humains', 'on', true);
  update media_assets
     set numeros_visibles = v_nettoyes,
         numeros_lus_par = case when cardinality(v_nettoyes) > 0 then p_lecteur else null end,
         updated_at = now()
   where id = p_asset_id;
  perform set_config('sportvision.numeros_humains', 'off', true);

  return public.media_suggerer_par_numero(v_album);
end $f$;

comment on function public.media_numeros_lus(uuid, smallint[], text) is
  'v339 : la porte du lecteur automatique de dossards. Exige le nom du lecteur, ne remplace jamais une saisie humaine, et declenche la jointure v305.';

grant execute on function public.media_numeros_lus(uuid, smallint[], text) to service_role;

commit;
