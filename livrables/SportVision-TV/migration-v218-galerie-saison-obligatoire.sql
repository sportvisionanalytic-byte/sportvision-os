-- v218 — Une galerie de club ne peut plus se retrouver sans saison (14/09/2026).
--
-- LE PIÈGE, trouvé en mettant le Pass Photo en service. `resolve_media_policy` cherche la politique
-- du club POUR LA SAISON de la galerie :
--
--     where mcp.club_id = v_album.club_id and mcp.saison_id = v_album.saison_id
--
-- Si la galerie n'a pas de saison, cette ligne ne trouve rien et la fonction rend `aucune_vente`.
-- Et `can_access_media` compare de son côté `me.saison_id = v_album.saison_id` : un Pass acheté
-- pour 2026-2027 ne correspond à aucune galerie sans saison.
--
-- Conséquence : une galerie publiée sans saison est invisible pour TOUT LE MONDE — y compris pour
-- la famille qui vient de payer 39,90 €. Aucune erreur, aucun message : juste des photos qui ne
-- s'ouvrent pas. Or dans l'OS, la saison n'est renseignée QUE si l'opérateur la saisit à la main
-- (« la saison n'est résolue que si elle est saisie »). Un oubli de frappe, et la galerie est morte.
--
-- CE QUE FAIT CETTE MIGRATION. Avant d'écrire une galerie rattachée à un club sans saison, on la
-- résout : d'abord la saison déclarée du club, sinon la saison active. On ne refuse pas — refuser
-- ferait échouer un dépôt en cours sur le terrain — on complète, ce qui est déterministe et
-- vérifiable. Si aucune saison n'existe, la galerie passe comme avant : c'est le seul cas où l'on
-- ne peut rien deviner, et il ne se produit pas en production (une saison active existe).
--
-- Ce qui ne change pas : une galerie SANS club (structure externe, tournoi) n'a pas de saison à
-- résoudre, et n'en a pas besoin — elle se vend par son lien public et ses offres.
--
-- Idempotente.

create or replace function public.completer_saison_galerie()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_saison uuid;
begin
  if new.saison_id is not null or new.club_id is null then
    return new;
  end if;

  -- La saison déclarée par le club fait foi : c'est celle qui porte ses affiliations.
  select c.saison_id into v_saison from clubs c where c.id = new.club_id;

  if v_saison is null then
    select s.id into v_saison
      from clubs c join saisons s on s.label = c.saison
     where c.id = new.club_id;
  end if;

  if v_saison is null then
    select id into v_saison from saisons where active order by label desc limit 1;
  end if;

  new.saison_id := v_saison;
  return new;
end $$;

comment on function public.completer_saison_galerie() is
  'v218 — Une galerie de club sans saison est invisible même pour qui a payé le Pass : on complète la saison avant d''écrire.';

drop trigger if exists trg_completer_saison_galerie on public.media_albums;
create trigger trg_completer_saison_galerie
  before insert or update of club_id, saison_id on public.media_albums
  for each row execute function public.completer_saison_galerie();

-- Reprise des galeries déjà en base qui seraient dans ce cas (aucune au 14/09, mais rejouer cette
-- migration sur un autre environnement doit produire le même état).
update media_albums a
   set saison_id = coalesce(
         (select c.saison_id from clubs c where c.id = a.club_id),
         (select s.id from clubs c join saisons s on s.label = c.saison where c.id = a.club_id),
         (select id from saisons where active order by label desc limit 1))
 where a.club_id is not null and a.saison_id is null;

select 'OK — ' || count(*) || ' galerie(s) de club, dont ' ||
       count(*) filter (where saison_id is null) || ' sans saison.' as verdict
  from media_albums where club_id is not null;
