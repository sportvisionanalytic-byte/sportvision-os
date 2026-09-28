-- v321b — 28/09/2026 : l'archivage automatique prévient, il n'agit pas en silence
--
-- La v321 pose la règle. Reste à la faire tourner. Deux précautions, et elles ont la même raison :
-- ce geste retire de la vente des galeries que des familles pourraient encore acheter, sans que
-- personne ne l'ait demandé ce jour-là.
--
--   1. LE GESTE PRÉVIENT. `media_retention_nuit()` archive ce qui est mûr, et si elle a archivé
--      quelque chose, elle écrit une notification à l'administration avec le nombre de galeries et
--      de photos concernées. Une action automatique sur du contenu vendu qui ne laisse aucune trace
--      lisible est une action qu'on découvre trois semaines plus tard, par une réclamation.
--
--   2. SEUL L'ARCHIVAGE EST PLANIFIÉ. La suppression définitive ne l'est pas, et ce n'est pas un
--      oubli : les fichiers vivent dans le stockage, hors de portée du SQL. Les effacer demande un
--      script, et l'ordre compte — les fichiers d'abord, les lignes ensuite. Une tâche de nuit qui
--      efface 4 000 photos sans personne pour la regarder n'est pas quelque chose que j'installe
--      de ma propre initiative.
--
-- Rappel de la mesure du jour : AUCUNE galerie n'est concernée avant la mi-décembre 2026. Cette
-- tâche va donc tourner chaque nuit sans rien faire pendant deux mois et demi, ce qui est
-- exactement ce qu'on veut d'une règle de rétention.
--
-- Idempotent.

create or replace function public.media_retention_nuit()
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare
  v_n integer := 0;
  v_photos integer := 0;
  v_titres text;
  v_dest uuid;
begin
  create temp table if not exists _retention_nuit (album_id uuid, titre text, publiee_le date, photos integer) on commit drop;
  delete from _retention_nuit;
  insert into _retention_nuit select * from public.media_retention_archiver();

  select count(*), coalesce(sum(photos), 0), string_agg(titre, ', ' order by titre)
    into v_n, v_photos, v_titres from _retention_nuit;

  if v_n = 0 then
    return jsonb_build_object('archivees', 0);
  end if;

  for v_dest in select id from profiles where actif and role in ('admin','prod') loop
    insert into notifications (destinataire_id, type, titre, message, priorite, source_type)
    values (v_dest, 'retention_galeries',
            v_n || ' galerie(s) archivée(s) automatiquement',
            v_n || ' galerie(s) publiées depuis plus de trois mois et sans achat en cours sont passées '
              || 'en archive : ' || left(coalesce(v_titres, ''), 400) || '. '
              || v_photos || ' photos concernées. Elles ne sont plus en vente. '
              || 'La suppression définitive n''a PAS eu lieu : elle se déclenche à la main, un mois plus tard.',
            'normale', 'media');
  end loop;

  return jsonb_build_object('archivees', v_n, 'photos', v_photos);
end $f$;

revoke all on function public.media_retention_nuit() from public, anon, authenticated;

select cron.unschedule('sportvision-retention-galeries')
 where exists (select 1 from cron.job where jobname = 'sportvision-retention-galeries');

select cron.schedule('sportvision-retention-galeries', '20 4 * * *', $$select media_retention_nuit();$$);
