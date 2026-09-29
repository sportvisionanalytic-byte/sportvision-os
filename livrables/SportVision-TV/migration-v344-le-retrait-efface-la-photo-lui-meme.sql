-- v344 — LE RETRAIT EFFACE LA PHOTO LUI-MÊME, SANS DÉPENDRE DU NAVIGATEUR (29/09/2026)
--
-- CE QUI CLOCHAIT. `retirer_consentement_biometrie` faisait bien son travail sur les données : elle
-- marquait le consentement retiré et purgeait les empreintes. Pour les PHOTOS de référence, elle se
-- contentait de RENDRE la liste des chemins, à charge pour l'écran de les supprimer ensuite.
--
-- Connect le fait — la ligne existe. Mais elle s'exécute dans le navigateur, APRÈS la réponse du
-- serveur : un onglet fermé au mauvais moment, un réseau qui coupe, et le consentement est retiré
-- pendant que la photo du visage d'un enfant reste en stockage. L'écran affiche pourtant « votre
-- accord est retiré et la photo de référence est effacée ».
--
-- Un droit de retrait qui dépend de ce que fait le navigateur ensuite n'est pas un droit de retrait.
-- Et c'est exactement ce qu'un contrôle regarde.
--
-- CE QU'ON FAIT. La suppression se fait DANS la même transaction, en base. `storage.objects` est une
-- table : effacer la ligne rend le fichier inaccessible immédiatement, par le même chemin que
-- l'application. L'appel du navigateur reste en place et devient une ceinture en plus d'une
-- bretelle — il ne trouve simplement plus rien à supprimer.
--
-- CE QUI NE CHANGE PAS : les empreintes partent toujours (v223), et les marquages posés par un
-- humain restent — ils ne reposent sur aucune donnée biométrique, et les effacer ferait disparaître
-- des photos que la famille a déjà payées.
--
-- Idempotente.

begin;

create or replace function public.retirer_consentement_biometrie(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_chemins text[]; v_n integer; v_empreintes integer; v_fichiers integer := 0;
begin
  if not (is_confirmed_parent_of(p_player_id) or is_own_player(p_player_id)
          or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')) then
    raise exception 'Cet enfant n''est pas le vôtre.' using errcode = '42501';
  end if;

  select array_agg(r.storage_path) into v_chemins
    from player_face_refs r
    join consentements_biometrie c on c.id = r.consentement_id
   where c.player_id = p_player_id and c.statut = 'accorde' and r.storage_path is not null;

  update consentements_biometrie set statut = 'retire', retire_le = now(), retire_par = auth.uid()
   where player_id = p_player_id and statut = 'accorde';
  get diagnostics v_n = row_count;

  -- Les empreintes vivent ici, elles partent ici. Sans cette ligne, le droit de retrait n'aurait
  -- aucun effet sur la donnée elle-même.
  v_empreintes := purger_visages_du_joueur(p_player_id);

  -- ET LES PHOTOS, MAINTENANT, PAS PLUS TARD. On ne rend plus une liste en espérant que quelqu'un
  -- s'en occupe : on efface, ici, dans la même transaction que le retrait.
  if v_chemins is not null and cardinality(v_chemins) > 0 then
    delete from storage.objects
     where bucket_id = 'sportvision-media-prive' and name = any(v_chemins);
    get diagnostics v_fichiers = row_count;
  end if;

  -- La ligne qui décrit la photo n'a plus d'objet une fois le fichier parti.
  delete from player_face_refs r
   using consentements_biometrie c
   where r.consentement_id = c.id and c.player_id = p_player_id;

  return jsonb_build_object('retires', v_n, 'empreintes_effacees', v_empreintes,
                            'fichiers_effaces', v_fichiers,
                            'chemins', coalesce(v_chemins, array[]::text[]));
end $f$;

comment on function public.retirer_consentement_biometrie(uuid) is
  'v344 : retire l''accord, efface les empreintes ET les photos de reference dans la meme transaction. Ne depend plus de ce que le navigateur fait ensuite.';

commit;
