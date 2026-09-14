-- v222 — Le socle de la reconnaissance des visages, sans serveur (14/09/2026).
--
-- LE BESOIN, tel que Fouka l'a pose : « si je mets par equipe, les parents vont avoir des photos
-- d'autres enfants, il y a des parents qui peuvent etre contre, ou qui peuvent acheter un Pass et
-- faire tourner des photos entre eux. Ce n'est pas le but. » Le cloisonnement strict n'est possible
-- que si la machine identifie les enfants : montrer la galerie a la famille pour qu'elle identifie
-- elle-meme expose precisement ce qu'on veut proteger.
--
-- L'ARCHITECTURE, ET POURQUOI ELLE NE COUTE RIEN.
--   • Le CALCUL de l'empreinte d'un visage se fait dans le NAVIGATEUR du responsable production,
--     au moment ou il verse les photos — exactement comme le filigrane aujourd'hui. Aucun serveur a
--     louer tant que le taux de reconnaissance suffit.
--   • Le STOCKAGE et la COMPARAISON se font ici, avec pgvector. Quelques milliers de visages par
--     saison : une comparaison sequentielle suffit, aucun index specialise n'est necessaire.
--   • La dimension du vecteur n'est pas figee : `vector` sans dimension, plus une colonne `modele`.
--     Passer un jour a un modele serveur plus fin (512 dimensions) n'imposera pas de tout refaire —
--     on compare toujours des empreintes DU MEME modele, jamais deux modeles entre eux.
--
-- CE QUI EST STOCKE, ET CE QUI NE L'EST PAS. On garde l'EMPREINTE, jamais la photo de reference.
-- Une empreinte ne permet pas de reconstituer un visage : c'est la minimisation qui rend ce
-- traitement defendable. La photo envoyee par le parent ne quitte pas son navigateur.
--
-- LE CADRE JURIDIQUE. Une empreinte de visage est une donnee biometrique (article 9 du RGPD) :
-- interdite par principe, sauf consentement explicite. Le registre existe depuis le 12/09
-- (`consentements_biometrie`, avec la version du texte accepte, le retrait et la purge). AUCUNE
-- empreinte ne peut etre posee ici sans consentement en cours : le garde est dans la fonction, pas
-- dans l'ecran.
--
-- Idempotente.

create extension if not exists vector with schema extensions;

