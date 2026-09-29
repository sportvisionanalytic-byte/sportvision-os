-- v345 — UNE FAMILLE QUI ATTEND PASSE DEVANT UN TRAVAIL DE FOND (29/09/2026)
--
-- CE QUE FOUKA CONSTATE : « j'ai mis la photo de référence pour le joueur mais il n'y a aucune
-- autre photo qui s'est ajoutée. »
--
-- CE QUI S'EST RÉELLEMENT PASSÉ. Sa photo est bien arrivée à 11 h 58 min 54 s. Son empreinte n'a
-- jamais été calculée, parce que son travail attendait derrière celui d'une AUTRE galerie de 161
-- photos, mise en file une heure plus tôt par une publication. La file était servie dans l'ordre
-- d'arrivée, point.
--
-- Or les deux travaux n'ont rien à voir. L'un vient d'une personne qui vient de faire un geste et
-- qui regarde son écran en attendant le résultat. L'autre est un rattrapage de fond que personne
-- n'attend. Les traiter dans le même ordre, c'est faire patienter celle qui attend derrière celui
-- qui n'attend pas.
--
-- CE QU'ON FAIT. Une priorité, et deux valeurs seulement — au-delà, plus personne ne sait ce que
-- les chiffres veulent dire :
--   1 = quelqu'un attend. Photo de référence déposée, Pass acheté, numéro déclaré.
--   5 = travail de fond. Une galerie vient d'être publiée, on rattrape tout le monde.
--
-- Le moteur sert la priorité 1 d'abord, puis l'ordre d'arrivée. Une galerie déjà commencée se
-- termine : l'interrompre perdrait ce qu'elle a lu, et la suivante repartirait de zéro.
--
-- Idempotente.

begin;

alter table reconnaissance_a_faire
  add column if not exists priorite smallint not null default 5;

comment on column reconnaissance_a_faire.priorite is
  'v345 : 1 = une personne attend le resultat (photo de reference, Pass, numero) ; 5 = travail de fond apres une publication. Le moteur sert 1 avant 5, puis par ordre d''arrivee.';

create index if not exists idx_reconnaissance_file_priorite
  on reconnaissance_a_faire (priorite, demande_le) where traite_le is null;

-- ── Ce qu'un geste de famille met en file : en priorité ────────────────────────────────────────
create or replace function public.reconnaissance_mettre_en_file(p_player_id uuid, p_priorite smallint default 1)
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_n integer;
begin
  -- Pas de garde-fou de consentement ici (v342) : ce que le moteur a le droit de faire est tranché
  -- ailleurs et à chaque fois — les dossards toujours, les visages jamais sans accord.
  insert into reconnaissance_a_faire (album_id, player_id, priorite)
  select a.id, p_player_id, p_priorite
    from media_albums a
   where a.status = 'published'
     and public.media_galerie_concerne_le_joueur(a.id, p_player_id)
     and not exists (select 1 from reconnaissance_a_faire f
                      where f.album_id = a.id and f.player_id = p_player_id and f.traite_le is null)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $f$;

-- La publication rattrape tout le monde, mais sans passer devant personne.
create or replace function public.reconnaissance_a_la_publication()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then
    return new;
  end if;
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
  return new;
end $f$;

-- Déclarer son numéro : quelqu'un attend, et c'est écrit dans la fonction plutôt que deviné.
create or replace function public.media_declarer_mon_numero(
  p_album_id uuid, p_player_id uuid, p_numero smallint, p_lecteur text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_posees integer; v_conflit boolean; v_restantes integer;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;
  if not (is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)) then
    raise exception 'Ce sportif n''est pas rattaché à votre compte.' using errcode = '42501';
  end if;
  if not public.media_galerie_concerne_le_joueur(p_album_id, p_player_id) then
    raise exception 'Cette galerie ne concerne pas ce sportif.' using errcode = '42501';
  end if;
  if p_numero is null or p_numero < 1 or p_numero > 99 then
    raise exception 'Un numéro de maillot est entre 1 et 99.' using errcode = '22023';
  end if;

  insert into media_numeros_de_match (album_id, player_id, numero, declare_par)
  values (p_album_id, p_player_id, p_numero, auth.uid())
  on conflict (album_id, player_id)
    do update set numero = excluded.numero, declare_par = excluded.declare_par, updated_at = now();

  v_conflit := exists (
    select 1 from media_numeros_de_match
     where album_id = p_album_id and numero = p_numero and player_id <> p_player_id);

  v_posees := public.media_suggerer_par_numero(p_album_id);

  select count(*)::integer into v_restantes
    from media_assets x
   where x.album_id = p_album_id and x.status = 'ready'
     and cardinality(x.numeros_visibles) = 0
     and (case when p_lecteur is null then x.numeros_lus_par is null
               else x.numeros_lus_par is distinct from p_lecteur end);

  if v_restantes > 0
     and not exists (select 1 from reconnaissance_a_faire
                      where album_id = p_album_id and player_id = p_player_id and traite_le is null) then
    insert into reconnaissance_a_faire (album_id, player_id, priorite)
    values (p_album_id, p_player_id, 1);
  end if;

  return jsonb_build_object(
    'numero', p_numero,
    'conflit', v_conflit,
    'photos_ajoutees', v_posees,
    'recherche_en_cours', v_restantes > 0,
    'photos_a_examiner', v_restantes,
    'photos_avec_ce_numero', (select count(*) from media_assets x
                               where x.album_id = p_album_id and x.status='ready'
                                 and p_numero = any(x.numeros_visibles)));
end $f$;

-- Ce qui attend déjà et qui vient d'une famille : on le remonte, sinon la correction ne servirait
-- qu'aux prochains.
update reconnaissance_a_faire f
   set priorite = 1
 where f.traite_le is null
   and exists (select 1 from player_face_refs r
                join consentements_biometrie c on c.id = r.consentement_id
               where c.player_id = f.player_id and c.statut = 'accorde');

commit;
