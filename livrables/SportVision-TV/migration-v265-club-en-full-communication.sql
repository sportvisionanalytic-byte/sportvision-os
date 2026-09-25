-- v265 — Savoir si un club est en Full Communication, sans ouvrir les contrats (25/09/2026)
--
-- DEMANDE DE FOUKA : « Les galeries qu'on crée pour les clubs en Full Communication, ça doit être
-- différent des galeries créées pour des tournois ou des clubs adverses. Faut pas mettre galerie
-- complète ou les prix. »
--
-- Il a raison : dans un contrat Full Com, les photos sont DÉJÀ payées. Proposer un tarif au club
-- qui nous paie déjà revient à lui vendre ce qu'il possède.
--
-- POURQUOI UNE FONCTION. L'écran des galeries a d'abord posé la question directement à `contrats`.
-- Ça marchait pour un administrateur et rendait toujours « non » pour la Production — qui est
-- justement celle qui crée les galeries. La policy de `contrats` ne l'y autorise pas, et c'est
-- très bien : un contrat porte des montants, des durées, des clauses. Le Responsable Production
-- n'a pas à les lire pour savoir s'il doit construire un tarif.
--
-- CETTE FONCTION NE REND QU'UN OUI OU UN NON. Aucun montant, aucune date, aucune clause n'en sort
-- — c'est ce qui permet de l'ouvrir largement sans rouvrir la table.
--
-- LE PONT PASSE PAR `clubs.portail_client_id` : un club SportVision pointe vers la fiche client
-- qui porte les contrats. Se fier au NOM — « SF Villemomble » des deux côtés — marcherait
-- aujourd'hui et casserait au premier renommage.
--
-- Idempotente. À exécuter dans Supabase → SQL Editor.

create or replace function public.club_est_full_communication(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from clubs cl
    join contrats ct on ct.client_id = cl.portail_client_id
    where cl.id = p_club_id
      and ct.type_contrat = 'full_communication'
      and ct.statut = 'actif'
  );
$function$;

-- Ouverte au personnel connecté, fermée au reste. La question « ce club est-il client » n'a pas à
-- se poser sans compte : c'est une information commerciale, même reduite a un booleen.
revoke all on function public.club_est_full_communication(uuid) from public, anon;
grant execute on function public.club_est_full_communication(uuid) to authenticated;

comment on function public.club_est_full_communication(uuid) is
  'Ce club a-t-il un contrat Full Communication actif ? Rend un booleen et rien d''autre : '
  'aucun montant ni clause ne sort, ce qui permet de l''ouvrir sans rouvrir la table contrats.';
