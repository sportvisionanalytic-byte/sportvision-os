-- Migration : marquer une galerie ou un lien comme exclu des statistiques
-- À exécuter APRÈS migration-galeries-v23-offre-vendue-inviolable.sql.
--
-- ── Pourquoi un drapeau explicite ──
-- SportVision va continuer à faire des essais sur de vraies galeries, avec de vraies commandes.
-- Sans marqueur, ces essais gonflent le chiffre d'affaires et écrasent les taux de conversion.
--
-- On refuse en revanche toute heuristique sur le nom : chercher « test » dans un titre marcherait
-- jusqu'au jour où un club s'appelle « Tests-le-Château » ou où une vraie galerie s'intitule
-- « Match test de la nouvelle caméra ». Un drapeau se règle, une devinette se trompe.
--
-- ── Deux niveaux, parce que les deux cas existent ──
--   * sur l'ALBUM : toute la galerie sort des statistiques, vues comprises ;
--   * sur le LIEN : seul ce lien sort, ce qui permet de tester un tarif sur une vraie galerie
--     sans perdre les chiffres des liens envoyés aux familles.
--
-- Par défaut `false` : tout compte. Un drapeau qui exclurait par défaut finirait par cacher du
-- chiffre d'affaires réel sans que personne ne s'en rende compte.
--
-- Les analytics acceptent un paramètre pour les réintégrer : on peut vouloir vérifier qu'un essai
-- a bien produit ce qu'on attendait.

begin;

alter table media_albums
  add column if not exists analytics_excluded boolean not null default false;

alter table media_album_links
  add column if not exists analytics_excluded boolean not null default false;

comment on column media_albums.analytics_excluded is
  'Galerie d''essai : exclue des statistiques commerciales, vues comprises. false par défaut — tout compte tant qu''on ne dit pas le contraire.';

comment on column media_album_links.analytics_excluded is
  'Lien d''essai : seul ce lien sort des statistiques. Permet de tester un tarif sur une VRAIE galerie sans perdre les chiffres des liens envoyés aux familles.';

-- Réglable par ceux qui décident déjà du commercial. Un photographe ne doit pas pouvoir sortir
-- une galerie des statistiques.
create or replace function media_stats_exclure(
  p_album_id uuid default null,
  p_link_id uuid default null,
  p_exclu boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_album uuid;
begin
  v_album := coalesce(p_album_id, (select album_id from media_album_links where id = p_link_id));
  if v_album is null or not media_pricing_staff_album(v_album) then
    return false;
  end if;

  if p_link_id is not null then
    update media_album_links set analytics_excluded = coalesce(p_exclu, true) where id = p_link_id;
  else
    update media_albums set analytics_excluded = coalesce(p_exclu, true) where id = p_album_id;
  end if;
  return true;
end;
$$;

grant execute on function media_stats_exclure(uuid, uuid, boolean) to authenticated;

-- ── Le périmètre tient compte de l'exclusion ───────────────────────────────────────────────
create or replace function _media_stats_albums(p_inclure_exclus boolean default false)
returns table (album_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id
  from media_albums a
  where (coalesce(p_inclure_exclus, false) or not a.analytics_excluded)
    and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','prod','sec','compta'))
      or (
        coalesce(a.pole_id, (select pr.pole_id from prestations pr where pr.id = a.mission_id)) is not null
        and exists (
          select 1 from pole_affectations pa
          where pa.user_id = auth.uid()
            and pa.role_pole = 'responsable'
            and pa.actif
            and pa.pole_id = coalesce(a.pole_id, (select pr.pole_id from prestations pr where pr.id = a.mission_id))
        )
      )
    );
$$;

-- ── Les liens exclus sortent aussi ─────────────────────────────────────────────────────────
-- Une seule définition, relue partout : « ce lien compte-t-il ? ». La répéter dans chaque
-- fonction garantirait qu'une d'elles finisse par l'oublier.
create or replace function _media_stats_lien_compte(p_link_id uuid, p_inclure_exclus boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_inclure_exclus, false)
      or p_link_id is null
      or not coalesce((select l.analytics_excluded from media_album_links l where l.id = p_link_id), false);
$$;

commit;
