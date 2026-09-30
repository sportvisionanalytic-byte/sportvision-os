-- v372 — Les notifications sortent enfin du téléphone fermé (30/09/2026)
--
-- LE DÉFAUT, ET IL EST PLUS GROS QU'IL N'EN A L'AIR
--
-- Une ligne de `notifications` ne se voit qu'en OUVRANT l'application. Personne n'est prévenu de
-- rien. Une proposition de mission envoyée un vendredi soir reste invisible jusqu'à ce que
-- l'opérateur pense à regarder — et `send_prestation_reminders()`, la relance automatique, écrit
-- elle aussi dans `notifications` : elle relance dans le vide.
--
-- Les clés APNs existent depuis longtemps (équipe H2J6ZBKXQD, la même qui signe les applications)
-- et n'ont jamais été branchées à quoi que ce soit.
--
-- CE QUE CETTE MIGRATION POSE, ET CE QU'ELLE NE FAIT PAS
--
-- Elle pose la plomberie côté base : les appareils, le choix de ce qui pousse, et la file. Elle
-- n'envoie rien — c'est l'affaire de la fonction `envoyer-push`, qui parle à Apple.
--
-- LE CHOIX DE CE QUI POUSSE VIT EN BASE, PAS DANS LE CODE. Décision du 30/09 : on ne pousse que ce
-- qui est urgent et daté. Mais la liste est une TABLE : élargir demain est une ligne à changer, pas
-- un build à refaire et à faire relire par Apple. Les dix-sept types existants y sont TOUS écrits,
-- même ceux qu'on ne pousse pas — une absence se lit « ça n'existe pas », un `false` se lit « on a
-- décidé que non ».

begin;

-- ── Les appareils ────────────────────────────────────────────────────────────────────────────
-- Un jeton APNs appartient à un COUPLE (personne, appareil), et il change : réinstallation,
-- restauration, mise à jour du système. On ne le remplace donc pas, on en garde plusieurs et on
-- éteint ceux qu'Apple déclare morts (410 Gone).
create table if not exists public.appareils_push (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  jeton text not null,
  plateforme text not null default 'ios' check (plateforme in ('ios','android')),
  -- De quelle application vient ce jeton. Les deux applications ont des identifiants de paquet
  -- différents, donc des `apns-topic` différents : sans cette colonne, on enverrait la mission
  -- d'un opérateur au téléphone d'une famille.
  application text not null check (application in ('os','familles')),
  actif boolean not null default true,
  raison_inactif text,
  vu_le timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (jeton, application)
);

create index if not exists appareils_push_user_actif on public.appareils_push (user_id) where actif;

alter table public.appareils_push enable row level security;

-- Chacun gère SES appareils, et personne d'autre. Un jeton de push est un moyen d'écrire sur
-- l'écran verrouillé de quelqu'un : ça ne se lit ni ne s'écrit de l'extérieur.
drop policy if exists appareils_push_lire_les_siens on public.appareils_push;
create policy appareils_push_lire_les_siens on public.appareils_push
  for select to authenticated using (user_id = auth.uid());

drop policy if exists appareils_push_ecrire_les_siens on public.appareils_push;
create policy appareils_push_ecrire_les_siens on public.appareils_push
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists appareils_push_maj_les_siens on public.appareils_push;
create policy appareils_push_maj_les_siens on public.appareils_push
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists appareils_push_supprimer_les_siens on public.appareils_push;
create policy appareils_push_supprimer_les_siens on public.appareils_push
  for delete to authenticated using (user_id = auth.uid());

-- ── Ce qui pousse, et ce qui ne pousse pas ───────────────────────────────────────────────────
create table if not exists public.push_reglages (
  type text primary key,
  pousser boolean not null default false,
  libelle text not null,
  pourquoi text
);

alter table public.push_reglages enable row level security;
-- Lecture ouverte au personnel : un écran de réglages doit pouvoir montrer la liste. L'écriture
-- reste à l'administration, par l'absence de policy d'écriture — personne ne modifie ça depuis un
-- navigateur.
drop policy if exists push_reglages_lecture_staff on public.push_reglages;
create policy push_reglages_lecture_staff on public.push_reglages
  for select to authenticated using (is_staff());

