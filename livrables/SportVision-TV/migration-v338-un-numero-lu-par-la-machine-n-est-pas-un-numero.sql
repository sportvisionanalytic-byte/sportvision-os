-- v338 — UN NUMÉRO LU PAR LA MACHINE N'EST PAS UN NUMÉRO (29/09/2026)
--
-- CE QU'ON A TROUVÉ
--
-- `media_assets.numeros_visibles` était renseigné sur 59 photos. Trois ont été ouvertes et
-- regardées : AUCUNE ne montre de numéro de maillot. Un joueur de profil, un autre devant un
-- sponsor écrit « tess », un gardien en maillot à rayures. Les moteurs y ont « lu » [13], [1,3,4]
-- et [1,34,3].
--
-- La distribution le confirme sans ouvrir les 56 autres : sur 110 numéros relevés, le 1 sort 32
-- fois, le 4 vingt-quatre fois, le 3 vingt-deux fois. Un effectif de U16 ne porte pas trois fois
-- le même numéro : c'est la signature du bruit. Un pli de maillot fait un « 1 », un logo fait un
-- « 4 ».
--
-- CE QUE ÇA PRODUISAIT
--
-- La v305 joint « on voit le 7 sur cette photo » et « j'étais le 7 à ce match » pour PROPOSER des
-- photos à une famille. Fouka a déclaré le n°7 le 28/09 à 18 h 35 : six photos lui ont été
-- proposées sur-le-champ, toutes choisies parce qu'un moteur avait cru voir un 7. Ce sont les
-- photos d'autres enfants, montrées à une famille qui n'a rien demandé d'autre que les siennes.
--
-- C'est aussi la réponse à son « j'ai mis le numéro 7 et il n'y a rien » : il y avait quelque
-- chose, mais rien de vrai.
--
-- CE QUE FAIT CETTE MIGRATION
--
--   1. Elle ferme la porte : `numeros_visibles` ne se modifie plus que par le geste humain prévu
--      pour ça (`media_numeros_de_la_photo`, qui vérifie les droits sur la galerie). Un moteur qui
--      écrit directement dans la table est refusé, y compris avec la clé de service.
--   2. Elle efface les numéros fabriqués.
--   3. Elle retire les propositions qui en découlaient — et elles seules : un marquage issu du
--      visage porte un `score` et un `moteur`, un marquage issu d'un numéro n'en a aucun. Rien de
--      ce qu'une famille a validé ou refusé n'est touché.
--
-- CE QU'ELLE NE FAIT PAS. Elle n'interdit pas de lire les dossards un jour : elle exige qu'on le
-- prouve avant de le croire. Le jour où un lecteur sait lire un vrai numéro sur une vraie photo,
-- il passera par le même geste que l'humain, ou par une colonne à lui dont personne ne tirera de
-- conclusion sans l'avoir mesurée.

begin;

-- ── 1. LA PORTE ────────────────────────────────────────────────────────────────────────────────
--
-- On reconnaît le geste autorisé à un drapeau posé dans la transaction, et non au rôle : la clé de
-- service est justement celle des moteurs, et c'est elle qu'on veut arrêter. `media_numeros_de_la_photo`
-- pose le drapeau, personne d'autre ne le peut sans le vouloir explicitement.
create or replace function public.numeros_visibles_gardes()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if new.numeros_visibles is distinct from old.numeros_visibles
     and coalesce(current_setting('sportvision.numeros_humains', true), 'off') <> 'on' then
    raise exception
      'Les numéros visibles ne s''écrivent que par media_numeros_de_la_photo (v338 : un moteur en a fabriqué 110 sur 59 photos).'
      using errcode = '42501';
  end if;
  return new;
end $f$;

drop trigger if exists trg_numeros_visibles_gardes on media_assets;
create trigger trg_numeros_visibles_gardes
  before update on media_assets
  for each row execute function public.numeros_visibles_gardes();

-- Le geste humain pose le drapeau. Le reste de la fonction est inchangé, v305 comprise : on ne
-- réécrit pas une règle métier pendant qu'on ferme une porte.
create or replace function public.media_numeros_de_la_photo(
  p_asset_id uuid, p_numeros smallint[])
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_album uuid; v_nettoyes smallint[];
begin
  select album_id into v_album from media_assets where id = p_asset_id;
  if v_album is null then raise exception 'Photo introuvable.' using errcode = '22023'; end if;
  if not peut_marquer_galerie(v_album) then
    raise exception 'Vous ne pouvez pas annoter les photos de cette galerie.' using errcode = '42501';
  end if;
  v_nettoyes := array(select distinct n from unnest(coalesce(p_numeros,'{}'::smallint[])) n
                       where n between 1 and 99 order by n);
  perform set_config('sportvision.numeros_humains', 'on', true);
  update media_assets set numeros_visibles = v_nettoyes, updated_at = now() where id = p_asset_id;
  perform set_config('sportvision.numeros_humains', 'off', true);
  return public.media_suggerer_par_numero(v_album);
end $f$;

-- ── 2. LES PROPOSITIONS FABRIQUÉES ─────────────────────────────────────────────────────────────
--
-- Avant d'effacer les numéros : une fois `numeros_visibles` vide, on ne saurait plus lesquelles
-- venaient de là.
delete from media_player_tags t
 where t.statut = 'propose'
   and t.source = 'suggestion'
   and t.score is null
   and t.moteur is null
   and exists (
     select 1
       from media_assets x
       join media_numeros_de_match d
         on d.album_id = x.album_id and d.player_id = t.player_id
      where x.id = t.media_ref_id
        and cardinality(x.numeros_visibles) > 0
        and d.numero = any(x.numeros_visibles));

-- ── 3. LES NUMÉROS FABRIQUÉS ───────────────────────────────────────────────────────────────────
select set_config('sportvision.numeros_humains', 'on', true);
update media_assets set numeros_visibles = '{}'::smallint[]
 where cardinality(numeros_visibles) > 0;
select set_config('sportvision.numeros_humains', 'off', true);

commit;
