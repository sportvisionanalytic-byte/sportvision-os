-- ═══════════════════════════════════════════════════════════════════════════════
-- Suivi terrain de l'operateur + garde-fou carte SD
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Seule table reellement nouvelle du module (§68). Tout le reste existe : les statuts de
-- mission (statut_prestation), l'acceptation (prestations_equipe), les kits (kit_reservations,
-- kit_controles), les incidents (incidents), les livraisons et la validation Production
-- (media_liens + transfert_confirme), le journal (historique).
--
-- Elle ne porte donc QUE ce qui manquait : ou en est cet operateur sur cette mission, et les
-- horodatages des grandes etapes. Une ligne par couple (mission, operateur) : sur une mission a
-- deux, le photographe et le videaste ont chacun leur avancement.
--
-- La regle la plus importante du module est ici, en base, pas dans un bouton grise :
-- une carte n'est liberable que si les fichiers sont securises.

begin;

create table if not exists public.mission_suivi_operateur (
  id uuid primary key default gen_random_uuid(),
  prestation_id uuid not null references prestations(id) on delete cascade,
  collaborateur_id uuid not null references profiles(id) on delete cascade,

  -- Etat des cases cochees. jsonb plutot qu'une table d'items : la liste depend de la
  -- couverture et du kit, elle n'est pas un referentiel stable qu'on voudrait requeter.
  -- Forme : {"batteries_chargees": {"fait": true, "at": "2026-09-13T12:04:00Z"}}
  etapes jsonb not null default '{}'::jsonb,

  -- Horodatages des grandes etapes (§57). Poses par l'action, jamais saisis a la main.
  accepte_at timestamptz,
  kit_prepare_at timestamptz,
  parti_at timestamptz,
  arrive_at timestamptz,
  prestation_terminee_at timestamptz,
  fichiers_securises_at timestamptz,
  postproduction_terminee_at timestamptz,
  livre_at timestamptz,
  cartes_liberees_at timestamptz,
  kit_restitue_at timestamptz,
  termine_at timestamptz,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint mission_suivi_operateur_unique unique (prestation_id, collaborateur_id)
);

comment on table public.mission_suivi_operateur is
  'Avancement d''un operateur sur une mission : cases cochees et horodatages des grandes etapes. Ne duplique rien — statuts, kits, incidents et livraisons vivent dans leurs tables existantes.';
comment on column public.mission_suivi_operateur.fichiers_securises_at is
  'Pose quand les fichiers sont copies ET verifies. C''est la charniere : sans elle, les cartes ne peuvent pas etre declarees liberables.';
comment on column public.mission_suivi_operateur.cartes_liberees_at is
  'Pose quand les cartes peuvent etre preparees pour la mission suivante. Protege par un declencheur : jamais avant securisation des fichiers.';

create index if not exists idx_mso_prestation on public.mission_suivi_operateur(prestation_id);
create index if not exists idx_mso_collaborateur on public.mission_suivi_operateur(collaborateur_id);

-- ── LA regle absolue ─────────────────────────────────────────────────────────
--
-- « Une carte contenant des fichiers n'est jamais formatee sans confirmation que son contenu
-- est securise. » (§24, §37, §65)
--
-- Elle est ici et pas dans l'interface, pour la meme raison que le SIRET du CM : une commande
-- masquee a l'ecran n'est pas une securite. Deux conditions cumulatives, parce qu'un disque
-- peut tomber en panne : les fichiers copies et verifies, ET la livraison partie.
create or replace function public.proteger_liberation_cartes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_liens_confirmes integer;
begin
  if new.cartes_liberees_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.cartes_liberees_at is not distinct from new.cartes_liberees_at then
    return new;
  end if;

  if new.fichiers_securises_at is null then
    raise exception 'Cartes non liberables : les fichiers de cette mission ne sont pas encore declares securises.'
      using errcode = '42501';
  end if;

  -- Seconde copie : au moins une livraison dont le transfert est confirme. Un disque unique ne
  -- suffit pas, c'est precisement le cas qui fait perdre un match entier.
  select count(*) into v_liens_confirmes
    from media_liens ml
   where ml.prestation_id = new.prestation_id
     and ml.transfert_confirme is true;

  if v_liens_confirmes = 0 then
    raise exception 'Cartes non liberables : aucune livraison de cette mission n''a de transfert confirme. Securisez une seconde copie avant de preparer les cartes.'
      using errcode = '42501';
  end if;

  return new;
end $function$;

drop trigger if exists trg_proteger_liberation_cartes on public.mission_suivi_operateur;
create trigger trg_proteger_liberation_cartes
  before insert or update on public.mission_suivi_operateur
  for each row execute function public.proteger_liberation_cartes();

-- ── Permissions ──────────────────────────────────────────────────────────────
alter table public.mission_suivi_operateur enable row level security;

-- L'operateur gere SON avancement sur SES missions. Les deux conditions, pas l'une ou l'autre :
-- etre affecte a la mission ne donne pas le droit de cocher a la place d'un collegue.
drop policy if exists mso_operateur on public.mission_suivi_operateur;
create policy mso_operateur on public.mission_suivi_operateur for all to authenticated
  using (collaborateur_id = auth.uid() and operateur_affecte_prestation(prestation_id))
  with check (collaborateur_id = auth.uid() and operateur_affecte_prestation(prestation_id));

-- Production, admin, secretariat et RH suivent l'avancement dans leur perimetre de pole.
drop policy if exists mso_encadrement on public.mission_suivi_operateur;
create policy mso_encadrement on public.mission_suivi_operateur for all to authenticated
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','prod','sec','rh'))
    and prestation_pole_scope_ok(prestation_id)
  )
  with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','prod','sec','rh'))
    and prestation_pole_scope_ok(prestation_id)
  );

commit;

select 'OK — suivi terrain cree, liberation des cartes protegee en base' as verdict;
