-- v228 — « Un CM Junior ne peut pas… » s'affichait à des gens qui ne sont pas juniors (14/09/2026).
--
-- LE SYMPTÔME. Fouka valide un contenu du planning éditorial et reçoit « Un CM Junior ne peut pas
-- ignorer la validation du tuteur ». Il n'est pas junior : un seul compte l'est en production.
--
-- LA CAUSE, et c'est un piège classique de SQL. Le garde commençait par :
--
--     if actor_tier != 'junior' or new.cm_id != auth.uid() then return new; end if;
--
-- `cm_niveau_autonomie` est NULL pour presque tout le monde — la colonne n'a pas de valeur par
-- défaut, et seuls les juniors déclarés la portent. Or `NULL != 'junior'` ne vaut pas TRUE : il vaut
-- NULL. Tant que la seconde condition était vraie (le contenu appartenait à quelqu'un d'autre),
-- `NULL or TRUE` = TRUE et la fonction sortait correctement. Mais dès qu'une personne validait SON
-- PROPRE contenu, la seconde devenait FALSE : `NULL or FALSE` = NULL, l'expression n'est pas vraie,
-- la sortie ne se déclenchait pas, et les refus destinés aux juniors s'appliquaient à elle.
--
-- Autrement dit : tout CM dont le niveau d'autonomie n'a jamais été renseigné était traité comme un
-- junior sur ses propres contenus. Les neuf contenus du planning appartiennent justement à un compte
-- dans ce cas.
--
-- LA CORRECTION. Deux conditions séparées, chacune insensible au NULL, et une sortie explicite pour
-- qui n'est pas junior. La règle métier ne change pas d'un iota : un vrai CM Junior reste soumis à
-- la validation de son tuteur.
--
-- Idempotente.

create or replace function public.protect_junior_content_publication()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  actor_tier text;
begin
  if auth.role() = 'service_role' then return new; end if;

  select cm_niveau_autonomie into actor_tier from profiles where id = auth.uid();

  -- Niveau non renseigné = autonome. C'est le cas de tout le monde sauf des juniors déclarés, et
  -- c'est ce NULL qui rendait la condition d'origine indécidable.
  if coalesce(actor_tier, 'autonome') <> 'junior' then
    return new;
  end if;

  -- Un junior n'est bridé que sur SES propres contenus. `is distinct from` traite les NULL comme
  -- des valeurs, là où `!=` rendait NULL.
  if new.cm_id is distinct from auth.uid() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.statut not in ('brouillon','a_valider_tuteur') then
      raise exception 'Un CM Junior ne peut créer un contenu que comme brouillon.';
    end if;
    return new;
  end if;
  if old.statut in ('brouillon','corrections') and new.statut in ('pret','valide','programme','publie') then
    raise exception 'Un CM Junior ne peut pas ignorer la validation du tuteur.';
  end if;
  if old.statut = 'a_valider_tuteur' and new.statut in ('pret','valide') then
    raise exception 'Seul le tuteur peut valider ce contenu.';
  end if;
  return new;
end $$;

comment on function public.protect_junior_content_publication() is
  'v228 — Le garde des CM Juniors ne s''applique qu''aux juniors déclarés. Un niveau non renseigné vaut autonome.';
