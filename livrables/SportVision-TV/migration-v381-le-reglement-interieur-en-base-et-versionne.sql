-- v381 — LE RÈGLEMENT INTÉRIEUR EN BASE, ET VERSIONNÉ (01/10/2026)
--
-- ═══ LE PROBLÈME ═══════════════════════════════════════════════════════════════════════════════
--
-- Fouka, ce matin : « Le Centre SportVision c'est pareil, on peut pas lire, accepter les trucs, on
-- peut rien cliquer. »
--
-- Mesuré le 01/10/2026 :
--
--   · `centre_validations` : 81 lignes. 9 chapitres, 9 personnes, toutes en version « 1.0 ». La
--     table de l'ACCEPTATION existe donc, et elle est déjà versionnée : un index unique
--     `(collaborateur_id, chapitre_id, version)`.
--   · Le TEXTE de ces 9 chapitres n'existe nulle part en base. Il vit dans `SV_REGLEMENT`, dans
--     `SportVision-OS-Full.html` : 9 chapitres, 27 sections, 116 points.
--
-- Autrement dit : on a enregistré 81 acceptations d'un texte que la base ne détient pas. Si le
-- HTML change demain, personne ne peut plus dire ce qui a été accepté. C'est exactement le défaut
-- que l'application a refusé de contourner : `src/lib/os-centre.ts` dit, en toutes lettres, qu'il
-- n'affiche PAS de bouton « Accepter » parce qu'« une case cochée sur un texte qu'on ne peut pas
-- lire n'est pas un consentement ». Il avait raison. Cette migration lui donne le texte.
--
-- ═══ CE QUE FAIT CETTE MIGRATION ═══════════════════════════════════════════════════════════════
--
-- 1. `centre_reglement_chapitres` — les 9 chapitres, leur numéro, leur titre, leur VERSION.
-- 2. `centre_reglement_sections` — les 27 sections et leurs 116 points.
-- 3. Une clé étrangère de `centre_validations.chapitre_id` vers ces chapitres : on ne peut plus
--    accepter un chapitre qui n'existe pas. Les 81 lignes existantes la passent, vérifié avant
--    d'écrire : les 9 `chapitre_id` distincts sont exactement les 9 identifiants de `SV_REGLEMENT`.
-- 4. Un déclencheur qui REFUSE une acceptation dont la version n'est pas celle EN VIGUEUR.
--
-- ═══ POURQUOI CE DÉCLENCHEUR, ET PAS UN DÉFAUT ═════════════════════════════════════════════════
--
-- Deux façons de rater ce point, écartées toutes les deux :
--
--   · Une valeur par défaut `'1.0'` : le jour où le règlement passe en 1.1, tout le monde continue
--     d'accepter « 1.0 » sans le savoir. La colonne existerait, elle ne dirait plus rien.
--   · Un déclencheur qui ÉCRASE la version par celle en vigueur : si le texte est republié entre
--     le moment où l'écran l'affiche et celui où on appuie, on enregistrerait l'acceptation de la
--     1.1 pour un texte lu en 1.0. C'est un faux consentement, et silencieux.
--
-- On refuse donc, avec un message qui dit quoi faire. L'écran renvoie la version qu'il a AFFICHÉE ;
-- si elle n'est plus en vigueur, l'insertion échoue et l'écran recharge le texte. Une acceptation
-- en base est alors une preuve : cette personne a vu CE texte-là.
--
-- ═══ LE TEXTE EST VERSÉ MOT POUR MOT, Y COMPRIS CE QUI DOIT CHANGER ════════════════════════════
--
-- ⚠️ À DÉCIDER PAR FOUKA, SIGNALÉ ET NON TRANCHÉ ICI. Le chapitre 9 s'intitule « Sanctions &
-- Pénalités », et son contenu emploie « pénalités » deux fois : le titre de section « Barème des
-- pénalités (photographes / vidéastes — système XP) » et le point « Les pénalités XP sont
-- appliquées via le module XP de l'OS ». Or les 18 collaborateurs sont des FREELANCES, et le mot
-- « pénalité » est proscrit dans toute la chaîne.
--
-- Cette migration NE LE CORRIGE PAS, et c'est délibéré. Neuf personnes ont accepté la version
-- « 1.0 » de ce texte. Réécrire les mots d'un texte accepté en gardant son numéro de version, c'est
-- précisément le défaut que la migration ferme. Le texte descend donc tel quel en 1.0, et la
-- correction appartient à une version 1.1 décidée par Fouka.
--
-- Proposition, pour qu'il n'ait qu'à dire oui ou non :
--   · titre du chapitre       « Sanctions & Pénalités »  →  « Sanctions et ajustements »
--   · titre de la section     « Barème des pénalités (photographes / vidéastes, système XP) »
--                             →  « Barème des ajustements (photographes / vidéastes, système XP) »
--   · le point de procédure   « Les pénalités XP sont appliquées… »
--                             →  « Les ajustements d'XP sont appliqués… »
-- Publier cette 1.1 redemandera l'acceptation des neuf personnes sur ce chapitre. C'est le prix
-- d'un règlement versionné, et c'est le bon.
--
-- Quatre points du chapitre 3 et un titre de section du chapitre 9 contiennent un tiret long
-- (« Disponible — vous pouvez être affecté »). Même raisonnement : on ne réécrit pas en 1.0 un
-- texte accepté. À reprendre dans la même 1.1, avec une virgule ou deux points.
--
-- Le préfixe « Chapitre N — » des neuf titres, lui, n'est PAS du texte : c'est de la numérotation.
-- Il est rangé dans la colonne `numero`, et le titre garde ses mots exacts sans le tiret. L'écran
-- affiche « Chapitre 1 · Respect et comportement » sans avoir rien inventé.
--
-- ═══ CE QUE ÇA NE CHANGE PAS ═══════════════════════════════════════════════════════════════════
--
-- RIEN DANS L'OS, qui porte toujours `SV_REGLEMENT` en dur et n'écrit dans `centre_validations`
-- que `chapitre_id` et `version` — les deux colonnes que le déclencheur contrôle, avec la valeur
-- « 1.0 », celle en vigueur. Vérifié : le déclencheur laisse passer ce que l'OS envoie aujourd'hui.
-- `centre_ressources` (12 fiches) n'est pas touchée.
--
-- ═══ APRÈS APPLICATION ═════════════════════════════════════════════════════════════════════════
--
-- Dans `SportVision-OS-Full.html`, remplacer `SV_REGLEMENT` par une lecture de
-- `centre_reglement_chapitres` / `centre_reglement_sections`. NON FAIT ici.

