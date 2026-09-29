-- v348 — UNE GALERIE QUI PLANTE NE BLOQUE PLUS LA FILE (29/09/2026)
--
-- CE QUI CLOCHAIT, ET PERSONNE NE L'AURAIT VU. Le moteur appelle `traiterGalerie` sans filet. Une
-- photo corrompue, une réponse inattendue de la base, un plantage d'onnxruntime, et c'est tout le
-- passage qui tombe. launchd relance le service dix secondes plus tard, il reprend la MÊME galerie,
-- retombe au même endroit, et recommence.
--
-- Une boucle infinie, silencieuse, qui bloque tout ce qui attend derrière — y compris les familles
-- en priorité 1. Le service aurait l'air vivant : il tourne, il consomme, il écrit dans son
-- journal. Et plus rien n'avancerait.
--
-- CE QU'ON FAIT. Un compteur d'essais, incrémenté AVANT le travail et non après : c'est la seule
-- façon de compter un plantage, puisqu'un plantage ne revient jamais écrire son échec. Au troisième
-- essai, le travail est classé avec son motif et la file repart.
--
-- TROIS, ET PAS UN. Une coupure réseau, un jeton expiré, un redémarrage au mauvais moment : ces
-- échecs-là passent au second essai. Abandonner au premier ferait perdre du travail parfaitement
-- récupérable.
--
-- Idempotente.

begin;

alter table reconnaissance_a_faire
  add column if not exists essais smallint not null default 0;

comment on column reconnaissance_a_faire.essais is
  'v348 : nombre de fois ou le moteur a COMMENCE ce travail. Incremente avant le traitement, pour qu''un plantage compte lui aussi. Au-dela de 3, le travail est abandonne pour ne pas bloquer la file.';

/**
 * Le moteur annonce qu'il commence. Rend les travaux encore recevables, et classe les autres.
 */
create or replace function public.reconnaissance_commencer(p_ids uuid[], p_max smallint default 3)
returns table(id uuid, essais smallint)
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Réservé au moteur.' using errcode = '42501';
  end if;

  update reconnaissance_a_faire f
     set essais = f.essais + 1
   where f.id = any(p_ids) and f.traite_le is null;

  -- Ceux qui ont trop essayé sortent de la file, avec leur motif écrit noir sur blanc : un travail
  -- qui disparaît sans rien dire est un travail que personne ne vient jamais regarder.
  update reconnaissance_a_faire f
     set traite_le = now(),
         resultat = 'abandonné après ' || f.essais || ' essais sans succès'
   where f.id = any(p_ids) and f.traite_le is null and f.essais > p_max;

  return query
    select f.id, f.essais from reconnaissance_a_faire f
     where f.id = any(p_ids) and f.traite_le is null;
end $f$;

comment on function public.reconnaissance_commencer(uuid[], smallint) is
  'v348 : le moteur annonce qu''il commence. Compte l''essai AVANT le travail — un plantage ne revient pas ecrire son echec — et classe ce qui a echoue trois fois, pour que la file reparte.';

grant execute on function public.reconnaissance_commencer(uuid[], smallint) to service_role;

commit;
