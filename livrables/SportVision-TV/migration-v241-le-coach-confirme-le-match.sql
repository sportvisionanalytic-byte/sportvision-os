-- Le coach confirme le match : bon horaire, bon lieu, bon adversaire (21/09/2026)
--
-- DEMANDE DE FOUKA : « il y a eu pas mal d'erreurs sur les calendriers, des matchs qui n'étaient
-- pas bons. Il va falloir que les coachs puissent confirmer si le match c'est la bonne horaire,
-- le bon lieu, qu'ils puissent modifier ou ajouter un match, comme ça moi sur le calendrier je
-- vois le match exact. »
--
-- LE PROBLÈME RÉEL : le calendrier d'un club vient de la fédération, d'un import Excel ou d'une
-- saisie, et aucune de ces sources n'est fiable à l'heure près. Un match déplacé le jeudi soir par
-- un coup de fil entre deux coachs n'existe nulle part ailleurs que dans la tête de ces deux-là.
-- SportVision envoie pourtant un opérateur sur la foi de cette ligne. C'est ce qui a coûté des
-- déplacements pour rien.
--
-- CE QUE CETTE MIGRATION AJOUTE, ET RIEN DE PLUS :
--   1. Un état « confirmé par le club », distinct de `verified_by` qui sert au RÉSULTAT après
--      match. Ici on parle de l'avant-match : l'horaire et le lieu.
--   2. Une fonction de confirmation qui accepte, dans le même geste, une correction. Confirmer
--      « tel quel » et confirmer « mais c'est à 15h30 et pas 14h » sont la même action pour le
--      coach : dire ce qui est vrai.
--   3. La confirmation SAUTE si la fédération redéplace le match ensuite. Une confirmation qui
--      survivrait à un changement d'horaire serait pire que pas de confirmation du tout : elle
--      affirmerait qu'un humain a validé une ligne que personne n'a relue.
--
-- QUI CONFIRME (décision de Fouka, 21/09/2026) : le coach de l'équipe, plus le président et le
-- secrétaire pour n'importe quelle équipe du club. Pas le CM SportVision : il peut corriger une
-- ligne, c'est son métier, mais la confirmation est la signature du club et elle doit le rester.
-- Sinon on se confirmerait l'information à soi-même.
--
-- CE QUI EXISTE DÉJÀ ET N'EST PAS REFAIT ICI :
--   - le coach peut déjà insérer et modifier un match de ses équipes (cma_member_insert,
--     cma_member_update). C'était l'écran qui ne le proposait pas, pas la base qui l'interdisait ;
--   - une retouche humaine verrouille le champ contre la synchro fédérale (v237/v238) ;
--   - un match couvert par SportVision qui change d'horaire alerte déjà la Production
--     (signaler_evenement_modifie).

begin;

-- ══ 1. L'ÉTAT DE CONFIRMATION ════════════════════════════════════════════════
-- Pas de clé étrangère vers profiles : un coach de club n'a pas de ligne profiles, il vit dans
-- club_members. On garde l'identifiant auth, et l'affichage résout le nom à la lecture.
alter table club_matches add column if not exists horaire_confirme_par uuid;
alter table club_matches add column if not exists horaire_confirme_le timestamptz;

comment on column club_matches.horaire_confirme_par is
  'Qui, dans le club, a confirmé que la date, l''horaire et le lieu de ce match sont exacts. '
  'Distinct de verified_by, qui porte sur le résultat après match.';
comment on column club_matches.horaire_confirme_le is
  'Quand la confirmation a été donnée. Remise à NULL dès qu''une source extérieure redéplace le match.';

create index if not exists club_matches_a_confirmer_idx
  on club_matches (club_id, match_date)
  where horaire_confirme_le is null;

