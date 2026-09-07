-- Migration : Galeries — qui a le droit de fixer un prix (correctif de permission)
-- À exécuter APRÈS migration-galeries-v6-offres-par-lien.sql.
--
-- ── Ce qui change ──
-- La v6 autorisait admin + secrétariat + production. Décision de Fouka : le secrétariat ne fixe
-- pas les prix. Fixer le tarif d'un lien est une décision commerciale, pas un acte administratif.
--
--   Fondateur / Admin        OUI
--   Responsable Production   OUI
--   Responsable de pôle      OUI
--   Secrétariat              NON
--   Photographe / vidéaste   NON
--   Community Manager        NON
--
-- ── Le responsable de pôle ──
-- Il n'y a pas de rôle `profiles.role` pour ça, mais l'architecture le porte déjà proprement :
-- `pole_affectations.role_pole = 'responsable'` (contrainte check 'responsable' | 'membre'), avec
-- un drapeau `actif`. On s'appuie donc sur l'existant plutôt que d'inventer un huitième rôle.
--
-- ── Ce qui n'est PAS touché ──
-- Les autres permissions du secrétariat restent identiques : media_staff_write() (admin, sec),
-- media_upload_staff() (admin, sec, prod, photo) et media_commerce_staff() (admin, sec, compta)
-- ne changent pas d'une ligne. Seule la capacité à créer un lien commercial et à en fixer le prix
-- lui est retirée.

begin;

create or replace function media_pricing_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin','prod')
  )
  or exists (
    -- Responsable d'un pôle actif. `actif` compte : un responsable retiré de son pôle ne doit
    -- pas continuer à pouvoir modifier des tarifs.
    select 1 from pole_affectations pa
    where pa.user_id = auth.uid() and pa.role_pole = 'responsable' and pa.actif
  );
$$;

comment on function media_pricing_staff is
  'Peut créer un lien public de galerie et en fixer le tarif : admin, responsable production, responsable de pôle actif. Volontairement PAS le secrétariat (fixer un prix est une décision commerciale), PAS les photographes (ils déposent, ils ne vendent pas), PAS les CM.';

-- ── Lecture séparée de l'écriture ──────────────────────────────────────────
-- Retirer le secrétariat de la tarification ne doit pas l'empêcher de LIRE un lien pour l'envoyer
-- aux parents : copier une adresse n'est pas fixer un prix. La lecture reste donc ouverte à ceux
-- qui travaillent sur l'album (media_upload_staff), l'écriture aux seuls décideurs commerciaux.
drop policy if exists malinks_staff_all on media_album_links;

drop policy if exists malinks_team_select on media_album_links;
create policy malinks_team_select on media_album_links
  for select using (media_upload_staff() or media_pricing_staff());

drop policy if exists malinks_pricing_insert on media_album_links;
create policy malinks_pricing_insert on media_album_links
  for insert with check (media_pricing_staff());

drop policy if exists malinks_pricing_update on media_album_links;
create policy malinks_pricing_update on media_album_links
  for update using (media_pricing_staff()) with check (media_pricing_staff());

drop policy if exists malinks_pricing_delete on media_album_links;
create policy malinks_pricing_delete on media_album_links
  for delete using (media_pricing_staff());

-- Le chiffre d'affaires par lien reste réservé aux décideurs commerciaux : media_album_links_stats
-- expose des montants encaissés, ce n'est pas la même chose que consulter un lien.

commit;