insert into public.push_reglages (type, pousser, libelle, pourquoi) values
  ('invitation',                 true,  'Proposition de mission',        'Datée, et elle attend une réponse.'),
  ('nouvelle_mission',           true,  'Nouvelle mission',              'Datée, et elle attend une réponse.'),
  ('mission_non_acceptee',       true,  'Relance sur une mission',       'La relance sans push relançait dans le vide.'),
  ('mission_non_acceptee_prod',  true,  'Personne n''a répondu',         'La production doit trouver quelqu''un d''autre, vite.'),
  ('rappel_prestation',          true,  'Rappel avant une prestation',   'On le lit la veille au soir, pas dans l''application.'),
  ('changement_planning_cm',     true,  'Changement de planning',        'Un horaire qui bouge et qu''on ignore, c''est un déplacement pour rien.'),
  ('correction_demandee',        true,  'Correction demandée',           'Elle bloque la clôture, donc le versement.'),
  ('arrivee_non_confirmee',      true,  'Arrivée non confirmée',         'La production doit savoir tout de suite si personne n''est sur place.'),
  ('livraison_a_faire',          false, 'Livraison à faire',             'Utile, mais pas à l''heure près.'),
  ('livraison_recue',            false, 'Livraison reçue',               'Information, pas action.'),
  ('livraison_validee',          false, 'Livraison validée',             'Information, pas action.'),
  ('mission_verdict',            false, 'Verdict sur une mission',       'Se lit à l''ouverture.'),
  ('kit_a_preparer',             false, 'Kit à préparer',                'Se lit à l''ouverture.'),
  ('presence_evenement_modifie', false, 'Présence modifiée',             'Se lit à l''ouverture.'),
  ('palier_pole',                false, 'Palier de pôle atteint',        'Information, pas action.'),
  ('tache',                      false, 'Tâche',                         'Se lit à l''ouverture.'),
  ('systeme',                    false, 'Message système',               '383 lignes à ce jour : pousser ça, c''est faire désinstaller l''application.')
on conflict (type) do nothing;

-- ── La file d'envoi ──────────────────────────────────────────────────────────────────────────
-- Une file en base, comme `notification_outbox` pour les e-mails : pas de service à opérer, et
-- une trace de chaque tentative. La fonction `envoyer-push` la vide.
create table if not exists public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete cascade,
  appareil_id uuid not null references public.appareils_push(id) on delete cascade,
  titre text not null,
  message text not null,
  donnees jsonb not null default '{}'::jsonb,
  etat text not null default 'en_attente' check (etat in ('en_attente','envoye','echec','abandonne')),
  tentatives int not null default 0,
  prochaine_tentative_le timestamptz not null default now(),
  derniere_erreur text,
  envoye_le timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists push_outbox_a_traiter on public.push_outbox (prochaine_tentative_le)
  where etat = 'en_attente';

alter table public.push_outbox enable row level security;
-- AUCUNE policy : la file n'est lue et écrite que par le rôle de service, depuis la fonction
-- d'envoi. Personne n'a à lire ce qui part sur l'écran verrouillé des autres.

-- ── Le déclencheur ───────────────────────────────────────────────────────────────────────────
create or replace function public.mettre_en_file_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pousser boolean;
  v_appareil record;
begin
  -- UN TYPE INCONNU NE POUSSE PAS. C'est volontaire : le jour où quelqu'un ajoute un type de
  -- notification sans y penser, il n'ira pas réveiller dix-huit personnes par accident. Il
  -- apparaîtra dans `push_reglages` à `false` par le rattrapage ci-dessous, et on décidera.
  select pousser into v_pousser from push_reglages where type = new.type;
  if not coalesce(v_pousser, false) then
    return new;
  end if;

  for v_appareil in
    select id from appareils_push where user_id = new.destinataire_id and actif
  loop
    insert into push_outbox (notification_id, appareil_id, titre, message, donnees)
    values (new.id, v_appareil.id, new.titre, new.message,
            jsonb_build_object('type', new.type,
                               'notification_id', new.id,
                               'prestation_id', new.prestation_id));
  end loop;

  return new;
end;
$function$;

drop trigger if exists trg_mettre_en_file_push on public.notifications;
create trigger trg_mettre_en_file_push
  after insert on public.notifications
  for each row execute function public.mettre_en_file_push();

-- Rattrapage : tout type qui apparaît sans avoir été déclaré se range ici à `false`, pour qu'on
-- le voie et qu'on tranche, plutôt qu'il disparaisse.
create or replace function public.declarer_type_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into push_reglages (type, pousser, libelle, pourquoi)
  values (new.type, false, new.type, 'Type apparu sans avoir été déclaré. À trancher.')
  on conflict (type) do nothing;
  return new;
end;
$function$;

drop trigger if exists trg_declarer_type_push on public.notifications;
create trigger trg_declarer_type_push
  after insert on public.notifications
  for each row execute function public.declarer_type_push();

commit;
