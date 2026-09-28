-- v331 — Plusieurs photos de référence par sportif (28/09/2026).
--
-- POURQUOI C'EST LE LEVIER. Fouka : « il faut que ça retrouve toutes les photos. » Mesuré sur
-- « RCPF VS PSG U16 » : 183 visages relevés, 12 attribués. Le plafond n'est pas dans les seuils —
-- on les a mesurés un par un — il est dans la MATIÈRE. Une seule photo de référence ne reconnaît
-- que les prises de vue qui lui ressemblent : même angle, même lumière. Deux ou trois photos sous
-- des angles différents font davantage que tous les réglages réunis.
--
-- ET LA BASE ÉTAIT DÉJÀ PRÊTE, À UN DÉTAIL PRÈS. `player_face_refs` n'impose aucune unicité,
-- `visage_reference_ajouter` ajoute au lieu de remplacer, et `visage_rapprocher_direct` fait déjà
-- `min(...) group by player_id` : il retient donc spontanément la meilleure des empreintes. Tout
-- était en place.
--
-- CE QUI BLOQUAIT, ET C'ÉTAIT INVISIBLE. `reconnaissance_joueurs_prets` ne rendait QUE la dernière
-- photo déposée (`order by created_at desc limit 1`), et un drapeau `a_une_empreinte` vrai dès
-- qu'il en existait UNE. Le moteur passait donc son chemin : déposer une deuxième photo ne
-- produisait jamais la deuxième empreinte. La famille pouvait en déposer dix sans rien changer.
--
-- LA CORRECTION tient à une chose : savoir QUELLE photo a produit QUELLE empreinte. Sans ce lien,
-- « reste-t-il une photo à calculer ? » est une question sans réponse.

-- ── Le lien manquant ──────────────────────────────────────────────────────────────────────────
alter table public.visages_reference
  add column if not exists face_ref_id uuid references public.player_face_refs(id) on delete cascade;

-- Une photo ne produit qu'une empreinte par modèle. Partiel : les empreintes anciennes, posées
-- avant ce lien, ont `face_ref_id` à NULL et ne doivent pas se gêner entre elles.
create unique index if not exists idx_visages_reference_par_photo
  on public.visages_reference (face_ref_id, modele) where face_ref_id is not null;

-- ── Qui reste à calculer ──────────────────────────────────────────────────────────────────────
--
-- DROP PUIS CREATE, JAMAIS `create or replace` : le type de retour change, et PostgreSQL refuse.
-- Pire, avec un argument par défaut il aurait SURCHARGÉ au lieu de remplacer, et deux versions
-- auraient coexisté — la leçon du 26/09, payée une fois.
drop function if exists public.reconnaissance_joueurs_prets(uuid);

create function public.reconnaissance_joueurs_prets(p_album_id uuid)
returns table(player_id uuid, joueur text, face_ref_id uuid, chemin_photo text, a_une_empreinte boolean)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_teams uuid[];
begin
  if not peut_marquer_galerie(p_album_id) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  v_teams := public.media_equipes_de_la_galerie(p_album_id);

  -- UNE LIGNE PAR PHOTO DE RÉFÉRENCE, et non plus une par sportif. `a_une_empreinte` dit
  -- désormais si CETTE photo a été calculée, pas si le sportif en a une quelque part : c'est la
  -- seule formulation qui permette d'en ajouter une deuxième.
  return query
  select p.id,
         coalesce(nullif(btrim(p.prenom || ' ' || p.nom), ''), 'Sportif'),
         fr.id,
         fr.storage_path,
         exists (select 1 from visages_reference vr where vr.face_ref_id = fr.id)
    from player_profiles p
    join team_memberships tm on tm.player_id = p.id and tm.statut = 'active'
    -- JOINTURE OUVERTE, ET C'EST ESSENTIEL. Cette fonction ne dit pas seulement « quelles photos
    -- restent a calculer » : elle dit aussi QUI peut etre marque dans cette galerie, et l'OS s'en
    -- sert pour proposer les sportifs. Une jointure stricte faisait disparaitre tout sportif sans
    -- photo de reference — donc plus personne a marquer a la main. Regression attrapee par
    -- galerie-multi-categories-reconnaissance, qui existait justement pour ca.
    left join player_face_refs fr on fr.player_id = p.id
   where coalesce(cardinality(v_teams), 0) > 0
     and tm.team_id = any(v_teams)
     -- L'accord d'abord : un sportif sans consentement n'entre jamais dans le rapprochement.
     and consentement_biometrie_actif(p.id)
   group by p.id, p.prenom, p.nom, fr.id, fr.storage_path, fr.created_at
   order by 2, fr.created_at;
end $function$;

-- ── L'empreinte sait d'où elle vient ──────────────────────────────────────────────────────────
--
-- Même précaution : un quatrième argument avec valeur par défaut SURCHARGERAIT la fonction à trois
-- arguments au lieu de la remplacer, et l'ancienne continuerait de répondre aux anciens appels en
-- posant des empreintes sans lien — donc recalculées à chaque passe, indéfiniment.
drop function if exists public.visage_reference_ajouter(uuid, vector, text);
drop function if exists public.visage_reference_ajouter(uuid, vector, text, uuid);

create function public.visage_reference_ajouter(
  p_player_id uuid, p_empreinte vector, p_modele text, p_face_ref_id uuid default null)
returns uuid
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if not (is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id) or media_upload_staff()) then
    raise exception 'Vous ne pouvez pas enregistrer la reference de ce sportif.' using errcode = '42501';
  end if;
  -- Le consentement d'abord, toujours. Sans lui, aucune empreinte n'entre.
  if not consentement_biometrie_actif(p_player_id) then
    raise exception 'La reconnaissance n''a pas ete autorisee pour ce sportif.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_modele), '') = '' then
    raise exception 'Le modele est obligatoire : deux empreintes de modeles differents ne se comparent pas.' using errcode = '22023';
  end if;
  -- La photo désignée doit bien être celle de ce sportif : sans ce contrôle, on pourrait rattacher
  -- une empreinte à la photo de référence d'un autre enfant.
  if p_face_ref_id is not null and not exists (
       select 1 from player_face_refs fr where fr.id = p_face_ref_id and fr.player_id = p_player_id) then
    raise exception 'Cette photo de reference n''est pas celle de ce sportif.' using errcode = '42501';
  end if;

  insert into visages_reference (player_id, empreinte, modele, origine, ajoute_par, face_ref_id)
  values (p_player_id, p_empreinte, p_modele,
          case when media_upload_staff() and not is_confirmed_parent_of(p_player_id) then 'club' else 'famille' end,
          auth.uid(), p_face_ref_id)
  on conflict (face_ref_id, modele) where face_ref_id is not null do nothing
  returning id into v_id;
  return v_id;
end $function$;

grant execute on function public.reconnaissance_joueurs_prets(uuid) to authenticated;
grant execute on function public.visage_reference_ajouter(uuid, vector, text, uuid) to authenticated;