begin;

-- ── 1. Les chapitres ──────────────────────────────────────────────────────────────────────────

create table if not exists public.centre_reglement_chapitres (
  -- L'identifiant que `centre_validations.chapitre_id` enregistre déjà sur 81 lignes.
  id         text primary key,
  numero     integer not null unique check (numero > 0),
  -- Le titre SANS le préfixe « Chapitre N — » : celui-là est dans `numero`.
  titre      text not null,
  icone      text,
  -- LA VERSION EN VIGUEUR. La changer redemande l'acceptation : c'est le but.
  version    text not null,
  ordre      integer not null,
  publie     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.centre_reglement_chapitres is
  'Les chapitres du règlement intérieur, avec leur version en vigueur. centre_validations trace qui a accepté quelle version (v381).';
comment on column public.centre_reglement_chapitres.version is
  'La version en vigueur. Un déclencheur sur centre_validations refuse toute acceptation qui ne la cite pas : on sait donc toujours quel texte a été accepté.';

-- ── 2. Les sections ───────────────────────────────────────────────────────────────────────────

create table if not exists public.centre_reglement_sections (
  id          uuid primary key default gen_random_uuid(),
  chapitre_id text not null references public.centre_reglement_chapitres(id) on delete cascade,
  ordre       integer not null check (ordre >= 0),
  titre       text not null,
  -- Les puces, dans l'ordre. Un tableau et non une table : ce sont des lignes de texte qu'on lit
  -- ensemble et qu'on ne cherche jamais séparément, comme `centre_ressources.roles_cibles`.
  points      text[] not null check (cardinality(points) > 0),
  created_at  timestamptz not null default now(),
  unique (chapitre_id, ordre)
);

-- ── 3. Le contenu ─────────────────────────────────────────────────────────────────────────────

insert into public.centre_reglement_chapitres (id, numero, titre, icone, version, ordre) values
  ('comportement', 1, 'Respect et comportement', '🤝', '1.0', 0),
  ('ponctualite', 2, 'Ponctualité', '⏱️', '1.0', 1),
  ('disponibilites', 3, 'Disponibilités et absences', '📅', '1.0', 2),
  ('tenue', 4, 'Tenue et présentation', '👔', '1.0', 3),
  ('clients', 5, 'Relation avec les clients', '🤝', '1.0', 4),
  ('confidentialite', 6, 'Confidentialité et propriété', '🔒', '1.0', 5),
  ('materiel', 7, 'Matériel et kits', '📷', '1.0', 6),
  ('communication', 8, 'Communication interne', '💬', '1.0', 7),
  ('sanctions', 9, 'Sanctions & Pénalités', '⚠️', '1.0', 8)
on conflict (id) do update set
  numero = excluded.numero, titre = excluded.titre, icone = excluded.icone, ordre = excluded.ordre;

insert into public.centre_reglement_sections (chapitre_id, ordre, titre, points) values
  ('comportement', 0, 'Obligations',
    array[
     'Respecter les clients, joueurs, parents, coachs et organisateurs',
     'Adopter une communication professionnelle à tout moment',
     'Appliquer les consignes du responsable de prestation',
     'Protéger l''image de SportVision par votre attitude',
     'Signaler tout comportement inadapté via SportVision OS'
    ]::text[]),
  ('comportement', 1, 'Interdictions strictes',
    array[
     'Insultes, harcèlement, violence ou discrimination',
     'Comportement dangereux sur les lieux de prestation',
     'Travail sous l''influence d''alcool ou de substances',
     'Dégradation volontaire du matériel',
     'Diffusion d''informations confidentielles'
    ]::text[]),
  ('comportement', 2, 'Signalement',
    array[
     'Toute situation grave doit être déclarée dans SportVision OS via la section Incidents',
     'Le Responsable Production et l''Administrateur sont alertés automatiquement',
     'Un incident peut déclencher un entretien ou une procédure selon son contexte'
    ]::text[]),
  ('ponctualite', 0, 'Principe fondamental',
    array[
     'Être à l''heure ne signifie pas arriver exactement à l''heure prévue',
     'Vous devez être présent, prêt, équipé, briefé et disponible à l''heure de début',
     'La ponctualité est une obligation professionnelle, pas une option'
    ]::text[]),
  ('ponctualite', 1, 'Marges recommandées',
    array[
     'Responsable de prestation → 30 minutes avant',
     'Photographe / Vidéaste → 20 minutes avant',
     'Installation technique complexe → 45 à 60 minutes avant',
     'Ces marges s''adaptent selon le lieu, le matériel et la difficulté'
    ]::text[]),
  ('ponctualite', 2, 'En cas de retard prévisible',
    array[
     'Informer le responsable dès que vous identifiez le retard',
     'Indiquer la raison et donner une heure estimée précise',
     'Rester joignable en permanence jusqu''à votre arrivée',
     'Confirmer votre arrivée réelle dans l''OS',
     'Utiliser le bouton « Signaler un retard » dans le Mode Jour J'
    ]::text[]),
  ('ponctualite', 3, 'Traitement des retards',
    array[
     'Les retards sont enregistrés dans l''OS pour analyse',
     'Un nombre élevé de retards génère une alerte Administrateur',
     'L''Administrateur examine la situation globale avant toute décision',
     'Un retard non signalé est plus grave qu''un retard signalé'
    ]::text[]),
  ('disponibilites', 0, 'Mise à jour obligatoire',
    array[
     'Chaque collaborateur doit maintenir ses disponibilités à jour dans l''OS',
     'Une disponibilité ne garantit pas automatiquement une affectation',
     'Un collaborateur indisponible ne peut pas être affecté sans dérogation explicite'
    ]::text[]),
  ('disponibilites', 1, 'Statuts disponibles',
    array[
     'Disponible — vous pouvez être affecté',
     'Disponible avec conditions — précisez la condition',
     'Indisponible — vous ne pouvez pas être affecté',
     'En formation — apprentissage en cours'
    ]::text[]),
  ('disponibilites', 2, 'Engagement et annulation',
    array[
     'Une affectation acceptée crée un engagement professionnel',
     'Un refus doit être signalé rapidement et justifié',
     'Une absence le Jour J est traitée comme un incident grave',
     'Pour annuler : indiquez le motif, la date, un justificatif si possible et votre disponibilité alternative'
    ]::text[]),
  ('tenue', 0, 'Règles vestimentaires',
    array[
     'Porter la tenue SportVision propre et en bon état',
     'Adapter la tenue au sport et à la météo',
     'Chaussures adaptées au terrain',
     'Aucun vêtement avec message ou logo inapproprié',
     'Respecter le dress code indiqué dans le briefing de prestation'
    ]::text[]),
  ('tenue', 1, 'Matériel et équipement',
    array[
     'Matériel rangé et protégé en toutes circonstances',
     'Présentation professionnelle du kit sur le terrain',
     'Aucun objet personnel gênant sur le lieu de prestation'
    ]::text[]),
  ('clients', 0, 'Ce que vous ne devez pas faire',
    array[
     'Négocier un prix ou une condition sur place',
     'Promettre une prestation supplémentaire sans validation',
     'Encaisser personnellement un paiement sans autorisation écrite',
     'Transmettre des informations financières internes',
     'Critiquer SportVision ou un collaborateur devant un client',
     'Publier des contenus sans validation',
     'Accepter un contrat personnel direct avec un client SportVision'
    ]::text[]),
  ('clients', 1, 'Réponse standard aux demandes commerciales',
    array[
     'Si un client vous fait une demande, répondez : « Je transmets votre demande à la personne responsable chez SportVision. »',
     'Puis créez immédiatement une tâche ou une note dans l''OS',
     'Ne prenez jamais d''engagement verbal sans validation'
    ]::text[]),
  ('confidentialite', 0, 'Ce que vous devez protéger',
    array[
     'Données clients et coordonnées personnelles',
     'Prix internes et conditions commerciales',
     'Contrats et documents officiels',
     'Rémunérations de vos collègues',
     'Rushs, photos et vidéos non livrés',
     'Conversations internes'
    ]::text[]),
  ('confidentialite', 1, 'Règles médias strictes',
    array[
     'Interdiction de publier personnellement des rushs ou contenus non validés',
     'Interdiction de conserver des fichiers dans un espace personnel non autorisé',
     'Interdiction de vendre un contenu directement à un tiers',
     'Interdiction de supprimer des fichiers avant confirmation de la sauvegarde'
    ]::text[]),
  ('confidentialite', 2, 'Propriété des contenus',
    array[
     'Tous les contenus créés pour SportVision appartiennent à SportVision jusqu''à livraison contractuelle',
     'Le non-respect de ces règles constitue une faute grave'
    ]::text[]),
  ('materiel', 0, 'Avant la sortie du kit',
    array[
     'Vérifier le contenu complet du kit',
     'Vérifier l''état général de chaque élément',
     'Vérifier les batteries et niveaux de charge',
     'Vérifier les cartes mémoire (capacité disponible)',
     'Signaler toute anomalie dans l''OS avant de partir'
    ]::text[]),
  ('materiel', 1, 'Pendant la prestation',
    array[
     'Protéger le matériel en permanence',
     'Ne jamais laisser le kit sans surveillance',
     'Utiliser uniquement le matériel pour lequel vous êtes certifié',
     'Signaler immédiatement toute panne ou chute'
    ]::text[]),
  ('materiel', 2, 'Après la prestation',
    array[
     'Rendre le kit complet dans les 24h',
     'Remettre chaque élément à sa place dans le kit',
     'Signaler tout dommage même mineur',
     'Confirmer le transfert complet des fichiers',
     'Confirmer le retour dans l''OS'
    ]::text[]),
  ('materiel', 3, 'Incidents matériel',
    array[
     'Toute perte, casse ou élément manquant crée automatiquement un incident',
     'L''incident est notifié au Responsable Production et à l''Administrateur',
     'Un rapport doit être complété dans les 24h'
    ]::text[]),
  ('communication', 0, 'Règles de communication',
    array[
     'Utiliser les conversations liées aux prestations pour les sujets opérationnels',
     'Rester professionnel en toutes circonstances dans les canaux SportVision',
     'Transformer une demande importante en tâche pour la tracer',
     'Éviter les messages personnels dans les canaux professionnels',
     'Ne pas partager d''informations confidentielles dans un mauvais canal'
    ]::text[]),
  ('communication', 1, 'Bonne pratique',
    array[
     'Si vous avez une information importante, créez une tâche plutôt qu''un message',
     'Une tâche est visible, assignée et traçable. Un message peut être oublié.',
     'Pour une urgence Jour J, appelez directement le Responsable de prestation'
    ]::text[]),
  ('sanctions', 0, 'Principes généraux',
    array[
     'Les sanctions sont décidées par l''Administrateur après analyse de la situation',
     'Elles visent à corriger un comportement, pas à punir',
     'Toute sanction est notifiée dans l''OS avec une justification',
     'Le collaborateur peut soumettre une explication écrite dans les 48h'
    ]::text[]),
  ('sanctions', 1, 'Barème des pénalités (photographes / vidéastes — système XP)',
    array[
     'Ce barème en XP concerne uniquement les collaborateurs Photo/Vidéo, seul rôle disposant d''un parcours XP/grade. Pour les autres rôles, les mêmes manquements donnent lieu à un avertissement écrit et un entretien, sans retrait de points.',
     'Retard sur prestation : −50 XP + note écrite',
     'Absence non justifiée non prévenue : −150 XP + avertissement',
     'Retard livraison contenu : −30 XP par jour de retard',
     'Mauvais comportement terrain / pas de tenue SportVision : −80 XP',
     'Casse matériel par négligence : −200 XP + remboursement partiel selon évaluation',
     'Refus d''une mission sans motif valide : −50 XP',
     'Partage non autorisé de contenu client : avertissement grave + possible exclusion'
    ]::text[]),
  ('sanctions', 2, 'Procédure',
    array[
     'L''Administrateur ou le Responsable Production constate l''infraction',
     'Un signalement est créé dans l''OS avec date, description et preuves',
     'Le collaborateur concerné est notifié et peut répondre',
     'La décision de sanction est prise dans les 5 jours ouvrés',
     'Les pénalités XP sont appliquées via le module XP de l''OS',
     'Les avertissements s''accumulent : 3 avertissements = entretien disciplinaire'
    ]::text[]),
  ('sanctions', 3, 'Cas d''exclusion',
    array[
     'Une faute grave peut mener à une suspension immédiate sans préavis',
     'La faute grave inclut : violence, discrimination, vol, sabotage, violation grave de confidentialité',
     'L''exclusion est irréversible et peut être accompagnée de poursuites judiciaires'
    ]::text[])
on conflict (chapitre_id, ordre) do update set titre = excluded.titre, points = excluded.points;
-- ── 4. L'acceptation ne peut plus porter sur un chapitre inconnu ──────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'centre_validations_chapitre_fk'
  ) then
    alter table public.centre_validations
      add constraint centre_validations_chapitre_fk
      foreign key (chapitre_id) references public.centre_reglement_chapitres(id) on update cascade;
  end if;
