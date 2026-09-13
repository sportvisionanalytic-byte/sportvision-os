-- v213 — Une galerie déjà publiée prévient le joueur qui arrive après (13/09/2026).
--
-- CE QUI N'ALLAIT PAS. `notifier_publication_galerie` (v156) se déclenche au moment de la
-- publication : elle prévient les joueurs qui sont DÉJÀ dans l'équipe. Or l'ordre réel des
-- premières semaines d'un club est l'inverse : on photographie un match, on publie la galerie,
-- puis les familles créent leur compte et sont validées les jours suivants. Chacune de ces
-- validations arrive dans le silence le plus complet : la galerie existe, le joueur y a droit, et
-- rien ne le lui dit. C'est exactement le moment où l'on vend une photo.
--
-- Vérifié en base avant d'écrire : aucun déclencheur sur `team_memberships` n'écrit de
-- notification, et le seul chemin vers `member_notifications` pour une galerie est le déclencheur
-- de publication.
--
-- CE QUE FAIT CETTE MIGRATION. À l'arrivée d'un joueur dans une équipe (ou à son passage en
-- `active`), on regarde les galeries publiées de cette équipe. S'il y en a, une notification part
-- au joueur et à ses parents confirmés.
--
-- Trois bornes, pour que ce ne soit pas du bruit :
--   • Les 90 derniers jours seulement. Les archives d'une saison passée n'intéressent personne le
--     jour de son inscription.
--   • UNE notification récapitulative, pas une par galerie : un joueur qui arrive en fin de saison
--     recevrait quinze lignes identiques.
--   • Elle pointe vers la liste des photos, pas vers une galerie en particulier — c'est la liste
--     qui a du sens quand il y en a plusieurs.
--
-- L'index unique `member_notifications_galerie_uniq` (user_id, target_href) porte sur les cibles
-- contenant « galerie= ». Le récapitulatif utilise donc `galerie=recap-<team_id>` : deux
-- validations successives du même joueur sur la même équipe ne produisent qu'une notification, et
-- la ligne ne rentre pas en collision avec celles d'une galerie précise.
--
-- Idempotente.

create or replace function public.notifier_galeries_en_attente()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_equipe text;
  v_nb int;
  v_titre text;
  v_corps text;
  v_cible text;
begin
  -- Seulement l'entrée dans l'équipe, ou l'activation d'une affiliation qui ne l'était pas.
  if new.statut is distinct from 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.statut, '') = 'active' then
    return new;
  end if;

  select count(*) into v_nb
    from media_albums a
   where a.team_id = new.team_id
     and a.status = 'published'
     and coalesce(a.published_at, a.created_at) > now() - interval '90 days';

  if v_nb = 0 then
    return new;
  end if;

  select name into v_equipe from club_teams where id = new.team_id;
  v_titre := case when v_nb = 1 then 'Une galerie vous attend' else v_nb || ' galeries vous attendent' end;
  v_corps := coalesce(v_equipe, 'Votre équipe') || ' : les photos déjà en ligne sont accessibles depuis votre espace.';
  v_cible := '/photos?galerie=recap-' || new.team_id::text;

  -- Le joueur, s'il a un compte.
  insert into member_notifications (user_id, category, title, body, target_href)
  select p.user_id, 'content', v_titre, v_corps, v_cible
    from player_profiles p
   where p.id = new.player_id and p.user_id is not null
  on conflict do nothing;

  -- Ses parents confirmés, sur la page des photos de LEUR enfant. Même raison qu'en v156 :
  -- « /photos » est une page de l'Espace joueur, elle renvoie un parent chez lui sans rien lui
  -- montrer.
  insert into member_notifications (user_id, category, title, body, target_href)
  select pp.user_id, 'content', v_titre, v_corps,
         '/particulier/sportifs/club/' || new.player_id::text || '/photos?galerie=recap-' || new.team_id::text
    from parent_player_relationships ppr
    join parent_profiles pp on pp.id = ppr.parent_id
   where ppr.player_id = new.player_id and ppr.statut = 'confirme' and pp.user_id is not null
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists trg_notifier_galeries_en_attente on public.team_memberships;
create trigger trg_notifier_galeries_en_attente
  after insert or update of statut on public.team_memberships
  for each row execute function public.notifier_galeries_en_attente();

comment on function public.notifier_galeries_en_attente() is
  'v213 — Un joueur validé après la publication d''une galerie est prévenu de ce qui l''attend déjà. Récapitulatif unique, 90 jours, joueur et parents confirmés.';
