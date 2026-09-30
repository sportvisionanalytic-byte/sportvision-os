-- v375 — UN OPERATEUR NE VALIDE PAS SA PROPRE LIVRAISON (01/10/2026)
--
-- ✅  APPLIQUEE LE 01/10/2026 en production. Test rouge avant / vert apres, joue avec le jeton
--     d'Antoine dans une transaction annulee : 1/4 puis 4/4. Verifie aussi que la Production
--     garde tout — Mikael valide et demande une correction, les deux passent. Perimetre du §4
--     relu avant d'appliquer : aucun `cm` n'a jamais cree de lien, le seul lien sans mission
--     est celui de Fouka (admin).
--
-- Historique de la redaction : Elle touche `media_liens`, qui porte la chaîne de
--     paiement des freelances. Elle attend une décision de Fouka, et la V1 est sous gel
--     fonctionnel : seuls les P0/P1 passent. Le §1 ci-dessous EST un P0.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- CE QUI A ETE MESURE, ET COMMENT
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Chaque ligne ci-dessous a été jouée avec le jeton d'un opérateur réel — Antoine Blin,
-- `0831e5ee-2ad9-4efd-95ea-3d88f16dd1b2`, rôle `photo`, actif, pôle Football — dans une
-- transaction terminée par `rollback` :
--
--     begin; set local role authenticated;
--     select set_config('request.jwt.claims',
--       '{"sub":"0831e5ee-2ad9-4efd-95ea-3d88f16dd1b2","role":"authenticated"}', true);
--     <la requête>
--     rollback;
--
-- Quatre policies pèsent sur `media_liens`. Deux PERMISSIVES : `ml_read` (SELECT) et `ml_write`
-- (ALL), toutes deux `is_staff() AND (prestation_id IS NULL OR prestation_pole_scope_ok(...))`.
-- Deux RESTRICTIVES : `compte_os_desactive_bloque` et `operateur_perim_media_liens`
-- (`NOT est_operateur_terrain() OR prestation_id IS NULL OR operateur_affecte_prestation(...)`).
-- `ml_write` n'a PAS de `WITH CHECK` propre : son `USING` sert donc aussi de contrôle à
-- l'insertion.
--
-- Or `is_staff()` inclut le rôle `photo`. Un opérateur est donc, pour `ml_write`, un membre du
-- personnel comme un autre — et la seule chose que la restriction lui ajoute est le périmètre de
-- ses missions. À l'intérieur de ce périmètre, il peut TOUT.
--
--   MESURE 1 — `update media_liens set statut = 'valide' where id = <un de ses liens>` → PASSE.
--   MESURE 2 — `update media_liens set commentaire = '…' where id = <lien en correction>` → PASSE.
--   MESURE 3 — `insert … (ajouteur_id) values (<l'id d'un autre opérateur>)` → PASSE.
--   MESURE 4 — `update`/`delete` sur le lien `36dc72a6…` (« Test 34 », déposé par Fouka, sans
--              prestation) → PASSENT tous les deux, pour n'importe quel opérateur.
--   MESURE 5 — `insert` sur une prestation où il n'est pas affecté → REFUSE, 42501,
--              `operateur_perim_media_liens`. Le périmètre, lui, tient.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- §1 — P0 : SE VALIDER SOI-MEME DEBLOQUE SA PROPRE REMUNERATION
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- `mission_cloture_manquant` refuse la clôture d'une mission tant qu'un de ses liens est en
-- `a_verifier` ou en `correction_demandee`. Poser `valide` soi-même lève cette condition. Le
-- verdict de la production n'est pas un état d'avancement : c'est ce qui engage le paiement d'un
-- freelance, et `notifier_decision_livraison` est écrit pour prévenir l'opérateur d'une décision
-- prise PAR QUELQU'UN D'AUTRE (« Ne pas se notifier soi-même », dit son propre commentaire). Le
-- trigger a donc toujours supposé ce que la RLS n'impose pas.
--
-- Rien ne dit que c'est arrivé : les 26 liens `valide` d'aujourd'hui n'ont pas d'historique de
-- statut, on ne peut pas savoir qui les a posés. C'est précisément le problème.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- §2 — P1 : EFFACER LA QUESTION EN MEME TEMPS QUE LA REPONSE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- `commentaire` porte le motif écrit par la production quand elle demande une correction. Il est
-- unique. Un opérateur qui écrit dedans efface la demande, et la production relit un lien sans
-- savoir ce qu'elle avait demandé. L'application ne l'offre pas (elle répond par un NOUVEAU lien,
-- comme `executerRemplacement` dans l'OS), mais la base le permet.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- §3 — P1 : UNE TRACE QUI PEUT MENTIR
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- `ajouteur_id` désigne qui a déposé. C'est la colonne que lit `notifier_decision_livraison` pour
-- savoir QUI prévenir d'une correction, et c'est la seule trace de qui a livré quoi. Rien ne la
-- contraint : chaque écran la remplit « gentiment » avec son propre identifiant.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- §4 — P1 : LES LIENS SANS PRESTATION SONT A TOUT LE MONDE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- `prestation_id IS NULL` court-circuite les DEUX bornes : le pôle dans `ml_read`/`ml_write`, et
-- l'affectation dans `operateur_perim_media_liens`. Un lien sans mission est donc lisible,
-- modifiable et supprimable par n'importe quel membre du personnel, opérateurs compris. Il y en a
-- un aujourd'hui (« Test 34 »), et la bibliothèque de médias en créera d'autres.
--
-- La clause existe pour une raison — la bibliothèque et la Media Bank vivent hors mission — mais
-- elle ouvre l'écriture en même temps que la lecture, et ce n'était probablement pas voulu.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- §5 — P1 : UN OPERATEUR QUI A REFUSE LA MISSION PEUT QUAND MEME Y DEPOSER
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- `operateur_affecte_prestation` ne regarde que l'EXISTENCE d'une ligne dans `prestations_equipe`,
-- jamais son statut. Une invitation refusée laisse la ligne en place. L'OS le contourne côté écran
-- (`&statut=neq.refusée` dans `loadPhotoMedias`, ajouté après une QA nocturne), et l'application
-- fait pareil — mais un contournement d'écran n'est pas une borne.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- §6 — P1 : QUINZE LIVRAISONS SUR TRENTE-CINQ N'ONT PREVENU PERSONNE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- `notifier_livraison_recue` sort immédiatement si `categorie not in ('final','rushs')`. Or le
-- modal « Ajouter un lien » de l'écran opérateur de l'OS force `categorie: 'livraison'` — c'est
-- écrit dans son code, avec son commentaire : « ce lien fait partie de ce qui est remis ».
--
-- Mesuré sur les 35 lignes : `final` 15, `livraison` 14, `rushs` 5, `depot` 1. QUINZE dépôts
-- réels — 14 `livraison` + 1 `depot` — n'ont déclenché aucune notification à la production. Elle
-- ne les a découverts qu'en ouvrant son écran.
--
-- ⚠️  Ce §6 est le seul qui n'est pas un resserrement : il fait PARTIR des notifications qui ne
--     partaient pas. Sur les liens existants rien ne bouge (le trigger est AFTER INSERT), mais il
--     changera le volume de notifications de la production. À valider avec elle.
--
-- =============================================================================================
-- LA MIGRATION
-- =============================================================================================