-- ── Les empreintes de reference d'un joueur ──────────────────────────────────
create table if not exists public.visages_reference (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  empreinte extensions.vector not null,
  modele text not null,
  -- D'ou vient cette reference : la photo envoyee par la famille, ou une photo de galerie que le
  -- club a confirmee. Sert a savoir ce qu'on purge et ce qu'on peut recalculer.
  origine text not null default 'famille' check (origine in ('famille','club','galerie')),
  -- Un PARENT enregistre l'empreinte de son enfant : il n'a pas de ligne dans `profiles`,
  -- qui est la table des collaborateurs SportVision. On référence donc le compte lui-même.
  ajoute_par uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_visages_reference_player on public.visages_reference(player_id);

comment on table public.visages_reference is
  'v222 — Empreintes de reference d''un joueur (donnee biometrique). Jamais la photo elle-meme. Purgees au retrait du consentement.';

-- ── Les visages detectes sur une photo de galerie ────────────────────────────
create table if not exists public.visages_detectes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  empreinte extensions.vector not null,
  modele text not null,
  -- Position du visage dans l'image, en proportions (0-1) : sert a montrer a un humain CE visage
  -- quand il doit trancher, sans avoir a redetecter.
  boite jsonb,
  qualite numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_visages_detectes_asset on public.visages_detectes(asset_id);

comment on table public.visages_detectes is
  'v222 — Empreintes des visages trouves sur une photo. Effacees avec la photo.';

-- ── Personne ne lit ces tables directement ───────────────────────────────────
-- Aucune policy permissive : l'acces passe exclusivement par les fonctions ci-dessous, qui
-- verifient le consentement et le perimetre. Une table de biometrie lisible, meme par le staff,
-- c'est une fuite qui attend son jour.
alter table public.visages_reference enable row level security;
alter table public.visages_detectes enable row level security;
revoke all on public.visages_reference from authenticated, anon;
revoke all on public.visages_detectes from authenticated, anon;

-- ── Poser une empreinte de reference ─────────────────────────────────────────
create or replace function public.visage_reference_ajouter(
  p_player_id uuid, p_empreinte extensions.vector, p_modele text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
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

  insert into visages_reference (player_id, empreinte, modele, origine, ajoute_par)
  values (p_player_id, p_empreinte, p_modele,
          case when media_upload_staff() and not is_confirmed_parent_of(p_player_id) then 'club' else 'famille' end,
          auth.uid())
  returning id into v_id;
  return v_id;
end $$;

comment on function public.visage_reference_ajouter(uuid, extensions.vector, text) is
  'v222 — Enregistre une empreinte de reference, apres verification du consentement biometrique.';

-- ── Rapprocher un visage detecte des joueurs de l'equipe ─────────────────────
-- On ne compare QUE parmi les joueurs de l'equipe de la galerie : un visage ne peut pas etre
-- rapproche d'un enfant d'un autre club, meme par erreur de calcul.
create or replace function public.visage_rapprocher(p_asset_id uuid, p_seuil numeric default 0.38)
returns table(player_id uuid, distance numeric, certain boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare v_team uuid;
begin
  if not peut_marquer_galerie((select album_id from media_assets where id = p_asset_id)) then
    raise exception 'Non autorise.' using errcode = '42501';
  end if;

  select al.team_id into v_team from media_assets a join media_albums al on al.id = a.album_id
   where a.id = p_asset_id;

  return query
  select r.player_id,
         min(vd.empreinte <=> r.empreinte)::numeric as d,
         min(vd.empreinte <=> r.empreinte) < p_seuil
    from visages_detectes vd
    join visages_reference r on r.modele = vd.modele
   where vd.asset_id = p_asset_id
     and (v_team is null or exists (
           select 1 from team_memberships tm
            where tm.team_id = v_team and tm.player_id = r.player_id and tm.statut = 'active'))
     and consentement_biometrie_actif(r.player_id)
   group by r.player_id
   order by d
   limit 5;
end $$;

comment on function public.visage_rapprocher(uuid, numeric) is
  'v222 — Les joueurs de l''equipe dont l''empreinte est la plus proche d''un visage de cette photo. Ne marque rien : c''est un avis.';

-- ── La purge suit le retrait du consentement ─────────────────────────────────
create or replace function public.purger_visages_du_joueur(p_player_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare n integer;
begin
  delete from visages_reference where player_id = p_player_id;
  get diagnostics n = row_count;
  -- Les marquages issus de la machine partent avec : ils n'ont plus de fondement.
  delete from media_player_tags
   where player_id = p_player_id and source = 'suggestion';
  return n;
end $$;

comment on function public.purger_visages_du_joueur(uuid) is
  'v222 — Efface les empreintes d''un joueur et les marquages qui en decoulaient. Appelee au retrait du consentement.';

revoke all on function public.visage_reference_ajouter(uuid, extensions.vector, text) from public;
revoke all on function public.visage_rapprocher(uuid, numeric) from public;
revoke all on function public.purger_visages_du_joueur(uuid) from public;
grant execute on function public.visage_reference_ajouter(uuid, extensions.vector, text) to authenticated;
grant execute on function public.visage_rapprocher(uuid, numeric) to authenticated;
grant execute on function public.purger_visages_du_joueur(uuid) to authenticated;
-- Correctif v222 — `ajoute_par` pointait vers `profiles`, la table des collaborateurs SportVision.
-- Or celui qui enregistre l'empreinte de son enfant est un PARENT : il n'a aucune ligne dans
-- `profiles`, et l'insertion échouait sur la clé étrangère. Trouvé par le test, pas en production.
alter table public.visages_reference drop constraint if exists visages_reference_ajoute_par_fkey;
alter table public.visages_reference
  add constraint visages_reference_ajoute_par_fkey
  foreign key (ajoute_par) references auth.users(id) on delete set null;
