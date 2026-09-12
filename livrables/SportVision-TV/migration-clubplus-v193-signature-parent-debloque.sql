-- v193 — La signature du parent débloque la demande (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. `recompute_request_readiness` fait passer une demande d'adhésion de
-- `en_attente_parent` à `pret_a_valider` quand les trois autorisations requises sont signées.
-- Elle n'était appelée que depuis `submit_parental_authorization` et
-- `verify_parental_authorization` — deux fonctions que l'écran du parent n'utilise pas. La RPC
-- réellement branchée sur Connect est `signer_autorisation`, qui ne l'appelait pas.
--
-- Le parent signait donc ses autorisations, l'écran le remerciait, et la demande restait bloquée.
-- Personne n'était prévenu que la validation était devenue possible ; côté club, le bouton
-- Valider échouait sur « Autorisation parentale manquante ou invalide ». C'est le blocage le plus
-- fréquent de toute la chaîne d'inscription, et il était invisible des deux côtés.
--
-- CE QUE FAIT CETTE MIGRATION. Le recalcul devient un déclencheur sur `parental_authorizations`,
-- et non plus un appel qu'il faut penser à écrire dans chaque fonction. Toute écriture d'une
-- autorisation — signature, retrait, vérification, import — le déclenche, quel que soit le
-- chemin. C'est la seule façon de ne plus oublier un appelant : il y en avait déjà quatre.
-- Idempotente.

create or replace function public.recalculer_demandes_apres_autorisation()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  perform recompute_request_readiness(coalesce(new.player_id, old.player_id));
  return coalesce(new, old);
end $$;

drop trigger if exists trg_recalculer_demandes_apres_autorisation on parental_authorizations;
create trigger trg_recalculer_demandes_apres_autorisation
  after insert or update or delete on parental_authorizations
  for each row execute function recalculer_demandes_apres_autorisation();

-- Second défaut, trouvé en écrivant le test : `recompute_request_readiness` ne savait que monter.
-- Elle ne redescendait que depuis `en_attente_parent`, jamais depuis `pret_a_valider`. Un parent
-- qui retirait son accord APRÈS avoir signé laissait donc la demande marquée « prête à valider » :
-- le club pouvait valider une adhésion dont l'autorisation parentale venait d'être retirée.
create or replace function public.recompute_request_readiness(p_player_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_authorized boolean;
begin
  select bool_and(pa.statut = 'valide') into v_authorized
  from authorization_types at
  join parental_authorizations pa on pa.authorization_type_id = at.id and pa.player_id = p_player_id
  where at.code in ('creation_compte', 'acces_clubplus', 'traitement_donnees');

  if v_authorized is true then
    update membership_requests
    set statut = 'pret_a_valider'
    where player_id = p_player_id and statut in ('autorisation_manquante', 'en_attente_parent');
  else
    update membership_requests
    set statut = 'autorisation_manquante'
    where player_id = p_player_id and statut in ('en_attente_parent', 'pret_a_valider');
  end if;
end;
$function$;
