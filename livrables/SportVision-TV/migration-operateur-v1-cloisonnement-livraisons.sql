-- ═══════════════════════════════════════════════════════════════════════════════
-- P0 — Un operateur terrain ne touche que les livraisons de SES missions
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Trou trouve a l'audit du module « Procedure terrain photographes/videastes » (09/09/2026).
--
-- `media_liens` etait ouvert par ml_read/ml_write en `is_staff() AND prestation_pole_scope_ok()`.
-- Deux photographes du meme pole pouvaient donc lire, modifier, completer et SUPPRIMER leurs
-- liens de livraison mutuels. Mesure avant correction (tests/operateur-livraisons-cloisonnement)
-- avec deux photographes reels : les quatre operations passaient, dans les deux sens.
--
-- L'incoherence etait interne : les prestations, elles, sont deja correctement cloisonnees.
-- `prestations_acces` n'ouvre une mission a un operateur que s'il figure dans
-- `prestations_equipe`. Un photographe ne voyait donc pas la mission d'un collegue, mais
-- pouvait en manipuler la livraison. C'est cette regle-la qu'on etend aux liens.
--
-- Technique : une policy RESTRICTIVE, qui se combine en ET avec les policies existantes et ne
-- peut que RETIRER de l'acces. Elle commence par `not est_operateur_terrain() or ...`, donc
-- Production, admin, secretariat, CM et comptabilite ne sont pas touches et ml_read/ml_write
-- restent en place. Meme patron que le cloisonnement CM (migration-cm-v10 a v13).
--
-- Volontairement HORS perimetre : les liens sans prestation (`prestation_id is null`), qui sont
-- la banque media partagee et les depots generaux. Ce ne sont pas des livraisons de mission, et
-- les fermer priverait les operateurs d'un outil de travail sans rapport avec la fuite.

begin;

-- ── Qui est un operateur terrain ─────────────────────────────────────────────
-- `profiles.role` est mono-valué : un photographe/videaste porte 'photo', jamais 'prod' ni
-- 'admin' en meme temps. La fonction ne dit donc que « cette personne est un operateur »,
-- elle ne decide d'aucun droit a elle seule.
create or replace function public.est_operateur_terrain()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'photo');
$function$;

comment on function public.est_operateur_terrain() is
  'Vrai si l''utilisateur courant est un photographe/videaste SportVision. Sert a borner son perimetre, jamais a lui accorder un droit.';

-- ── Sur quelles missions il est reellement affecte ───────────────────────────
-- SECURITY DEFINER volontaire : appelee depuis une policy, elle ne doit pas redeclencher les
-- policies de prestations_equipe. C'est le motif retenu apres l'incident de recursion du
-- 08/09 (une policy sur profiles interrogeait club_members, dont les policies lisent profiles).
--
-- Meme condition que prestations_acces, deliberement : une simple presence dans
-- prestations_equipe, sans filtre sur le statut. Etre plus strict ici qu'a l'ouverture de la
-- mission produirait le pire des cas — un operateur qui voit sa mission mais pas ses liens.
create or replace function public.operateur_affecte_prestation(p_prestation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p_prestation_id is not null and exists (
    select 1 from prestations_equipe pe
    where pe.prestation_id = p_prestation_id
      and pe.collaborateur_id = auth.uid()
  );
$function$;

comment on function public.operateur_affecte_prestation(uuid) is
  'Vrai si l''utilisateur courant figure dans prestations_equipe pour cette prestation. Meme condition que prestations_acces — source unique du perimetre d''un operateur.';

-- ── La ceinture ──────────────────────────────────────────────────────────────
drop policy if exists operateur_perim_media_liens on media_liens;
create policy operateur_perim_media_liens on media_liens as restrictive for all to authenticated
  using (
    not est_operateur_terrain()
    or prestation_id is null
    or operateur_affecte_prestation(prestation_id)
  )
  with check (
    not est_operateur_terrain()
    or prestation_id is null
    or operateur_affecte_prestation(prestation_id)
  );

comment on policy operateur_perim_media_liens on media_liens is
  'RESTRICTIVE : un operateur terrain ne lit et n''ecrit que les liens des prestations ou il est affecte. Les liens sans prestation (banque media) restent partages. Aucun autre role n''est affecte.';

commit;

-- Verification : tests/operateur-livraisons-cloisonnement.test.sql doit passer au vert.
select 'OK — cloisonnement des livraisons pose sur media_liens' as verdict;
