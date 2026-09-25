-- v276 — 25/09/2026 : a qui ouvrir un accès payé en espèces ou par virement
--
-- Suite de la v274. Pour ouvrir un accès à la main, Fouka a besoin de voir les joueurs du club et
-- surtout de savoir lesquels ont DEJA leur accès : sans cette colonne, il ouvrirait deux fois le
-- même et la fonction refuserait sans qu'il comprenne pourquoi.
--
-- Pourquoi une fonction plutôt qu'une lecture de player_profiles depuis l'OS : cette table porte
-- la date de naissance, la licence, la taille et le poids de mineurs. Un écran d'encaissement n'a
-- aucun besoin de ça, et ouvrir la table pour afficher un nom serait exactement le genre de
-- lecture trop large qu'on a déjà eu à refermer (leçon du 10/09 sur les failles en lecture).
-- Ici : un identifiant, un nom, un état. Rien d'autre ne sort.
--
-- Idempotent.

create or replace function public.media_joueurs_pour_acces(
  p_club_id    uuid,
  p_product_id uuid,
  p_recherche  text default null
) returns table (
  player_id  uuid,
  nom_complet text,
  equipe      text,
  deja_actif  boolean
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q text := nullif(btrim(coalesce(p_recherche, '')), '');
begin
  if not media_commerce_staff() then
    raise exception 'Réservé à l''administration SportVision.' using errcode = '42501';
  end if;

  return query
  select pp.id,
         btrim(coalesce(pp.prenom, '') || ' ' || coalesce(pp.nom, '')),
         t.name,
         exists (
           select 1 from media_entitlements e
            where e.beneficiary_person_id = pp.id
              and e.product_id = p_product_id
              and e.status = 'active'
         )
    from player_profiles pp
    -- L'equipe sert uniquement a distinguer deux homonymes a l'ecran. On prend le rattachement
    -- actif le plus recent : un joueur qui a change de categorie en cours de saison en a
    -- plusieurs, et afficher l'ancienne ferait douter qu'on parle du bon enfant.
    left join lateral (
      select t.name
        from team_memberships tm
        join club_teams t on t.id = tm.team_id
       where tm.player_id = pp.id and tm.statut = 'active'
       order by tm.updated_at desc nulls last
       limit 1
    ) t on true
   where pp.club_id = p_club_id
     and (v_q is null
          or unaccent(lower(coalesce(pp.prenom, '') || ' ' || coalesce(pp.nom, '')))
             like '%' || unaccent(lower(v_q)) || '%')
   order by pp.nom nulls last, pp.prenom nulls last
   limit 60;
end $function$;

revoke all on function public.media_joueurs_pour_acces(uuid, uuid, text) from public;
grant execute on function public.media_joueurs_pour_acces(uuid, uuid, text) to authenticated;
