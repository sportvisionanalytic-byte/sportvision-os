-- v347 — PRÉPARER LES GALERIES AVANT QUE QUICONQUE LES DEMANDE (29/09/2026)
--
-- CE QUE FOUKA DEMANDE : « dès que j'ajoute une galerie d'un club partenaire, tu fais la
-- reconnaissance, même s'il n'y a pas encore de joueurs inscrits, comme ça quand le parent arrive
-- et met une photo de son enfant, tu as déjà repéré. »
--
-- L'IDÉE EST JUSTE, ET ON EN FAIT LA MOITIÉ QUI EST LÉGITIME.
--
-- Ce qu'on ne fera pas : conserver les empreintes des visages des galeries. C'est la décision du
-- 14/09 (v225, v325), et elle est depuis ce matin écrite noir sur blanc dans la politique de
-- confidentialité publiée : « les visages des autres enfants présents sur une photo ne sont jamais
-- enregistrés ». Les garder rendrait le rapprochement instantané, au prix de la biométrie
-- d'enfants dont aucune famille n'a rien signé. Ce n'est pas un réglage, c'est un engagement.
--
-- Ce qu'on fait, et qui sert le même but : LIRE LES NUMÉROS DE MAILLOT ET REPÉRER LES PHOTOS
-- D'ÉQUIPE de chaque galerie publiée, sans attendre que quelqu'un s'inscrive. Un chiffre peint sur
-- un vêtement n'est pas une donnée biométrique ; une photo d'équipe appartient à toute l'équipe.
-- Le jour où une famille arrive et déclare « j'étais le 7 », la réponse est immédiate au lieu de
-- demander cinq minutes de lecture.
--
-- COMMENT. La file accepte désormais un travail SANS SPORTIF : c'est une préparation de galerie,
-- pas une reconnaissance de personne. Elle passe en dernier (priorité 9), derrière les familles qui
-- attendent et derrière les rattrapages : personne ne patiente à cause d'elle.
--
-- Idempotente.

begin;

alter table reconnaissance_a_faire alter column player_id drop not null;

comment on column reconnaissance_a_faire.player_id is
  'v347 : NULL = preparation de la galerie sans sportif (numeros de maillot, photos d''equipe). Aucun visage n''est reconnu ni conserve dans ce cas.';

-- Deux travaux identiques ne s'empilent pas, sportif ou non.
create unique index if not exists idx_reconnaissance_file_sans_sportif
  on reconnaissance_a_faire (album_id) where player_id is null and traite_le is null;

-- ── Mettre une galerie en préparation ──────────────────────────────────────────────────────────
create or replace function public.reconnaissance_preparer_galerie(p_album_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if not exists (select 1 from media_albums where id = p_album_id and status = 'published') then
    return false;
  end if;
  insert into reconnaissance_a_faire (album_id, player_id, priorite)
  select p_album_id, null, 9
   where not exists (select 1 from reconnaissance_a_faire f
                      where f.album_id = p_album_id and f.player_id is null and f.traite_le is null);
  return found;
end $f$;

comment on function public.reconnaissance_preparer_galerie(uuid) is
  'v347 : inscrit une galerie pour preparation — numeros de maillot et photos d''equipe, sans sportif et sans consentement, puisque rien de biometrique n''en sort.';

grant execute on function public.reconnaissance_preparer_galerie(uuid) to service_role, authenticated;

-- ── Une galerie publiée se prépare toute seule ─────────────────────────────────────────────────
create or replace function public.reconnaissance_a_la_publication()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then
    return new;
  end if;

  -- Les sportifs dont une famille attend quelque chose : accord donné, ou Pass acheté.
  insert into reconnaissance_a_faire (album_id, player_id, priorite)
  select distinct new.id, tm.player_id, 5
    from team_memberships tm
   where tm.statut = 'active'
     and tm.team_id = any(public.media_equipes_de_la_galerie(new.id))
     and (
       consentement_biometrie_actif(tm.player_id)
       or exists (select 1 from media_entitlements e where e.beneficiary_person_id = tm.player_id)
     )
  on conflict do nothing;

  -- Et la préparation de la galerie elle-même, qu'il y ait quelqu'un ou personne.
  perform public.reconnaissance_preparer_galerie(new.id);
  return new;
end $f$;

drop trigger if exists trg_reconnaissance_publication on public.media_albums;
create trigger trg_reconnaissance_publication
  after insert or update of status on public.media_albums
  for each row execute function public.reconnaissance_a_la_publication();

-- ── Le rattrapage : tout ce qui est déjà publié et jamais examiné ──────────────────────────────
insert into reconnaissance_a_faire (album_id, player_id, priorite)
select a.id, null, 9
  from media_albums a
 where a.status = 'published'
   and exists (select 1 from media_assets x
                where x.album_id = a.id and x.status = 'ready' and x.numeros_lus_par is null)
   and not exists (select 1 from reconnaissance_a_faire f
                    where f.album_id = a.id and f.player_id is null and f.traite_le is null);

commit;
