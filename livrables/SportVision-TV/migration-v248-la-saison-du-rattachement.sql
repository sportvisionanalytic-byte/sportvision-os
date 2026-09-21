-- Un joueur rattaché à son équipe doit voir ses galeries (21/09/2026)
--
-- LE DÉFAUT, trouvé en auditant la veille des invitations en masse. Les trois fonctions qui
-- rattachent un joueur à une équipe — validate_team_membership (le chemin normal : le joueur
-- accepte, le club valide), import_club_players et renew_season_membership — écrivent la saison
-- sous forme de TEXTE (`saison`) mais jamais son identifiant (`saison_id`), qui reste NULL.
--
-- CE QUE ÇA DONNAIT À L'ÉCRAN. L'espace Photos du joueur exige club + équipe + saison pour
-- afficher quoi que ce soit. Un joueur fraîchement validé se voyait donc répondre « Rejoignez
-- votre club et votre équipe pour retrouver ici vos galeries photo » — alors qu'il venait
-- exactement de faire ça. Aucune galerie, aucun Pass Photo proposé, et un message qui lui dit de
-- recommencer ce qui est déjà fait.
--
-- Personne ne l'avait vu parce qu'aucun joueur réel n'est encore rattaché : les seules lignes
-- existantes avaient été créées à la main, avec leur saison_id. Le défaut serait apparu au premier
-- joueur validé, c'est-à-dire demain.
--
-- On répare les deux bouts : la source pose désormais l'identifiant, et les lignes déjà créées
-- sans lui sont rattrapées.

begin;

-- ══ 1. RATTRAPER L'EXISTANT ══════════════════════════════════════════════════
-- On se fie au libellé déjà écrit ; à défaut, à la saison active. Jamais d'invention : une ligne
-- dont le libellé ne correspond à aucune saison connue reste telle quelle, et se verra.
update team_memberships tm
   set saison_id = s.id
  from saisons s
 where tm.saison_id is null
   and s.label = tm.saison;

update team_memberships tm
   set saison_id = (select id from saisons where active order by date_debut desc limit 1)
 where tm.saison_id is null
   and tm.saison is null;

-- ══ 2. POSER L'IDENTIFIANT À LA SOURCE ═══════════════════════════════════════
-- Une fonction unique, appelée par les trois chemins : le jour où la règle change (une saison qui
-- démarre en janvier, un club à cheval), elle change à un seul endroit.
create or replace function public.saison_id_pour(p_label text)
returns uuid
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (select id from saisons where label = nullif(btrim(coalesce(p_label,'')),'') limit 1),
    (select id from saisons where active order by date_debut desc limit 1)
  );
$$;

revoke all on function public.saison_id_pour(text) from public;
grant execute on function public.saison_id_pour(text) to authenticated, service_role;

commit;
