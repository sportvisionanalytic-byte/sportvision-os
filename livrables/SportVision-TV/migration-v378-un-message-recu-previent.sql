-- v378 — Un message reçu prévient, et presque tout le reste pousse (01/10/2026)
--
-- ── §1 : UN MESSAGE N'A JAMAIS PRÉVENU PERSONNE ─────────────────────────────────────────────
--
-- Mesuré : `public.messages` n'a AUCUN déclencheur. Un message envoyé à quelqu'un n'écrit rien
-- dans `notifications`, donc ne part en push nulle part. Il n'apparaît que si le destinataire
-- ouvre la messagerie et regarde.
--
-- C'est le seul endroit où un opérateur au bord d'un terrain joint le responsable de production.
-- Demande de Fouka, 01/10 : « dès qu'il y a un message, notification ».
--
-- CE QUE LE DÉCLENCHEUR ÉVITE, ET QUI SE PAIERAIT CHER :
--   · on ne se notifie pas soi-même ;
--   · un message par minute ne fait pas vibrer un téléphone toutes les minutes : la clé
--     d'idempotence porte l'expéditeur, le destinataire et le QUART D'HEURE. Deux messages du même
--     collègue dans le même quart d'heure ne réveillent qu'une fois. La conversation reste
--     complète dans la messagerie, c'est la sonnerie qu'on borne.
--   · le texte affiché est tronqué à 120 caractères : une notification n'est pas un fil de
--     discussion, et l'écran verrouillé d'un téléphone n'est pas privé.
--
-- ── §2 : PRESQUE TOUT POUSSE MAINTENANT ─────────────────────────────────────────────────────
--
-- Le 30/09, on avait limité le push à ce qui est urgent et daté. Fouka en veut plus : « toutes les
-- notifications ». On ouvre donc tout, SAUF `systeme` : 383 lignes à ce jour, c'est-à-dire plus que
-- tous les autres types réunis. Pousser ça, c'est faire désinstaller l'application la première
-- semaine, et perdre du même coup les notifications qui comptent.
--
-- `systeme` se rallume d'une ligne le jour où on le veut :
--     update push_reglages set pousser = true where type = 'systeme';
--
-- C'est précisément pour ça que ce choix vit dans une TABLE et pas dans le code : le changer ne
-- demande ni build, ni relecture Apple.

begin;

-- ── §1 ──────────────────────────────────────────────────────────────────────────────────────
insert into public.push_reglages (type, pousser, libelle, pourquoi) values
  ('message', true, 'Nouveau message', 'Le seul endroit où le terrain joint la production.')
on conflict (type) do update set pousser = true, libelle = excluded.libelle;

create or replace function public.notifier_message_recu()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nom text;
  v_apercu text;
begin
  if new.destinataire_id is null or new.destinataire_id = new.expediteur_id then
    return new;
  end if;

  select trim(coalesce(prenom, '') || ' ' || coalesce(nom, '')) into v_nom
    from profiles where id = new.expediteur_id;

  v_apercu := left(coalesce(new.contenu, ''), 120);
  if length(coalesce(new.contenu, '')) > 120 then
    v_apercu := v_apercu || '…';
  end if;

  insert into notifications (destinataire_id, type, titre, message, priorite, expediteur_id, cle_occurrence)
  values (
    new.destinataire_id, 'message',
    coalesce(nullif(v_nom, ''), 'Nouveau message'),
    coalesce(nullif(v_apercu, ''), 'Vous avez reçu un message.'),
    'normale', new.expediteur_id,
    -- L'expéditeur, le destinataire, et le quart d'heure : une rafale ne sonne qu'une fois.
    'message:' || new.expediteur_id || ':' || new.destinataire_id || ':'
      || to_char(date_trunc('hour', now()), 'YYYY-MM-DD"T"HH24') || ':'
      || lpad((extract(minute from now())::int / 15)::text, 2, '0')
  )
  -- L'index unique sur `cle_occurrence` est PARTIEL (`where cle_occurrence is not null`) : un
  -- `on conflict (cle_occurrence)` tout court est refusé par Postgres, il faut lui redonner le
  -- même prédicat pour qu'il reconnaisse l'index. Découvert en appliquant : le déclencheur
  -- levait 42P10 à chaque message.
  on conflict (cle_occurrence) where cle_occurrence is not null do nothing;

  return new;
end;
$function$;

drop trigger if exists trg_notifier_message_recu on public.messages;
create trigger trg_notifier_message_recu
  after insert on public.messages
  for each row execute function public.notifier_message_recu();

-- ── §2 ──────────────────────────────────────────────────────────────────────────────────────
update public.push_reglages set pousser = true where type <> 'systeme';

commit;
