-- v336 — le Community Manager du club (club_members.role='comm') peut generer/envoyer des
-- liens d'invitation d'equipe.
--
-- Contexte : migration-v234-cm-du-club.sql (15/09/2026, "DEMANDE DE FOUKA 15/09") avait
-- deliberement exclu 'comm' de deux choses en elargissant son role : "les accès (inviter,
-- paramètres)". Le 29/09/2026, Fouka revient sur le point "inviter" uniquement — "paramètres"
-- reste exclu, ce correctif ne touche pas a is_club_admin ni a peut_operer_club (bien plus
-- larges), seulement au garde-fou specifique aux invitations.
create or replace function public.peut_gerer_invitations_club(p_club_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.peut_operer_club(p_club_id)
    or exists (
      select 1 from club_members cm
      where cm.club_id = p_club_id
        and cm.user_id = auth.uid()
        and cm.role = 'comm'
        and cm.status = 'actif'
    );
$function$;
