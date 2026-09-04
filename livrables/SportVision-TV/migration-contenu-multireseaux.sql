-- Contenu multi-réseaux (04/09/2026, décision produit Fouka — audit transversal) : "un contenu
-- éditorial unique doit pouvoir être diffusé vers plusieurs plateformes... CONTENT ≠ PUBLICATION
-- TARGET." Recherché avant de coder si un objet existant (leçon déjà tirée deux fois cette
-- session sur le multi-club et le tutorat CM Junior) pouvait déjà couvrir ce besoin — confirmé
-- négatif (aucune table `*publication*`/`*target*` pertinente, `contenus.plateforme` reste un
-- texte simple). 0 ligne `contenus` en prod au moment de cette migration (vérifié en direct) :
-- aucun backfill réel à faire, mais le modèle reste conçu pour ne jamais perdre un contenu
-- mono-réseau existant (plateforme reste sur contenus, jamais retirée).

create table if not exists contenu_publication_targets (
  id uuid primary key default gen_random_uuid(),
  contenu_id uuid not null references contenus(id) on delete cascade,
  network text not null,
  account text,
  caption_override text,
  format text,
  scheduled_at timestamptz,
  status text not null default 'a_programmer' check (status in ('a_programmer', 'programme', 'publie', 'echec')),
  external_post_id text,
  published_at timestamptz,
  portee integer,
  engagement integer,
  vues integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contenu_id, network, account)
);

comment on table contenu_publication_targets is 'Une cible de publication (réseau + compte) pour un contenu — plusieurs lignes possibles par contenus.id (Instagram + TikTok + Facebook pour le même Reel), jamais une ligne contenus dupliquée par réseau. contenus garde tout ce qui est éditorial (brief/event/client/médias/statut de validation) ; le statut ici (a_programmer/programme/publie/echec) est un état de LIVRAISON par réseau, distinct du workflow éditorial de contenus.statut.';

create index if not exists idx_cpt_contenu on contenu_publication_targets(contenu_id);

create or replace function contenu_publication_targets_touch_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_cpt_updated_at on contenu_publication_targets;
create trigger trg_cpt_updated_at before update on contenu_publication_targets
  for each row execute function contenu_publication_targets_touch_updated_at();

alter table contenu_publication_targets enable row level security;

-- Lecture : hérite de la visibilité de contenus (la sous-requête ne trouve une ligne QUE si la
-- policy RLS de contenus l'autorise pour l'utilisateur courant — même patron que toute FK vers
-- une table déjà protégée, jamais une duplication des conditions contenus_select/contenus_client_
-- select/contenus_tuteur_select/contenus_admin_all/contenus_responsable_*).
create policy "cpt_select" on contenu_publication_targets for select using (
  exists (select 1 from contenus c where c.id = contenu_publication_targets.contenu_id)
);

-- Écriture : mêmes mains que contenus_update/contenus_tuteur_update (CM propriétaire, cm_lead,
-- admin, tuteur actif du junior propriétaire) — jamais le client, jamais un CM tiers sans lien
-- avec ce contenu.
create policy "cpt_write" on contenu_publication_targets for all using (
  exists (
    select 1 from contenus c
    where c.id = contenu_publication_targets.contenu_id
      and (
        c.cm_id = auth.uid()
        or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
        or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
        or exists (select 1 from profiles p where p.id = auth.uid() and p.cm_niveau_autonomie = 'responsable')
        or exists (select 1 from cm_tutorships t where t.junior_id = c.cm_id and t.tuteur_id = auth.uid() and t.statut = 'actif')
      )
  )
) with check (
  exists (
    select 1 from contenus c
    where c.id = contenu_publication_targets.contenu_id
      and (
        c.cm_id = auth.uid()
        or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
        or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
        or exists (select 1 from profiles p where p.id = auth.uid() and p.cm_niveau_autonomie = 'responsable')
        or exists (select 1 from cm_tutorships t where t.junior_id = c.cm_id and t.tuteur_id = auth.uid() and t.statut = 'actif')
      )
  )
);

-- Backfill (no-op aujourd'hui, 0 ligne contenus en prod — mais garde le modèle correct si des
-- contenus mono-réseau existent déjà au moment où cette migration tourne dans un autre
-- environnement) : chaque contenus.plateforme déjà renseigné devient sa propre cible, jamais
-- perdu, jamais un contenu sans aucune cible après cette migration.
insert into contenu_publication_targets (contenu_id, network, status, external_post_id, published_at)
select
  c.id,
  c.plateforme,
  case c.statut
    when 'publie' then 'publie'
    when 'programme' then 'programme'
    else 'a_programmer'
  end,
  c.publication_external_id,
  case when c.statut = 'publie' then c.date_publication::timestamptz else null end
from contenus c
where c.plateforme is not null and btrim(c.plateforme) <> ''
  and not exists (select 1 from contenu_publication_targets t where t.contenu_id = c.id);
