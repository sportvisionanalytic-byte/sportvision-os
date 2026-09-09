-- Qui couvre ce match : à la demande, pour les rôles internes, et rien de plus.
--
-- Fouka, 09/09/2026 : « je le veux, mais pas pour tout le monde et pas au prix d'alourdir toute la
-- requête calendrier ».
--
-- ── Pourquoi une fonction à part, et non une colonne de plus dans club_calendrier ──
-- Remonter l'opérateur dans le calendrier obligerait à joindre, POUR CHAQUE ÉVÉNEMENT AFFICHÉ :
-- présence → prestation → équipe de prestation → profil. Un mois de Villemomble, c'est un millier
-- d'occurrences ; on paierait quatre jointures sur mille lignes pour un prénom qu'on lit dans une
-- fiche ouverte de temps en temps. Ici, une requête supplémentaire uniquement quand quelqu'un
-- ouvre un match couvert.
--
-- ── Qui a le droit de voir un nom ──
-- Les rôles internes SportVision seulement : admin, com, sec, cm, prod. Un président ou un coach
-- de club n'obtient rien de cette fonction — son écran affiche « Équipe SportVision affectée ».
-- Ils n'ont pas besoin de savoir quel intervenant est positionné, et Club+ n'a pas à devenir le
-- planning RH de SportVision. Si l'on décide un jour d'afficher « votre photographe : X », ce sera
-- une décision produit, pas l'effet collatéral d'une jointure.
--
-- Un CM reste cloisonné à ses clubs : même contrôle de périmètre que cm_definir_couverture.
--
-- ── Ce qui ne sort JAMAIS ──
-- prestations_equipe porte la rémunération, les frais kilométriques, les heures déclarées et le
-- statut de paiement. Rien de tout cela ne quitte l'OS. Cette fonction ne renvoie que le prénom,
-- le nom, la fonction sur la mission, la responsabilité et l'état de la réponse. Le téléphone et
-- l'e-mail personnels ne sont pas davantage exposés : pour joindre quelqu'un, on passe par l'OS.

begin;

create or replace function public.couverture_operateurs(p_ref text)
returns table (
  prenom text,
  nom text,
  fonction text,
  responsable boolean,
  reponse text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_genre text;
  v_club uuid;
  v_prestation uuid;
begin
  -- ── Le rôle, avant tout le reste ──
  -- `is_staff()` inclut encore le rôle `cm` (dette connue) : on nomme donc explicitement les rôles
  -- autorisés plutôt que de s'y fier, comme on l'a fait pour cm_client_logo_maj.
  if not exists (
    select 1 from profiles p
     where p.id = auth.uid() and p.role in ('admin','com','sec','cm','prod')
  ) then
    -- Pas une erreur : un président de club appellera peut-être cette fonction par le même écran.
    -- On ne lui dit pas « interdit », on ne lui dit rien — l'interface affichera l'état générique.
    return;
  end if;

  v_genre := split_part(p_ref, ':', 1);

  if v_genre = 'match' then
    select m.club_id into v_club from club_matches m
     where m.id = nullif(split_part(p_ref, ':', 2), '')::uuid;
  elsif v_genre = 'entrainement' then
    select t.club_id into v_club
      from club_team_training_slots s join club_teams t on t.id = s.team_id
     where s.id = nullif(split_part(p_ref, ':', 2), '')::uuid;
  elsif v_genre = 'evenement' then
    select e.club_id into v_club from club_calendar_events e
     where e.id = nullif(split_part(p_ref, ':', 2), '')::uuid;
  else
    return;
  end if;

  if v_club is null then return; end if;

  -- Un CM ne voit que les clubs qui lui sont confiés, ici comme partout ailleurs.
  if not (v_club in (select cm_clubs_autorises()) or exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','com','sec','prod')
  )) then
    return;
  end if;

  -- La présence porte la prestation créée quand la mission a été montée. Tant qu'elle est nulle,
  -- la couverture est décidée mais personne n'est encore affecté : l'appel ne renvoie aucune
  -- ligne, et l'écran dit « opérateur en cours d'affectation ».
  select pp.created_prestation_id into v_prestation
    from planned_presences pp
   where (pp.occurrence_ref = p_ref
          or (v_genre = 'match' and pp.match_id = nullif(split_part(p_ref, ':', 2), '')::uuid))
     and coalesce(pp.statut, 'prevu') <> 'annule'
   limit 1;

  if v_prestation is null then return; end if;

  return query
    -- `pe.statut` est un enum (statut_affectation), pas du texte : sans ce cast, la fonction
    -- echouait des qu'elle avait une ligne a rendre — invisible tant que les essais renvoyaient
    -- zero ligne, trouve en montant un vrai jeu de donnees.
    select pr.prenom, pr.nom, pe.fonction, coalesce(pe.est_responsable, false), pe.statut::text
      from prestations_equipe pe
      join profiles pr on pr.id = pe.collaborateur_id
     where pe.prestation_id = v_prestation
       -- Un refus, un remplacement ou une annulation ne sont PAS des affectations : les afficher
       -- ferait croire que quelqu'un vient. Les valeurs sont celles de l'enum statut_affectation
       -- (invitation_envoyée, en_attente, acceptée, refusée, remplacée, annulée) — je les avais
       -- d'abord écrites au jugé (« refuse »), et le test a montré qu'un refus passait.
       and coalesce(pe.statut::text, 'en_attente') not in ('refusée', 'remplacée', 'annulée')
     order by coalesce(pe.est_responsable, false) desc, pr.prenom;
end
$function$;

comment on function public.couverture_operateurs(text) is
  'Qui couvre un événement du calendrier, chargé à la demande depuis la fiche. Réservé aux rôles internes SportVision (admin, com, sec, cm, prod) et, pour un CM, à ses clubs. Ne renvoie ni rémunération, ni frais, ni coordonnées : ces données ne quittent pas l''OS. Renvoie zéro ligne — et non une erreur — quand l''appelant n''y a pas droit ou qu''aucun opérateur n''est encore affecté, pour que l''écran affiche un état générique sans traiter un cas d''erreur.';

revoke all on function public.couverture_operateurs(text) from public;
grant execute on function public.couverture_operateurs(text) to authenticated;

commit;
