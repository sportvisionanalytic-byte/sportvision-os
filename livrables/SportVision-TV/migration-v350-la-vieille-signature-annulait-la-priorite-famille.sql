-- v350 — LA SURCHARGE ANNULAIT SILENCIEUSEMENT LA PRIORITÉ DES FAMILLES (29/09/2026)
--
-- Trois défauts d'une seule cause, mesurés aujourd'hui par le chemin réel.
--
-- LA CAUSE. `reconnaissance_mettre_en_file` existe en DEUX exemplaires en base :
--   (uuid)                          — v325, puis v342
--   (uuid, smallint default 1)      — v345, « une famille qui attend passe devant »
-- v345 croyait remplacer. Elle a SURCHARGÉ. C'est mot pour mot la leçon du 26/09 : `create or
-- replace` avec un argument supplémentaire, même avec une valeur par défaut, crée une seconde
-- fonction. On l'avait déjà payée une fois, on la repaye.
--
-- DÉFAUT 1 — LA PRIORITÉ FAMILLE N'A JAMAIS SERVI. Les deux déclencheurs qui comptent vraiment,
-- `trg_reconnaissance_achat_pass` (media_entitlements) et `trg_reconnaissance_photo_reference`
-- (player_face_refs), appellent la forme à un argument. PostgreSQL choisit la correspondance
-- exacte : la VIEILLE, celle qui ne connaît pas la priorité. Les familles entraient donc en
-- priorité 5, c'est-à-dire derrière les 52 galeries de rattrapage — des heures de calcul. Mesuré
-- avant cette migration : une seule ligne en priorité 1 dans toute la file, et c'est moi qui
-- l'avais mise à la main. Zéro venait d'un achat de Pass. On promet « reviens dans cinq à dix
-- minutes » à quelqu'un qui vient de payer 39,90 €, et on le sert le lendemain.
--
-- DÉFAUT 2 — UN APPEL À UN SEUL ARGUMENT EST IMPOSSIBLE DEPUIS L'APPLICATION. PostgREST, lui, ne
-- sait pas départager : `{"p_player_id": "..."}` répond 300 PGRST203. Vérifié. Tout code
-- applicatif qui appellerait cette fonction de la façon la plus naturelle échouerait.
--
-- DÉFAUT 3 — UN VISITEUR ANONYME POUVAIT REMPLIR LA FILE. La forme à deux arguments était
-- exécutable par `anon`, et elle est SECURITY DEFINER. Vérifié par le chemin réel : un appel sans
-- aucune session répond 200. Il suffit d'un identifiant de sportif pour faire travailler le Mac de
-- Fouka autant qu'on veut, sans compte. Personne n'a besoin de ça : la mise en file vient des
-- déclencheurs, jamais du navigateur.
--
-- LA CORRECTION. Une seule fonction, celle qui connaît la priorité, et le droit d'appel réduit à
-- ce qui en a besoin.

-- On enlève la vieille AVANT de toucher au reste : tant qu'elle existe, les déclencheurs
-- continueront de la choisir. Un `create or replace` de plus n'y aurait rien changé.
drop function if exists public.reconnaissance_mettre_en_file(uuid);

create or replace function public.reconnaissance_mettre_en_file(p_player_id uuid, p_priorite smallint default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  -- PAS DE GARDE-FOU DE CONSENTEMENT ICI, et c'est réfléchi (v342). Mettre en file, c'est dire
  -- « il y a du travail sur cette galerie pour ce sportif ». Ce que le moteur a le droit d'y faire
  -- est une autre question, tranchée ailleurs et à chaque fois : sans accord il lit les dossards et
  -- ne touche à aucun visage. Confondre les deux, c'était interdire le permis avec l'interdit.
  insert into reconnaissance_a_faire (album_id, player_id, priorite)
  select a.id, p_player_id, p_priorite
    from media_albums a
   where a.status = 'published'
     and public.media_galerie_concerne_le_joueur(a.id, p_player_id)
     -- Ne pas empiler : une demande en attente sur cette galerie suffit.
     and not exists (select 1 from reconnaissance_a_faire f
                      where f.album_id = a.id and f.player_id = p_player_id and f.traite_le is null)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.reconnaissance_mettre_en_file(uuid, smallint) is
  'Inscrit dans la file les galeries publiées qui concernent ce sportif. Priorité 1 par défaut : '
  'quelqu''un attend. SIGNATURE UNIQUE — ne jamais en créer une seconde, même avec une valeur par '
  'défaut : `create or replace` surchargerait, PostgREST répondrait 300, et les déclencheurs '
  'choisiraient l''ancienne. C''est arrivé deux fois (26/09, puis v345 découverte le 29/09).';

-- LE DROIT D'APPEL. Les déclencheurs sont SECURITY DEFINER et tournent avec les droits de leur
-- propriétaire : ils n'ont pas besoin d'un GRANT au visiteur. Le moteur, si, pour le rattrapage.
revoke all on function public.reconnaissance_mettre_en_file(uuid, smallint) from public, anon, authenticated;
grant execute on function public.reconnaissance_mettre_en_file(uuid, smallint) to service_role;

-- ET ON RÉPARE CE QUI ATTEND DÉJÀ. Une correction qui ne répare pas le passé laisse la prochaine
-- famille attendre quand même (leçon du 27/09). Les travaux en attente rattachés à un sportif ont
-- tous quelqu'un derrière : ils passent en priorité 1. Le rattrapage sans sportif reste en 9.
update reconnaissance_a_faire
   set priorite = 1
 where traite_le is null and player_id is not null and priorite > 1;

notify pgrst, 'reload schema';
