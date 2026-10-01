-- v401 (01/10/2026) — Le montant recommandé est CALCULÉ, il ne se reçoit pas d'un opérateur.
--
-- MESURÉ par le chemin réel, transaction annulée, avec le jeton d'un opérateur sur sa propre
-- affectation :
--     update prestations_equipe set montant_recommande = 999 where id = <sa ligne>  →  PASSE
--     valeur relue = 999
--
-- POURQUOI LE TROU EXISTAIT : la v148 a bien rapatrié le calcul du recommandé en base, « plus reçu
-- du navigateur ». Mais le recalcul ne se déclenche QUE sur un INSERT ou quand la rémunération
-- change (`v_montant_change`). Un UPDATE qui ne touche à aucun montant ne recalcule rien, et la
-- valeur écrite à la main reste en place jusqu'au prochain geste de la Production.
--
-- CE QUE ÇA COÛTE : rien sur ce que l'opérateur touche — toute écriture de `remuneration` lève, et
-- le recommandé sera recalculé. Mais entre-temps c'est le chiffre que l'Admin LIT à l'écran pour
-- décider, et le seuil d'écart de 15 % se calcule dessus. Un recommandé gonflé fait passer pour
-- normal un montant qui ne l'est pas.
--
-- POURQUOI ON LÈVE PLUTÔT QUE DE RESTAURER EN SILENCE : huit fonctions écrivent ces colonnes
-- légitimement (`modifier_remuneration_mission`, `decider_exception_remuneration`,
-- `rpc_ajouter_membre_equipe`…). Remettre l'ancienne valeur sans rien dire reviendrait à annuler
-- silencieusement l'une d'elles le jour où elle écrit un instantané sans changer de montant. Et ce
-- serait exactement le faux succès qu'on interdit partout ailleurs : un PATCH qui répond « réussi »
-- alors que la ligne n'a pas bougé.
--
-- LE GARDE EST DONC VOLONTAIREMENT ÉTROIT : il ne refuse que le geste mesuré, celui de l'opérateur
-- sur sa propre ligne hors de tout changement de montant. La Production, l'Admin et les fonctions
-- internes ne sont pas touchés, donc aucun circuit existant ne peut régresser.
--
-- Les trois instantanés voyagent avec le recommandé : ils servent à expliquer d'où il vient
-- (tarif de base, multiplicateur, niveau). Un recommandé juste adossé à un instantané faux ne
-- s'explique plus.

create or replace function public.protect_le_recommande_est_calcule()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text;
  v_montant_change boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  v_montant_change := new.remuneration is distinct from old.remuneration
                   or new.frais_km is distinct from old.frais_km;

  if v_montant_change then
    return new;  -- le recalcul de protect_sensitive_affectation_fields fait foi
  end if;

  select role into v_role from profiles where id = auth.uid();
  if v_role in ('admin', 'prod') then
    return new;
  end if;

  if new.collaborateur_id = auth.uid()
     and (new.montant_recommande is distinct from old.montant_recommande
          or new.base_rate_snapshot is distinct from old.base_rate_snapshot
          or new.multiplier_snapshot is distinct from old.multiplier_snapshot
          or new.niveau_snapshot is distinct from old.niveau_snapshot) then
    raise exception 'Le montant recommandé est calculé depuis la grille, il ne s''écrit pas : c''est le chiffre sur lequel l''Admin décide.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_le_recommande_est_calcule on public.prestations_equipe;

-- AFTER le déclencheur de la v148 : celui-là recalcule, celui-ci garde ce qu'il n'a pas recalculé.
-- L'ordre entre deux BEFORE UPDATE se joue sur le nom, et « z_ » le place en dernier.
create trigger z_trg_le_recommande_est_calcule
  before update on public.prestations_equipe
  for each row execute function public.protect_le_recommande_est_calcule();