-- ══ 2. QUI A LE DROIT DE CONFIRMER ═══════════════════════════════════════════
create or replace function public.peut_confirmer_match(p_match_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from club_matches m
      left join club_teams ct
        on ct.club_id = m.club_id
       and (ct.id = m.team_id or (m.team_id is null and ct.name = m.team))
     where m.id = p_match_id
       and (
         -- Le coach de l'équipe concernée. is_real_team_educateur couvre déjà admin et président
         -- du club, et exige pour un coach que l'équipe soit dans son périmètre.
         (ct.id is not null and is_real_team_educateur(ct.id))
         -- Le secrétaire, qui tient le calendrier du club et rattrape les coachs silencieux.
         or exists (
           select 1 from club_members cm
            where cm.club_id = m.club_id
              and cm.user_id = auth.uid()
              and cm.status = 'actif'
              and cm.role in ('admin', 'president', 'secretaire')
         )
       )
  );
$$;

revoke all on function public.peut_confirmer_match(uuid) from public;
grant execute on function public.peut_confirmer_match(uuid) to authenticated;

comment on function public.peut_confirmer_match(uuid) is
  'Le coach de l''équipe, le président, le secrétaire et l''admin du club. Volontairement pas le '
  'CM SportVision : la confirmation est la signature du club sur ce qu''il sait du terrain.';

-- ══ 3. CONFIRMER, ÉVENTUELLEMENT EN CORRIGEANT ═══════════════════════════════
-- Un seul point d'entrée. Les paramètres nuls veulent dire « je ne touche pas à ce champ », ce qui
-- rend l'appel « je confirme tel quel » aussi simple que possible côté écran : aucun argument.
--
-- La correction passe par un UPDATE ordinaire, donc les triggers en place jouent : le champ modifié
-- est verrouillé contre la prochaine synchro fédérale, et la Production est alertée si un opérateur
-- est déjà prévu sur ce match.
create or replace function public.match_confirmer(
  p_match_id uuid,
  p_date date default null,
  p_heure time default null,
  p_lieu text default null,
  p_adversaire text default null
) returns club_matches
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_row club_matches;
begin
  if not peut_confirmer_match(p_match_id) then
    raise exception 'Seul le coach de cette équipe, le président ou le secrétaire du club peut confirmer ce match.'
      using errcode = '42501';
  end if;

  update club_matches m
     set match_date    = coalesce(p_date, m.match_date),
         kickoff_time  = coalesce(p_heure, m.kickoff_time),
         lieu          = coalesce(nullif(btrim(p_lieu), ''), m.lieu),
         opponent      = coalesce(nullif(btrim(p_adversaire), ''), m.opponent),
         horaire_confirme_par = auth.uid(),
         horaire_confirme_le  = now()
   where m.id = p_match_id
   returning * into v_row;

  return v_row;
end $$;

revoke all on function public.match_confirmer(uuid, date, time, text, text) from public;
grant execute on function public.match_confirmer(uuid, date, time, text, text) to authenticated;

-- ══ 4. RETIRER SA CONFIRMATION ═══════════════════════════════════════════════
-- Un coach qui a confirmé trop vite doit pouvoir se dédire. Sans ça, il corrigerait en douce ou
-- appellerait, et l'écran mentirait entre-temps.
create or replace function public.match_confirmation_retirer(p_match_id uuid)
returns club_matches
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_row club_matches;
begin
  if not peut_confirmer_match(p_match_id) then
    raise exception 'Seul le coach de cette équipe, le président ou le secrétaire du club peut revenir sur cette confirmation.'
      using errcode = '42501';
  end if;
  update club_matches set horaire_confirme_par = null, horaire_confirme_le = null
   where id = p_match_id returning * into v_row;
  return v_row;
end $$;

revoke all on function public.match_confirmation_retirer(uuid) from public;
grant execute on function public.match_confirmation_retirer(uuid) to authenticated;