begin;

-- ── §3 : ajouteur_id est toujours celui qui écrit ────────────────────────────────────────────
--
-- On ne REFUSE pas une valeur différente, on la REMPLACE : les quatre écrans de l'OS et celui de
-- l'application envoient déjà la bonne, et faire échouer un dépôt pour une colonne que personne ne
-- saisit à la main ferait perdre un travail réel. Admin et prod gardent le droit de déposer POUR
-- quelqu'un — Fouka le fait (1 lien sur 35 en base), et l'OS le documente.
create or replace function public.media_liens_ajouteur_est_l_auteur()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role in ('admin', 'prod', 'sec') then
    return new;
  end if;
  new.ajouteur_id := auth.uid();
  return new;
end $$;

drop trigger if exists trg_ml_ajouteur on public.media_liens;
create trigger trg_ml_ajouteur
  before insert on public.media_liens
  for each row execute function public.media_liens_ajouteur_est_l_auteur();

-- ── §1 et §2 : le verdict et son motif appartiennent à la production ─────────────────────────
--
-- UN TRIGGER ET PAS UNE POLICY, ET C'EST UN CHOIX. Une policy `WITH CHECK` qui refuse rend zéro
-- ligne et zéro erreur côté PostgREST : l'écran afficherait « enregistré » sans que rien ne bouge,
-- exactement le faux succès qu'on passe son temps à fermer. Un `raise exception` remonte une
-- phrase que l'écran peut montrer.
--
-- `statut` : un opérateur peut poser `a_verifier` (c'est ce que fait un redépôt) et `remplace`
-- (c'est ce que fait une réponse à correction). Rien d'autre. `valide`, `correction_demandee`,
-- `expire`, `inaccessible`, `archive` sont des lectures de la production.
create or replace function public.media_liens_verdict_reserve_production()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role in ('admin', 'prod', 'sec') then
    return new;
  end if;

  if new.statut is distinct from old.statut
     and coalesce(new.statut, 'a_verifier') not in ('a_verifier', 'remplace') then
    raise exception 'Le verdict sur une livraison appartient à la Production. Vous pouvez redéposer un lien ou le remplacer, pas le valider.'
      using errcode = '42501';
  end if;

  -- Le motif de la production est la question ; on n'écrit pas la réponse par-dessus. Le passer à
  -- NULL reste possible quand il l'était déjà (une écriture qui ne change rien).
  if new.commentaire is distinct from old.commentaire and old.commentaire is not null then
    raise exception 'Ce texte est celui de la Production. Pour lui répondre, remplacez le lien : votre réponse partira avec le nouveau.'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists trg_ml_verdict on public.media_liens;
create trigger trg_ml_verdict
  before update on public.media_liens
  for each row execute function public.media_liens_verdict_reserve_production();

-- ── §5 : une affectation refusée n'est plus une affectation ──────────────────────────────────
--
-- `prestations_equipe.statut` est de type `statut_affectation`. On compare en texte pour ne pas
-- dépendre de l'orthographe exacte de l'énumération dans une fonction `sql`.
create or replace function public.operateur_affecte_prestation(p_prestation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_prestation_id is not null and exists (
    select 1 from prestations_equipe pe
    where pe.prestation_id = p_prestation_id
      and pe.collaborateur_id = auth.uid()
      and pe.statut::text <> 'refusée'
  );
$$;

-- ── §4 : un lien sans mission ne s'écrit plus depuis le terrain ──────────────────────────────
--
-- La LECTURE reste ouverte : la bibliothèque et la Media Bank sont faites pour être consultées par
-- tout le personnel, et la fermer casserait le Centre Médias. Seule l'ECRITURE se resserre.
--
-- ⚠️  A RELIRE AVANT D'APPLIQUER : vérifier quels écrans créent aujourd'hui un lien sans
--     prestation. `modalAjouterBibliotheque` en est un, et il est utilisé par des rôles de bureau ;
--     si un `cm` doit pouvoir alimenter la bibliothèque, ajouter `'cm'` à la liste ci-dessous.
drop policy if exists ml_write on public.media_liens;
create policy ml_write on public.media_liens
  for all
  using (
    is_staff() and (
      case when prestation_id is null
           then (select role from profiles where id = auth.uid()) in ('admin', 'prod', 'sec', 'com')
           else prestation_pole_scope_ok(prestation_id)
      end
    )
  );

-- ── §6 : prévenir la production de TOUT ce qui est remis ─────────────────────────────────────
--
-- `travail`, `previsualisation` et `bibliotheque` restent muets : ce sont des rangements internes,
-- pas des livraisons. `depot` aussi — l'OS le décrit comme « un simple rangement, ne va nulle
-- part ». On ajoute `livraison`, et elle seule.
create or replace function public.notifier_livraison_recue()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_client text; v_cov text; d uuid;
begin
  if new.prestation_id is null or new.categorie not in ('final', 'rushs', 'livraison') then
    return new;
  end if;

  select c.nom, p.couverture into v_client, v_cov
    from prestations p left join clients c on c.id = p.client_id where p.id = new.prestation_id;

  for d in select destinataires_production(new.prestation_id) loop
    perform notifier(d, 'taches', 'livraison_recue',
      'Nouvelle livraison à vérifier',
      coalesce(v_client, 'Mission') || coalesce(' — ' ||
        case v_cov when 'photo' then 'Photo' when 'video' then 'Vidéo' when 'photo_video' then 'Photo + vidéo' end, '') || '.',
      new.prestation_id, 'normale',
      'livraison_recue:' || new.prestation_id || ':' || d || ':' || to_char(current_date, 'YYYY-MM-DD'));
  end loop;
  return new;
end $$;

commit;

-- =============================================================================================
-- COMMENT VERIFIER QUE CA MARCHE, APRES APPLICATION
-- =============================================================================================
--
-- Le test doit être ROUGE avant et VERT après, joué avec le jeton d'Antoine, en `rollback` :
--
--   -- doit lever 42501
--   update media_liens set statut = 'valide' where id = '14ea604f-d5b6-4796-a6ff-0ccb6448c2b4';
--
--   -- doit lever 42501
--   update media_liens set commentaire = 'x' where id = '1e9e6c8f-d1b1-40a2-824b-d8bf12c3341c';
--
--   -- doit passer, et rendre ajouteur_id = Antoine quel que soit ce qu'on envoie
--   insert into media_liens (prestation_id, nom, url, categorie, type_media, ajouteur_id)
--   values ('e2bca3c0-1bf1-47d5-9c6b-f607efbf75a2', 'essai', 'https://x.invalid', 'livraison',
--           'photo', 'd17a5830-588f-4e27-a7be-6e45d1bd5704')
--   returning ajouteur_id;
--
--   -- doit rendre zéro ligne (refus silencieux de la policy, pas une exception)
--   update media_liens set url = 'https://x.invalid'
--    where id = '36dc72a6-1b56-4155-bf96-7367d546027c';
--
--   -- doit toujours PASSER : redéposer et remplacer restent ouverts
--   update media_liens set url = 'https://x.invalid', statut = 'a_verifier'
--    where id = '1e9e6c8f-d1b1-40a2-824b-d8bf12c3341c' returning id;
--
-- Et côté écrans, à refaire en réel avant de considérer la migration close :
--   · l'OS, fiche mission → « Sauvegarde & livraison » : déposer, modifier, retirer un lien.
--   · l'OS, Livraisons : valider un lien, demander une correction (les deux doivent marcher).
--   · l'application, Mes livrables : déposer, redéposer, répondre, confirmer la sauvegarde.
--   · le Centre Médias : ajouter un lien à la bibliothèque avec chacun des rôles de bureau.
