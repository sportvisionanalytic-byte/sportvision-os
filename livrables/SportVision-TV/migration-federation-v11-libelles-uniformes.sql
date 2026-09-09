-- Un seul libelle d'equipe par equipe, et une garde anti-doublon qui n'en depend plus.
--
-- ── Le probleme ──
-- Deux ecritures alimentent club_matches depuis la source, et elles ne nommaient pas les equipes
-- pareil. Le chargement de saison lit les pages d'equipe et y trouve « SENIORS 3 » ; la synchro
-- quotidienne lit l'API et y trouve « Seniors 3 ». Meme equipe, deux libelles.
--
-- Ce n'est pas qu'une question de coherence d'affichage : la garde anti-doublon de la synchro
-- comparait justement ce libelle. Elle laissait donc passer un match deja present sous l'autre
-- forme. Un doublon en est deja ne — Seniors 3 contre Paris International le 20/09 — et le
-- nettoyage precedent ne l'avait pas vu, pour cette raison exacte.
--
-- ── Les trois corrections ──
--  1. Le doublon existant part.
--  2. Les libelles sont uniformises sur la forme courte, celle que produit la synchro quotidienne :
--     c'est elle qui ecrit tous les jours, autant parler sa langue.
--  3. La garde de la synchro ne compare plus le libelle mais (date, adversaire, competition).
--     Deux equipes d'un meme club peuvent affronter le meme adversaire le meme jour — SENIORS 2 et
--     SENIORS 3 jouent toutes deux Montreuil FC le 01/11 — mais jamais dans la meme competition.
--     (Corrige dans federation-sync-matchs, redeploye avec cette migration.)

begin;

-- 1. Le doublon du 20/09. On garde le plus petit identifiant, celui du calendrier d'origine.
delete from public.club_matches
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and provider = 'SPORTCORICO'
   and external_event_id = '5974489';

-- 2. Uniformisation des libelles.
update public.club_matches
   set team = case team
                when 'SENIORS 1' then 'Seniors 1'
                when 'SENIORS 2' then 'Seniors 2'
                when 'SENIORS 3' then 'Seniors 3'
                when 'SENIORS FÉMININES 1' then 'Seniors F 1'
                when 'U15 FÉMININES 2' then 'U15 F 2'
                when 'U18 FÉMININES 2' then 'U18 F 2'
                else team
              end
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and provider = 'SPORTCORICO'
   and team in ('SENIORS 1', 'SENIORS 2', 'SENIORS 3', 'SENIORS FÉMININES 1',
                'U15 FÉMININES 2', 'U18 FÉMININES 2');

-- Les rattachements de source suivent, sinon la synchro ne retrouverait plus ses equipes.
update public.club_team_source_mappings
   set external_team_name = case external_team_name
                              when 'SENIORS 1' then 'Seniors 1'
                              when 'SENIORS 2' then 'Seniors 2'
                              when 'SENIORS 3' then 'Seniors 3'
                              when 'SENIORS FÉMININES 1' then 'Seniors F 1'
                              when 'U15 FÉMININES 2' then 'U15 F 2'
                              when 'U18 FÉMININES 2' then 'U18 F 2'
                              when 'U18 FÉMININES 1' then 'U18 F 1'
                              else external_team_name
                            end
 where club_id = 'f0d3bafa-3004-4831-bd85-249aa9af5c54'
   and provider = 'SPORTCORICO';

commit;
