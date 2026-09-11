-- v154 — media_club_galleries() ignorait l'acces "staff SportVision" a un club.
--
-- Contexte : le 11/09/2026, l'onboarding reel de RCPF Fontainbleau a revele que le compte
-- SportVision (profiles.role='prod') qui consulte un club client via le mode "Gestion
-- SportVision" de Club+ (badge issu de cm_espaces_clubs()) voyait "Aucune galerie publiee" alors
-- qu'une galerie existait bel et bien, publiee et gratuite. Cause : la seule porte de
-- media_club_galleries() est is_club_member(p_club_id), qui ne connait que club_members,
-- cm_agency_club_access et memberships.cm_super_access — elle n'a jamais ete mise a jour depuis
-- l'arrivee du modele d'affectation CM (migration-cm-v1/v9, 08/09), un jour APRES la creation de
-- cette fonction (migration-galeries-v18, 07/09). Un faux "aucune galerie" plutot qu'un vrai refus
-- d'acces, exactement le piege deja documente pour les ecritures (regle "pas de faux succes").
--
-- Correctif local et minimal : on ajoute la meme branche "staff SportVision" que celle deja
-- utilisee par media_pricing_staff_album() (meme fichier v18), via cm_clubs_autorises() —
-- la fonction faisant deja foi partout ailleurs pour "quels clubs cette personne peut gerer".
--
-- Dette signalee et volontairement PAS traitee ici : is_club_member() elle-meme n'a jamais appris
-- cette branche. Toute autre RPC/policy encore batie dessus a probablement le meme trou. Corriger
-- is_club_member() directement aurait une portee bien plus large (RLS sur plusieurs tables) et
-- merite sa propre revue, pas un correctif de bord glisse ici.

create or replace function public.media_club_galleries(p_club_id uuid)
returns table(album_id uuid, titre text, equipe text, event_date date, cover_url text, photos integer, publie boolean, liens jsonb)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Membre reel OU staff SportVision autorise sur ce club (cm_clubs_autorises(), le meme
  -- referentiel que le badge "Gestion SportVision" affiche cote Club+).
  if not (is_club_member(p_club_id) or p_club_id in (select cm_clubs_autorises())) then
    return;
  end if;

  return query
  select a.id, a.title, t.name, a.event_date, a.cover_preview_url,
         (select count(*)::integer from media_assets m where m.album_id = a.id and m.status = 'ready'),
         (a.status = 'published'),
         -- Uniquement les liens explicitement confies au club. Le lien « equipe adverse » et les
         -- liens internes restent chez SportVision.
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'label', l.label, 'audience', l.audience, 'slug', l.slug, 'token', l.token,
             'is_enabled', l.is_enabled
           ) order by l.created_at)
           from media_album_links l
           where l.album_id = a.id and l.visible_in_clubplus
         ), '[]'::jsonb)
  from media_albums a
  left join club_teams t on t.id = a.team_id
  where a.club_id = p_club_id and a.status = 'published'
  order by a.event_date desc nulls last, a.created_at desc;
end;
$function$;