end $$;

-- ── 5. L'acceptation ne peut porter que sur la version EN VIGUEUR ─────────────────────────────

create or replace function public.centre_validation_version_en_vigueur()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_en_vigueur text;
begin
  -- Les validations de ressource (`ressource_id`) ne portent pas de chapitre : rien à contrôler.
  if new.chapitre_id is null then
    return new;
  end if;

  select version into v_en_vigueur
    from public.centre_reglement_chapitres where id = new.chapitre_id;

  if v_en_vigueur is null then
    raise exception 'Chapitre de règlement inconnu : %.', new.chapitre_id using errcode = '23503';
  end if;

  if new.version is null then
    raise exception 'Acceptation sans version : le chapitre « % » est en vigueur en version %. Rechargez le règlement avant de l''accepter.',
      new.chapitre_id, v_en_vigueur using errcode = '22023';
  end if;

  if new.version <> v_en_vigueur then
    raise exception 'Version dépassée : vous acceptez la version % du chapitre « % », or la version en vigueur est la %. Rechargez le règlement pour lire le texte à jour.',
      new.version, new.chapitre_id, v_en_vigueur using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_centre_validation_version on public.centre_validations;
create trigger trg_centre_validation_version
  before insert or update of chapitre_id, version on public.centre_validations
  for each row execute function public.centre_validation_version_en_vigueur();

