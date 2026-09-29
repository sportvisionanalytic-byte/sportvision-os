-- v342 — PAYER LE PASS LANCE LA RECHERCHE, POUR TOUS LES CLUBS (29/09/2026)
--
-- CE QUE FOUKA DEMANDE : « pour toutes les équipes, tous les clubs, et ceux que j'aurai à l'avenir
-- en Full Communication. Dès qu'un parent paye le Pass Photo, ses galeries, automatiquement ça fait
-- les recherches. Pas juste pour Fontainebleau. »
--
-- CE QUI MANQUAIT. La file se remplissait toute seule dans deux cas (v325) : une photo de référence
-- déposée, une galerie publiée. Jamais à l'achat du Pass. Or c'est le premier geste du parcours :
-- il paie, et à cet instant il n'a encore ni accord ni photo de référence. Rien ne se déclenchait
-- donc au moment où il commence à attendre quelque chose.
--
-- ET UNE SECONDE RAISON, PLUS PROFONDE. `reconnaissance_mettre_en_file` refusait d'inscrire quoi que
-- ce soit sans consentement biométrique. C'était juste tant que le moteur ne savait faire qu'une
-- chose. Il en sait deux depuis aujourd'hui : reconnaître des VISAGES, qui exige l'accord, et lire
-- des NUMÉROS DE MAILLOT, qui n'est pas de la biométrie et n'en exige aucun. Un chiffre peint sur un
-- vêtement n'est pas un visage.
--
-- Refuser d'inscrire le travail revenait donc à interdire aussi ce qui était permis. Le garde-fou
-- ne disparaît pas : il est là où il doit être, dans le moteur et dans les fonctions de marquage,
-- qui refusent toujours de reconnaître un visage sans accord.
--
-- CE QUI NE CHANGE PAS : rien n'est mis en file pour une galerie qui ne concerne pas le sportif
-- (`media_galerie_concerne_le_joueur`), et `on conflict do nothing` empêche d'empiler deux fois le
-- même travail.
--
-- Idempotente.

begin;

create or replace function public.reconnaissance_mettre_en_file(p_player_id uuid)
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_n integer;
begin
  -- PAS DE GARDE-FOU DE CONSENTEMENT ICI, et c'est réfléchi. Mettre en file, c'est dire « il y a du
  -- travail sur cette galerie pour ce sportif ». Ce que le moteur a le droit d'y faire est une
  -- autre question, tranchée ailleurs et à chaque fois : sans accord il lit les dossards et ne
  -- touche à aucun visage. Confondre les deux, c'était interdire le permis avec l'interdit.
  insert into reconnaissance_a_faire (album_id, player_id)
  select a.id, p_player_id
    from media_albums a
   where a.status = 'published'
     and public.media_galerie_concerne_le_joueur(a.id, p_player_id)
     -- Ne pas empiler : une demande en attente sur cette galerie suffit.
     and not exists (select 1 from reconnaissance_a_faire f
                      where f.album_id = a.id and f.player_id = p_player_id and f.traite_le is null)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $f$;

comment on function public.reconnaissance_mettre_en_file(uuid) is
  'v342 : inscrit toutes les galeries publiees qui concernent ce sportif. Sans condition de consentement — c''est le moteur qui decide ce qu''il a le droit d''y faire : les dossards toujours, les visages jamais sans accord.';

-- ── L'ACHAT DU PASS MET LES GALERIES EN FILE ───────────────────────────────────────────────────
create or replace function public.reconnaissance_a_l_achat_du_pass()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if new.beneficiary_person_id is not null then
    perform public.reconnaissance_mettre_en_file(new.beneficiary_person_id);
  end if;
  return new;
end $f$;

drop trigger if exists trg_reconnaissance_achat_pass on public.media_entitlements;
create trigger trg_reconnaissance_achat_pass
  after insert on public.media_entitlements
  for each row execute function public.reconnaissance_a_l_achat_du_pass();

-- ── ET LA PUBLICATION N'EXIGE PLUS UNE PHOTO DE RÉFÉRENCE ──────────────────────────────────────
--
-- Une galerie publiée mettait en file les seuls sportifs ayant DÉJÀ consenti ET déposé une photo.
-- Les autres n'étaient jamais inscrits, même ceux qui avaient payé : leurs dossards n'étaient
-- jamais lus, et leurs photos d'équipe jamais rattachées. On inscrit maintenant tous ceux dont une
-- famille attend quelque chose — accord donné, ou Pass acheté.
create or replace function public.reconnaissance_a_la_publication()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then
    return new;
  end if;
  insert into reconnaissance_a_faire (album_id, player_id)
  select distinct new.id, tm.player_id
    from team_memberships tm
   where tm.statut = 'active'
     and tm.team_id = any(public.media_equipes_de_la_galerie(new.id))
     and (
       consentement_biometrie_actif(tm.player_id)
       or exists (select 1 from media_entitlements e where e.beneficiary_person_id = tm.player_id)
     )
  on conflict do nothing;
  return new;
end $f$;

drop trigger if exists trg_reconnaissance_publication on public.media_albums;
create trigger trg_reconnaissance_publication
  after insert or update of status on public.media_albums
  for each row execute function public.reconnaissance_a_la_publication();

commit;
