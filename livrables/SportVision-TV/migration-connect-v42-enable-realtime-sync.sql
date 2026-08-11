-- Migration v42 : active la réplication Supabase Realtime sur les tables partagées entre
-- SportVision OS et SportVision Connect, pour permettre une synchronisation live (sans
-- rechargement de page) entre les deux applications. Fondation pour le chantier "sync temps
-- réel OS↔Connect" décidé par Fouka le 11/08/2026 (P3 du rapport de pré-lancement).
--
-- Sans cette migration, .channel(...).on('postgres_changes', ...) ne reçoit jamais aucun
-- événement côté client, même si le code d'abonnement est correct — la table doit d'abord
-- être ajoutée à la publication `supabase_realtime`.
--
-- Idempotent : ADD TABLE échoue si la table est déjà membre de la publication, donc on
-- vérifie via pg_publication_tables avant chaque ajout.
do $$
declare
  t text;
  tables text[] := array[
    'prestations',
    'devis',
    'contrats',
    'club_bookings',
    'notifications',
    'member_notifications',
    'messages',
    'messages_client',
    'contenus'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