-- ── 6. Les droits ─────────────────────────────────────────────────────────────────────────────
--
-- LE PERSONNEL LIT, L'ADMINISTRATION ÉCRIT. Un règlement qu'un collaborateur pourrait réécrire
-- avant de l'accepter n'engage personne. `centre_validations` garde sa policy `validations_own`,
-- inchangée : chacun insère la sienne, l'administration et le secrétariat lisent toutes.

alter table public.centre_reglement_chapitres enable row level security;
alter table public.centre_reglement_sections enable row level security;

drop policy if exists reglement_chapitres_lire on public.centre_reglement_chapitres;
create policy reglement_chapitres_lire on public.centre_reglement_chapitres
  for select using (
    (publie and is_staff())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'sec'))
  );

drop policy if exists reglement_chapitres_administrer on public.centre_reglement_chapitres;
create policy reglement_chapitres_administrer on public.centre_reglement_chapitres
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists compte_os_desactive_bloque on public.centre_reglement_chapitres;
create policy compte_os_desactive_bloque on public.centre_reglement_chapitres
  as restrictive for all to authenticated
  using (not (select public.compte_os_desactive()))
  with check (not (select public.compte_os_desactive()));

-- Une section suit son chapitre. Une seconde règle écrite ici finirait par dire autre chose.
drop policy if exists reglement_sections_lire on public.centre_reglement_sections;
create policy reglement_sections_lire on public.centre_reglement_sections
  for select using (
    exists (select 1 from public.centre_reglement_chapitres c where c.id = centre_reglement_sections.chapitre_id)
  );

