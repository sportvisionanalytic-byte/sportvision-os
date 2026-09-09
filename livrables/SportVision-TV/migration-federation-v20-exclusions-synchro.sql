-- Une suppression humaine doit tenir face a la synchronisation.
--
-- ── Ce qui s'est passe ──
-- Fouka a demande de retirer le match de Coupe Nike du 19/09 pour les U18 feminines (« retir sa
-- doir etre un bug »). Il a ete supprime dans les deux sources. La synchronisation suivante l'a
-- recree dans la minute : la source l'expose toujours, et la fonction ne connaissait aucune
-- raison de ne pas le reprendre.
--
-- C'est un defaut de conception, pas un accident : sans memoire des suppressions, TOUT nettoyage
-- manuel est efface au prochain passage. Le club corrigerait la meme ligne tous les matins.
--
-- ── Le remede ──
-- Une liste d'exclusions par identifiant de source. La synchro s'y refere avant de creer. On note
-- QUI a exclu et POURQUOI : dans six mois, « pourquoi ce match n'apparait pas » doit avoir une
-- reponse ailleurs que dans la memoire de quelqu'un.
--
-- Ce n'est pas une corbeille : la ligne du match est bien supprimee. On ne garde que son
-- identifiant chez la source, pour savoir qu'il ne faut pas le reprendre. Retirer l'exclusion
-- suffit a le faire revenir a la synchro suivante.

begin;

create table if not exists public.calendar_sync_exclusions (
  id uuid default gen_random_uuid() primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  provider text not null,
  external_event_id text not null,
  -- Conserves pour que la liste reste lisible sans avoir a interroger la source : « 5737241 » ne
  -- dit rien, « U18 F 1 vs Paris XIII, 19/09 » se comprend.
  libelle text,
  raison text,
  exclu_par uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  constraint calendar_sync_exclusions_provider_check
    check (provider in ('MANUAL','CSV','ICS','FOOTCLUBS_XLSX','PDF','FFF','SPORTCORICO','OTHER')),
  constraint calendar_sync_exclusions_uniq unique (club_id, provider, external_event_id)
);

comment on table public.calendar_sync_exclusions is
  'Evenements que la synchronisation ne doit PAS recreer, apres qu''un humain les a supprimes. Sans cette liste, tout nettoyage manuel serait annule au passage suivant : la source expose toujours l''evenement, et la synchro n''a aucune raison de ne pas le reprendre.';

create index if not exists idx_cse_lookup
  on public.calendar_sync_exclusions (club_id, provider, external_event_id);

alter table public.calendar_sync_exclusions enable row level security;

-- Lecture par le club concerne et par le staff : comprendre pourquoi un match n'apparait pas fait
-- partie du calendrier. L'ecriture passe par le service_role (la synchro), comme pour l'annuaire.
drop policy if exists cse_lecture on public.calendar_sync_exclusions;
create policy cse_lecture on public.calendar_sync_exclusions for select to authenticated
  using (is_club_member(club_id) or is_staff());

-- L'exclusion decidee ce soir : le match de Coupe Nike du 19/09.
insert into public.calendar_sync_exclusions (club_id, provider, external_event_id, libelle, raison)
values ('f0d3bafa-3004-4831-bd85-249aa9af5c54', 'SPORTCORICO', '5737241',
        'U18 F 1 vs Paris Xiii ES U18 F 1 — Coupe Nike Féminine U18, 19/09/2026',
        'Retiré à la demande de Fouka le 09/09/2026 : l''équipe U18 F aurait eu deux matchs le même jour, coupe à 15h et championnat à 17h15. L''un des deux a probablement été reporté sans que la source l''enregistre.')
on conflict (club_id, provider, external_event_id) do nothing;

-- Et on retire la ligne que la synchro venait de recreer.
delete from public.club_matches
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and provider = 'SPORTCORICO'
   and external_event_id = '5737241';

commit;
