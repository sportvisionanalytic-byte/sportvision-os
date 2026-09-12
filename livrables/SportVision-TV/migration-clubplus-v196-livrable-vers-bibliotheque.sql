-- v196 — Un livrable livré rejoint la bibliothèque du club (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. Le club voit bien ses livrables de production : la vue
-- `club_media_livrables` joint `media_livrables` → `prestations` → `clubs.portail_client_id`, et
-- Club+ la lit. Mais cette vue exige `is_club_member(club_id)`, et une famille n'est jamais
-- membre du club. La seule table qu'une famille peut lire, `club_media`, n'avait AUCUN écrivain :
-- ni applicatif, ni SQL, ni déclencheur. L'écran « Mes contenus » de l'espace joueur était donc
-- vide par construction, et le serait resté quoi qu'on livre.
--
-- Et le blocage était plus profond qu'un écran vide : `media_access_rules`, la table qui ouvre un
-- média à une famille, n'accepte que `club_media` et `club_creations`. Un livrable ne pouvait
-- donc même pas se voir accorder une visibilité famille. La chaîne s'arrêtait là.
--
-- CE QUE FAIT CETTE MIGRATION. Au passage en « livré », le livrable devient un média du club,
-- avec son lien, son équipe quand elle est identifiable, et la mention SportVision. Il apparaît
-- alors dans la bibliothèque et, surtout, il devient un objet auquel le club PEUT accorder une
-- visibilité famille avec l'écran qui existe déjà.
--
-- Ce que cette migration ne fait délibérément PAS : ouvrir automatiquement le livrable aux
-- familles. C'est le club qui décide qui voit quoi — c'est vrai pour le droit à l'image, et
-- c'était déjà la règle « pas de règle = pas de diffusion » (v18). On rend le geste possible,
-- on ne le prend pas à sa place.
--
-- Les liens de travail (rushs, dépôt, fichiers de travail) sont exclus, exactement comme la vue.
-- Idempotente, et sans effet rétroactif sur ce qui est déjà livré.

create or replace function public.publier_livrable_dans_bibliotheque()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_club uuid;
  v_equipes text;
  v_url text;
  v_categorie text;
  v_type text;
begin
  -- Uniquement au moment où le livrable devient livré.
  if new.statut <> 'livre' or (tg_op = 'UPDATE' and old.statut = 'livre') then
    return new;
  end if;

  select cl.id, p.equipes into v_club, v_equipes
    from prestations p
    join clubs cl on cl.portail_client_id = p.client_id
   where p.id = new.prestation_id;
  if v_club is null then return new; end if;

  select ml.url, ml.categorie into v_url, v_categorie from media_liens ml where ml.id = new.lien_id;
  if v_categorie is not null and v_categorie in ('rushs', 'travail', 'depot') then
    return new;
  end if;

  -- club_media ne connaît que cinq types ; le catalogue des livrables en a quatorze.
  v_type := case
    when new.type_livrable in ('galerie_photo', 'photos_finales', 'affiche', 'carrousel', 'miniature') then 'photo'
    when new.type_livrable in ('video_finale', 'highlight', 'aftermovie', 'interview', 'reels', 'tiktok', 'story') then 'video'
    else 'document'
  end;

  if exists (select 1 from club_media m
              where m.club_id = v_club and m.title = new.nom
                and m.source = 'sportvision'
                and coalesce(m.link, '') = coalesce(v_url, '')) then
    return new;
  end if;

  -- Et on prévient le club. Jusqu'ici, RIEN ne le faisait : `notifier_livraison_recue` prévient
  -- la PRODUCTION, pas le client, et `notify_media_livraison_envoyee` n'envoie un e-mail que si
  -- un humain crée à la main une ligne `media_livraisons` — table à zéro ligne, en écriture
  -- seule, jamais relue par aucun écran. Le club découvrait ses livraisons en allant voir.
  insert into club_media (club_id, title, type, team, source, link, expired)
  values (
    v_club,
    new.nom,
    v_type,
    -- `equipes` est une liste séparée par des virgules. Une seule équipe nommée : on la porte, et
    -- le périmètre d'un encadrant s'applique. Plusieurs, ou aucune : le média est du club entier.
    case when v_equipes is not null and position(',' in v_equipes) = 0
         then nullif(btrim(v_equipes), '') end,
    'sportvision',
    v_url,
    false
  );

  perform notify_client_members(
    (select p.client_id from prestations p where p.id = new.prestation_id),
    'content',
    'Nouveau contenu livré',
    new.nom || ' est disponible dans votre bibliothèque.',
    '/content'
  );

  return new;
end $$;

drop trigger if exists trg_livrable_vers_bibliotheque on media_livrables;
create trigger trg_livrable_vers_bibliotheque
  after insert or update of statut on media_livrables
  for each row execute function publier_livrable_dans_bibliotheque();