-- ══ 5. UNE CONFIRMATION NE SURVIT PAS À UN REDÉPLACEMENT ═════════════════════
-- `auth.uid() is null` désigne la synchro fédérale et les tâches serveur, exactement comme dans
-- match_retouche_humaine. Quand elles bougent une date, un horaire ou un lieu déjà confirmé, la
-- confirmation tombe et le club est reinterrogé. Une correction faite par un humain ne tombe pas :
-- l'humain en question vient précisément de regarder la ligne.
create or replace function public.match_confirmation_perimee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null then
    return new;
  end if;
  if new.horaire_confirme_le is null then
    return new;
  end if;
  if new.match_date is distinct from old.match_date
     or new.kickoff_time is distinct from old.kickoff_time
     or coalesce(new.lieu,'') is distinct from coalesce(old.lieu,'')
     or coalesce(new.opponent,'') is distinct from coalesce(old.opponent,'') then
    new.horaire_confirme_par := null;
    new.horaire_confirme_le  := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_match_confirmation_perimee on club_matches;
create trigger trg_match_confirmation_perimee
  before update on club_matches
  for each row execute function public.match_confirmation_perimee();

-- ══ 6. CE QUI RESTE À CONFIRMER, POUR L'ÉCRAN ════════════════════════════════
-- Renvoie les matchs à venir non confirmés du périmètre du lecteur. Le calcul de périmètre n'est
-- pas refait ici : la fonction interroge club_matches en `security invoker`, donc les policies de
-- lecture existantes s'appliquent telles quelles. C'est volontaire, une deuxième définition du
-- périmètre finirait par diverger de la première.
create or replace function public.matchs_a_confirmer(p_club_id uuid, p_jours int default 21)
returns table (
  id uuid, team text, team_id uuid, opponent text, match_date date,
  kickoff_time time, lieu text, confirmable boolean
)
language sql
stable
set search_path to 'public'
as $$
  select m.id, m.team, m.team_id, m.opponent, m.match_date, m.kickoff_time, m.lieu,
         peut_confirmer_match(m.id)
    from club_matches m
   where m.club_id = p_club_id
     and m.horaire_confirme_le is null
     and m.match_date is not null
     and m.match_date >= (now() at time zone 'Europe/Paris')::date
     and m.match_date <= (now() at time zone 'Europe/Paris')::date + p_jours
     and coalesce(m.sport_status, 'scheduled') not in ('cancelled', 'completed')
   order by m.match_date, m.kickoff_time nulls last;
$$;

revoke all on function public.matchs_a_confirmer(uuid, int) from public;
grant execute on function public.matchs_a_confirmer(uuid, int) to authenticated;

-- ══ 7. L'ÉTAT D'UN MATCH POUR SA FICHE ═══════════════════════════════════════
-- L'écran a besoin de trois choses d'un coup : est-ce confirmé, par qui, et est-ce que la personne
-- qui regarde peut le confirmer. Trois requêtes séparées donneraient trois états qui se
-- contredisent le temps qu'elles reviennent, et une fiche qui affiche « à confirmer » à côté d'un
-- bouton grisé. Le nom vient de club_members, seul endroit où un coach de club porte un nom :
-- il n'a pas de ligne profiles, qui est la table du staff SportVision.
create or replace function public.match_confirmation(p_match_id uuid)
returns table (confirme_le timestamptz, confirme_par text, confirmable boolean)
language sql
stable security definer
set search_path to 'public'
as $$
  select m.horaire_confirme_le,
         (select nullif(btrim(coalesce(cm.prenom,'') || ' ' || coalesce(cm.nom,'')), '')
            from club_members cm
           where cm.club_id = m.club_id and cm.user_id = m.horaire_confirme_par
           limit 1),
         peut_confirmer_match(m.id)
    from club_matches m
   where m.id = p_match_id
     -- Pas de fuite : on ne répond que sur un match que le lecteur a le droit de voir.
     and (is_club_member(m.club_id) or peut_travailler_club(m.club_id));
$$;

revoke all on function public.match_confirmation(uuid) from public;
grant execute on function public.match_confirmation(uuid) to authenticated;

commit;
