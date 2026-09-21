-- Les appareils qui recevront les notifications de l'application (22/09/2026)
--
-- POURQUOI. Apple rejette les applications qui ne sont qu'un site web emballé (règle 4.2), et
-- c'est exactement ce qu'est la nôtre aujourd'hui. Les notifications push sont la fonction native
-- la plus utile chez nous — « les photos du match sont en ligne », « votre coach a confirmé
-- l'horaire », « trois matchs attendent votre confirmation » — et la plus facile à défendre en
-- revue : elle sert le métier, elle n'est pas là pour cocher une case.
--
-- CE QUE CETTE TABLE EST, ET N'EST PAS. Elle ne remplace pas la file d'envoi existante
-- (notification_outbox, qui gère déjà l'e-mail) : elle dit seulement OÙ joindre une personne sur
-- son téléphone. Le jour où un envoi push part, il lira ici.
--
-- UN JETON N'EST PAS UNE DONNÉE ANODINE : il permet d'écrire sur l'écran de quelqu'un. Personne
-- ne lit ni n'écrit le jeton d'un autre, pas même le staff SportVision — un envoi se fait par une
-- fonction serveur, jamais en lisant la table depuis un écran.

begin;

create table if not exists public.appareils_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'ios' | 'android'. Le jeton n'a de sens que rapporté à sa plateforme : le même texte ne
  -- s'envoie pas au même service.
  plateforme text not null check (plateforme in ('ios', 'android')),
  jeton text not null,
  -- Ce que l'appareil exécutait la dernière fois qu'il s'est signalé. Sert à comprendre un
  -- incident qui ne toucherait qu'une version.
  app_version text,
  modele text,
  -- Le silence, appareil par appareil. Quelqu'un peut vouloir les notifications sur son
  -- téléphone et pas sur sa tablette.
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  vu_le timestamptz not null default now(),
  unique (jeton)
);

create index if not exists appareils_notifications_user_idx
  on appareils_notifications (user_id) where actif;

comment on table public.appareils_notifications is
  'Les appareils joignables par notification. Un jeton permet d''écrire sur l''écran de '
  'quelqu''un : personne ne lit celui d''un autre, les envois passent par une fonction serveur.';

alter table public.appareils_notifications enable row level security;
grant select, insert, update, delete on public.appareils_notifications to authenticated;

-- Chacun ne voit que ses propres appareils. Aucune exception, pas même pour le staff : il n'a
-- aucune raison de lire un jeton, et cette table n'a pas d'usage d'écran côté SportVision.
drop policy if exists appareils_les_miens on public.appareils_notifications;
create policy appareils_les_miens on public.appareils_notifications
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ══ S'ANNONCER, OU SE TAIRE ══════════════════════════════════════════════════
-- Appelée au démarrage de l'application, à chaque fois : un jeton change tout seul (réinstallation,
-- restauration de sauvegarde, mise à jour du système). On remplace donc plutôt qu'on n'ajoute,
-- sinon la table se remplirait de jetons morts qui feraient échouer des envois pour rien.
create or replace function public.appareil_enregistrer(
  p_jeton text,
  p_plateforme text,
  p_app_version text default null,
  p_modele text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_jeton), '') = '' then
    raise exception 'Jeton vide.' using errcode = '22023';
  end if;
  if p_plateforme not in ('ios', 'android') then
    raise exception 'Plateforme inconnue : %', p_plateforme using errcode = '22023';
  end if;

  insert into appareils_notifications (user_id, plateforme, jeton, app_version, modele)
  values (auth.uid(), p_plateforme, btrim(p_jeton), p_app_version, p_modele)
  on conflict (jeton) do update
    -- Un même appareil change de main (un téléphone revendu, un compte partagé en famille) :
    -- le jeton suit alors son nouveau propriétaire, et l'ancien cesse d'être joint.
    set user_id = auth.uid(), plateforme = excluded.plateforme,
        app_version = excluded.app_version, modele = excluded.modele,
        actif = true, vu_le = now()
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.appareil_enregistrer(text, text, text, text) from public;
grant execute on function public.appareil_enregistrer(text, text, text, text) to authenticated;

create or replace function public.appareil_retirer(p_jeton text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then return false; end if;
  update appareils_notifications set actif = false, vu_le = now()
   where jeton = btrim(p_jeton) and user_id = auth.uid();
  return found;
end $$;

revoke all on function public.appareil_retirer(text) from public;
grant execute on function public.appareil_retirer(text) to authenticated;

commit;
