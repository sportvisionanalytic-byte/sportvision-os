-- v352 — LE RETRAIT D'ACCORD BIOMÉTRIQUE N'AVAIT AUCUN EFFET (29/09/2026)
--
-- P0, ET C'EST MOI QUI L'AI INTRODUIT AUJOURD'HUI. v344 s'appelait « le retrait supprime les photos
-- dans la transaction » : j'ai remplacé une file de purge qui fonctionnait par un
-- `delete from storage.objects`. Or Supabase l'interdit :
--
--   Direct deletion from storage tables is not allowed. Use the Storage API
--
-- Cette erreur est levée AU MILIEU de la fonction. Donc toute la transaction est annulée, et le
-- retrait n'a plus AUCUN effet :
--   - l'accord reste « accordé » ;
--   - les empreintes de visage restent en base ;
--   - les fichiers restent dans le stockage ;
--   - et une nouvelle photo de référence peut encore être déposée.
--
-- Un parent qui retire l'accord pour son enfant voyait un écran d'erreur, et rien ne se passait.
-- C'est une donnée de l'article 9 du RGPD, sur des mineurs, et le droit de retrait est la
-- contrepartie exacte du consentement. Mesuré par deux tests qui étaient au rouge :
-- consentement-biometrie-connect et consentement-quinze-ans.
--
-- LA LEÇON, ET ELLE EST EXACTEMENT CELLE DU 27/09 : « une correction de données ne se défend pas ».
-- v344 voulait faire mieux que la file — effacer tout de suite au lieu de promettre — mais elle n'a
-- jamais été vérifiée par le chemin réel. Le déclencheur, lui, faisait déjà le bon travail.
--
-- CE QU'ON FAIT. On enlève la suppression directe. Le déclencheur `effacer_biometrie_au_retrait`
-- remplit `biometrie_a_purger` et supprime les empreintes ; le moteur, qui tourne en permanence avec
-- les droits de service, vide cette file par l'API Storage (voir moteur.mjs, purgerBiometrie).
--
-- ET ON NE DIT PLUS « effacés » POUR DES FICHIERS QUI ATTENDENT. La réponse annonçait
-- `fichiers_effaces`. Un nom qui promet plus que le fait, c'est la règle du 10/09 : pas de faux
-- succès. Elle annonce maintenant combien de fichiers sont EN ATTENTE de purge.

create or replace function public.retirer_consentement_biometrie(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer; v_empreintes integer; v_en_attente integer := 0;
begin
  if not (is_confirmed_parent_of(p_player_id) or is_own_player(p_player_id)
          or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')) then
    raise exception 'Cet enfant n''est pas le vôtre.' using errcode = '42501';
  end if;

  -- Le passage en « retiré » déclenche `effacer_biometrie_au_retrait`, qui met les fichiers en file
  -- de purge PUIS supprime les lignes de photos. L'ordre compte : lire les chemins après la
  -- suppression ne rendrait rien. C'est le déclencheur qui le garantit, pas cette fonction.
  update consentements_biometrie set statut = 'retire', retire_le = now(), retire_par = auth.uid()
   where player_id = p_player_id and statut = 'accorde';
  get diagnostics v_n = row_count;

  -- Les empreintes vivent ici, elles partent ici, tout de suite. Ce sont ELLES qui permettent de
  -- reconnaître un visage : leur suppression immédiate est ce qui rend le retrait effectif, même
  -- avant que le fichier image ne soit parti du stockage.
  v_empreintes := purger_visages_du_joueur(p_player_id);

  select count(*) into v_en_attente
    from biometrie_a_purger b where b.player_id = p_player_id and b.purge_le is null;

  return jsonb_build_object('retires', v_n, 'empreintes_effacees', v_empreintes,
                            'fichiers_en_attente_de_purge', v_en_attente,
                            'chemins', coalesce((select array_agg(b.storage_path)
                                                   from biometrie_a_purger b
                                                  where b.player_id = p_player_id and b.purge_le is null),
                                                array[]::text[]));
end $$;

comment on function public.retirer_consentement_biometrie(uuid) is
  'Retire l''accord de reconnaissance et efface les empreintes IMMÉDIATEMENT. Les fichiers image '
  'partent en file `biometrie_a_purger`, vidée par le moteur via l''API Storage. NE JAMAIS y remettre '
  'un `delete from storage.objects` : Supabase l''interdit, l''erreur annule toute la transaction et '
  'le retrait n''a plus aucun effet. C''est arrivé avec v344, le 29/09/2026.';

-- LA FILE DOIT POUVOIR ÊTRE VIDÉE PAR LE MOTEUR, ET PAR LUI SEUL. Personne d'autre n'a de raison
-- de lire où vivent les photos de visage d'un enfant.
revoke all on table public.biometrie_a_purger from public, anon, authenticated;
grant select, update on table public.biometrie_a_purger to service_role;

notify pgrst, 'reload schema';