drop policy if exists reglement_sections_administrer on public.centre_reglement_sections;
create policy reglement_sections_administrer on public.centre_reglement_sections
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists compte_os_desactive_bloque on public.centre_reglement_sections;
create policy compte_os_desactive_bloque on public.centre_reglement_sections
  as restrictive for all to authenticated
  using (not (select public.compte_os_desactive()))
  with check (not (select public.compte_os_desactive()));

drop trigger if exists trg_reglement_chapitres_upd on public.centre_reglement_chapitres;
create trigger trg_reglement_chapitres_upd before update on public.centre_reglement_chapitres
  for each row execute function public.update_updated_at_generic();

-- ── 7. Contrôle ───────────────────────────────────────────────────────────────────────────────

do $$
declare v_orphelins integer; v_vides integer;
begin
  select count(*) into v_orphelins from public.centre_validations v
    where v.chapitre_id is not null
      and not exists (select 1 from public.centre_reglement_chapitres c where c.id = v.chapitre_id);
  if v_orphelins > 0 then
    raise exception '% acceptation(s) portent sur un chapitre absent du règlement versé.', v_orphelins;
  end if;

  select count(*) into v_vides from public.centre_reglement_chapitres c
    where not exists (select 1 from public.centre_reglement_sections s where s.chapitre_id = c.id);
  if v_vides > 0 then
    raise exception '% chapitre(s) sans une seule section : un texte vide ne s''accepte pas.', v_vides;
  end if;
end $$;

commit;

select c.numero, c.titre, c.version,
       (select count(*) from public.centre_reglement_sections s where s.chapitre_id = c.id) as sections,
       (select coalesce(sum(cardinality(s.points)), 0) from public.centre_reglement_sections s where s.chapitre_id = c.id) as points,
       (select count(*) from public.centre_validations v where v.chapitre_id = c.id and v.version = c.version) as acceptations
from public.centre_reglement_chapitres c order by c.numero;
