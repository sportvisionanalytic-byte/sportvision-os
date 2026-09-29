# Audit base — inscription, onboarding, consentement (29/09/2026)

Périmètre : la base de production. Lecture seule, plus des écritures en transactions annulées
(`begin; … rollback;`) pour mesurer les comportements. Aucune migration, aucun déploiement, aucune
modification de fichier hors ce rapport.

**Méthode.** L'API Management s'exécute en `postgres`, qui contourne la RLS et répond oui à tout.
Chaque contrôle de droits est donc fait par le chemin réel :

- soit avec la **clé anon** en HTTP sur PostgREST (`/rest/v1/rpc/<nom>`), c'est-à-dire exactement ce
  qu'un visiteur non connecté peut poster ;
- soit en SQL avec `set local role anon` (ou `authenticated`) **et**
  `set_config('request.jwt.claims', …)`, la méthode des tests de `livrables/SportVision-TV/tests/`.

**Verdict : 3 défauts P0, 3 P1, 3 P2.** Les trois P0 sont exploitables par un visiteur **sans compte
du tout**, avec la seule clé anon publique. Deux d'entre eux écrivent en base, le troisième est un
contournement de paiement.

Toutes les mesures ci-dessous ont été obtenues dans des transactions annulées : rien n'a été laissé
en base. Vérifié après coup : `select count(*) from player_profiles where prenom = 'ZZAudit'` → `0`.

---

## P0-1 — Un visiteur anonyme inscrit un joueur fantôme dans une équipe réelle

### Ce qui est cassé

`request_team_membership_as_player(p_club_id, p_team_id, p_invite_code, p_prenom, p_nom, p_date_naissance)`
est `SECURITY DEFINER`, `EXECUTE` est accordé à `anon`, et **la fonction ne vérifie jamais que
l'appelant est authentifié**. Elle fait :

```sql
select * into v_player from player_profiles where user_id = auth.uid();
...
if v_player.id is null then
  insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status)
  values (p_club_id, auth.uid(), p_prenom, p_nom, p_date_naissance, 'en_attente_activation')
```

En anonyme `auth.uid()` vaut `null` ; `where user_id = null` ne ramène jamais rien, donc la fonction
part systématiquement dans la branche de création, et `player_profiles.user_id` est nullable :
l'insertion passe.

Pire, la chaîne se termine toute seule. Avec un code d'équipe valide, la fonction appelle
`validate_team_membership(v_req.id, true)`, et dans cette fonction la branche « arrivée par un code
d'équipe » **court-circuite tous les contrôles d'autorité de l'appelant** :

```sql
if p_par_code and v_req.validation_mode = 'standard'
   and v_req.source = 'code_equipe' and v_req.invite_code_id is not null then
  null;        -- aucun is_real_club_admin, aucun is_real_team_educateur
elsif ...
```

### La mesure

Sonde HTTP avec la seule clé anon, sans jeton utilisateur :

```
$ curl -X POST "$SUPABASE_URL/rest/v1/rpc/request_team_membership_as_player" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -d '{"p_club_id":"00000000-…","p_team_id":"00000000-…","p_prenom":"ZZ","p_nom":"ZZ","p_date_naissance":"2010-01-01"}'
409 {"code":"23503","message":"insert or update on table \"player_profiles\" violates foreign key
     constraint \"player_profiles_club_id_fkey\""}
```

La fonction n'a pas refusé l'appel : elle est allée jusqu'à l'`insert` et n'a échoué que sur la clé
étrangère, parce que j'avais mis un `club_id` inexistant. Avec un club réel, en transaction annulée,
`set local role anon` + `request.jwt.claims = {"role":"anon"}` :

| contrôle | obtenu |
|---|---|
| `request_team_membership_as_player` en ANONYME (club + équipe réels) | **ACCEPTÉ**, demande `2bbd5a23-…`, statut `a_verifier` |
| fiches joueur créées par l'anonyme | **1** |
| demandes d'adhésion créées par l'anonyme | **1** |

Puis la chaîne complète, avec un code d'équipe actif tel qu'un club en distribue :

| contrôle | obtenu |
|---|---|
| inscription ANONYME avec un code d'équipe valide | **ACCEPTÉE, statut = `validee`** |
| fiche joueur créée dans le club | **1** |
| demande d'adhésion AUTO-VALIDÉE | **1** |
| joueur fantôme INSCRIT dans l'équipe (`team_memberships` statut `active`) | **1** |
| autorisations parentales fabriquées au passage | **12** |

ACL réelle mesurée :

```
request_team_membership_as_player(p_club_id uuid, p_team_id uuid, p_invite_code text, …)
    postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
```

### Portée

Sans le code, un anonyme pollue l'effectif de n'importe quel club avec des fiches en `a_verifier`.
Avec un code d'équipe — donné à toutes les familles d'une équipe, donc largement circulant — il
inscrit pour de bon un joueur inventé dans l'équipe, et crée 12 lignes d'autorisations parentales.
Le code lui-même n'est pas devinable (`SV-XXXXX-XXXXX`, plus une limite de 20 essais / 15 min par IP
dans `preview_invite_code`) : le scénario réaliste est un code transmis, pas un code cassé.

### La correction proposée

Deux gestes, l'un ne remplace pas l'autre : la garde interne d'abord, le `revoke` en défense.

```sql
-- 1. La garde. C'est elle qui compte : elle protège aussi tous les chemins internes.
create or replace function public.request_team_membership_as_player(
  p_club_id uuid, p_team_id uuid, p_invite_code text default null,
  p_prenom text default null, p_nom text default null, p_date_naissance date default null)
returns membership_requests language plpgsql security definer set search_path to 'public' as $$
declare
  v_player player_profiles;
  v_code team_invite_codes;
  v_req membership_requests;
  v_source text;
begin
  -- 29/09/2026 : la fonction s'exécutait sans appelant. `auth.uid()` valant null, le premier
  -- select ne ramenait rien et la branche de création partait avec user_id = null : un visiteur
  -- sans compte créait une fiche joueur, une demande, et — avec un code d'équipe — une adhésion
  -- validée. Il n'y a pas d'inscription sans quelqu'un qui s'inscrit.
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;

  -- … LE RESTE DU CORPS ACTUEL, INCHANGÉ …
end;
$$;

-- 2. Le revoke. `anon` n'a aucune raison d'appeler une inscription nominative.
revoke execute on function
  public.request_team_membership_as_player(uuid,uuid,text,text,text,date) from public, anon;
grant execute on function
  public.request_team_membership_as_player(uuid,uuid,text,text,text,date) to authenticated;
```

Je n'ai **pas** recopié le corps complet ici : il faut le reprendre tel quel depuis
`pg_get_functiondef` et n'insérer que le bloc de garde, pour ne rien perdre au passage (la fonction
fait 2 300 caractères et contient la logique v186 / v217).

### À vérifier après

1. Rejouer le banc ci-dessus : l'appel anonyme doit rendre `42501`, et
   `select count(*) from player_profiles where prenom = 'ZZFantome'` doit rendre `0`.
2. Vérifier que le chemin légitime marche toujours : `livrables/SportVision-Connect/app-next/src/lib/data/player/team-requests.ts:60`
   est le seul appelant applicatif, et `tests/villemomble-seniors-bout-en-bout.test.mjs:108` le
   couvre avec un vrai compte. Ce test doit rester vert.
3. Décider séparément si la branche « code d'équipe » de `validate_team_membership` doit continuer
   à se passer de tout contrôle d'autorité. Avec la garde ci-dessus le trou est fermé, mais la
   branche reste une exception large : n'importe quel compte connecté détenant un code peut
   s'auto-valider dans une équipe. C'est peut-être exactement la décision du 12/09 — à toi de
   trancher, je ne la change pas.

---

## P0-2 — Un visiteur anonyme efface les empreintes biométriques d'un enfant

### Ce qui est cassé

`purger_visages_du_joueur(p_player_id uuid)` est `SECURITY DEFINER`, ouverte à `anon` et
`authenticated`, et **n'a aucune garde** : son corps entier est

```sql
declare n integer;
begin
  delete from visages_reference where player_id = p_player_id;
  get diagnostics n = row_count;
  delete from media_player_tags where player_id = p_player_id and source = 'suggestion';
  return n;
end
```

C'est une fonction interne : son seul appelant est `effacer_biometrie_au_retrait`
(`migration-v223-retrait-purge-les-empreintes.sql:49`), aucun code client ne l'appelle. La preuve
que le geste de `revoke` est bien la règle du projet, c'est que ses deux voisines l'ont :

```
effacer_biometrie_au_retrait       anon=False  authenticated=False  service_role=True
visage_reference_depuis_galerie    anon=False  authenticated=False  service_role=True
purger_visages_du_joueur           anon=True   authenticated=True   service_role=True   ← oubliée
```

### La mesure

Sonde HTTP anon avec un uuid inexistant : `200 0`. La fonction répond, elle ne refuse pas.
Puis, en transaction annulée, sur le joueur réel qui a des empreintes en base :

| contrôle | obtenu |
|---|---|
| `purger_visages_du_joueur` en ANONYME | **ACCEPTÉ, a rendu 1** |
| empreintes avant / après | **1 → 0** |

`visages_reference` compte aujourd'hui 1 empreinte pour 1 joueur : le dégât immédiat est petit,
l'exposition ne l'est pas. Le player_id est le même identifiant que les écrans famille manipulent.

### La correction proposée

```sql
-- 29/09/2026 : fonction interne (seul appelant : effacer_biometrie_au_retrait), mais `create
-- function` accorde EXECUTE à PUBLIC par défaut. Un visiteur sans compte supprimait les
-- empreintes de n'importe quel sportif. Ses deux voisines du même chantier étaient déjà fermées.
revoke execute on function public.purger_visages_du_joueur(uuid) from public, anon, authenticated;
```

Pas de garde interne à ajouter : `effacer_biometrie_au_retrait` est `SECURITY DEFINER`, elle
s'exécute donc en `postgres` et l'appel interne reste autorisé après le `revoke`.

### À vérifier après

1. `select has_function_privilege('anon','public.purger_visages_du_joueur(uuid)','EXECUTE')` → `false`,
   idem `authenticated`.
2. La sonde HTTP anon doit rendre `42501`, plus `200`.
3. Le retrait d'un joueur doit toujours purger : rejouer le test qui couvre `effacer_biometrie_au_retrait`
   (chaîne du retrait, `migration-v223`), et vérifier qu'une purge réelle via ce chemin rend bien un
   compte d'empreintes supprimées.

---

## P0-3 — Un visiteur anonyme fait passer une commande à « payée » et s'ouvre les droits photo

### Ce qui est cassé

`media_activer_commande(p_order_id uuid)` est `SECURITY DEFINER`, ouverte à `anon` et
`authenticated`, et n'a **aucune vérification d'appelant**. Elle fait le passage
`pending → paid` puis crée les `media_entitlements` :

```sql
update media_orders
   set status = 'paid', paid_at = coalesce(paid_at, now())
 where id = p_order_id and status = 'pending'
returning … into v_order;
...
insert into media_entitlements (…, status) values (…, 'active');
```

Son seul appelant est l'Edge Function `iap-valider`
(`livrables/SportVision-TV/supabase/functions/iap-valider/index.ts:401`), qui s'exécute en
`service_role`. Ni `anon` ni `authenticated` n'ont besoin de l'appeler.

### La mesure

Sonde HTTP anon, uuid inexistant :

```
200 {"ok": true, "droits": 0, "deja_activee": true}
```

Elle répond, donc elle s'exécute. En transaction annulée, avec une commande `pending` qui porte un
bénéficiaire — la forme normale d'un Pass Photo acheté pour un enfant :

| contrôle | obtenu |
|---|---|
| décor : commande `pending` AVEC bénéficiaire | `c473ef87-…` |
| `media_activer_commande` en ANONYME | **ACCEPTÉ : `{"ok": true, "droits": 1, "deja_activee": false}`** |
| statut de la commande après l'appel anonyme | **`paid`** |
| droits média ACTIFS créés sans paiement | **1** |

Contre-mesure du même banc : avec une commande `pending` **sans** bénéficiaire, l'appel échoue sur
`null value in column "beneficiary_person_id" of relation "media_entitlements"` et la commande reste
`pending`. La protection actuelle est donc un `not null` accidentel, pas une garde : elle ne tient
que pour les commandes sans bénéficiaire.

État de la base au moment de l'audit : 5 commandes `pending`, dont **0 avec bénéficiaire**. Le trou
n'a donc pas de victime immédiate — il en aura une au premier Pass Photo commencé et non payé.
L'`order_id` n'est pas secret : c'est l'acheteur lui-même qui l'a dans son navigateur
(`app-connect/src/app/gallery/commande/page.tsx` le lit dans l'URL et le passe à `gallery-download`).
Le scénario est donc : je lance un achat, j'abandonne Stripe, j'appelle ce RPC avec mon propre
`order_id`, j'ai le Pass gratuitement.

### La correction proposée

```sql
-- 29/09/2026 : seul `iap-valider` (service_role) appelle cette fonction, mais EXECUTE était
-- accordé à anon et authenticated. Un acheteur qui abandonnait Stripe pouvait faire passer sa
-- propre commande à 'paid' et s'ouvrir les droits. Le passage pending→paid est le verrou
-- d'idempotence : il ne doit être franchissable que par le serveur.
revoke execute on function public.media_activer_commande(uuid) from public, anon, authenticated;
```

### À vérifier après

1. `select has_function_privilege('anon','public.media_activer_commande(uuid)','EXECUTE')` → `false`.
2. Sonde HTTP anon → `42501`.
3. **Un achat in-app réel doit continuer à ouvrir les droits** : `iap-valider` appelle avec la clé
   service, donc le `revoke` ne la touche pas, mais c'est le seul chemin de paiement iOS/Android et
   il ne se re-teste pas facilement. À passer avant tout, en sandbox Apple, avec
   `tests/achat-pass-sans-module-natif.test.mjs` et un achat sandbox complet.
4. Balayer les autres fonctions appelées uniquement par une Edge Function, même classe de défaut :
   `staff_mark_media_order_shipped` est gardée (`Non autorisé`), mais la liste mérite un passage.

---

## P1-1 — Un visiteur anonyme crée des galeries sur une mission

`creer_galeries_mission_auto(p_prestation_id uuid)` : `SECURITY DEFINER`, ouverte à `anon`
(`=X/postgres | anon=X | authenticated=X`), **aucune garde**. Aucun appelant applicatif ; son seul
appelant est le déclencheur `trg_galeries_suivent_la_mission` sur `prestations`, via la fonction
`galeries_suivent_la_mission`.

Mesure, en transaction annulée sur la prestation réelle la plus récente :

| contrôle | obtenu |
|---|---|
| `creer_galeries_mission_auto` en ANONYME | **ACCEPTÉ, a rendu 1** |
| galeries de la mission avant / après | **0 → 1** |

```sql
-- 29/09/2026 : appelée uniquement par trg_galeries_suivent_la_mission, mais ouverte à anon.
revoke execute on function public.creer_galeries_mission_auto(uuid) from public, anon, authenticated;
```

`galeries_suivent_la_mission` est `SECURITY DEFINER` : le déclencheur continue de fonctionner après
le `revoke`. **À vérifier après** : insérer une prestation (en transaction annulée) et confirmer que
le déclencheur crée bien la galerie ; puis `tests/galerie-automatique-mission.test.sql`.

---

## P1-2 — Un visiteur anonyme lit le calendrier et les prestations de n'importe quel club

`galerie_rattachements(p_club_id, p_jours, p_team_ids)` : `SECURITY DEFINER`, ouverte à `anon`,
**aucune garde**. Elle rend l'union des `club_matches`, `club_calendar_events` et `prestations` du
club, sur une fenêtre de dates.

Ce n'est pas une redite d'un accès déjà public : par le chemin direct, `anon` n'obtient rien de ces
tables.

```
club_matches                   401 {"message":"permission denied for function contenus_visible_par_cm"}
prestations                    401 {"message":"permission denied for function contenus_visible_par_cm"}
club_calendar_events           200 []
```

Alors que par la fonction, avec la seule clé anon :

```
$ curl -X POST …/rpc/galerie_rattachements -d '{"p_club_id":"0ab96066-…","p_jours":90}'
200 [{"genre":"match","ref_id":"477faab0-…","libelle":"Seniors A — Gentilly AC Seniors 1",
      "date_evenement":"2026-10-04","team_id":"ed55ba58-…","equipe":"Seniors A","detail":"U20 R3"},
     {"genre":"match","ref_id":"efeba0a4-…","libelle":"Seniors A — Nangis ES Seniors 1", …
```

C'est la même classe que « Failles en lecture fermées (10/09) » : le calendrier redevient lisible
sans compte, par une autre porte. Fuite : calendrier complet, adversaires, lieux, et pour les
prestations la référence interne et le type de prestation.

`galerie_rattachements` **est** appelée par l'OS (`SportVision-OS-Full.html:13100`), donc un `revoke`
casserait l'écran. La correction est une garde interne :

```sql
-- 29/09/2026 : aucune garde. Un visiteur sans compte lisait le calendrier, les événements et les
-- prestations de n'importe quel club, alors que les trois tables lui sont fermées en direct.
-- Reprendre le corps actuel tel quel et n'ajouter que le `where` final ci-dessous.
create or replace function public.galerie_rattachements(
  p_club_id uuid, p_jours integer default 60, p_team_ids uuid[] default null)
returns table(genre text, ref_id uuid, libelle text, date_evenement date,
              team_id uuid, team_ids uuid[], equipe text, detail text)
language sql stable security definer set search_path to 'public' as $$
  with fenetre as ( … INCHANGÉ … ), tout as ( … INCHANGÉ … )
  select genre, ref_id, libelle, date_evenement, team_id, team_ids, equipe, detail
    from tout
   where (is_staff() or peut_travailler_club(p_club_id) or is_club_member(p_club_id))
     and (p_team_ids is null
          or cardinality(p_team_ids) = 0
          or cardinality(team_ids) = 0
          or team_ids && p_team_ids)
   order by date_evenement desc nulls last, libelle;
$$;
```

`peut_travailler_club` = `peut_operer_club(p_club_id) or est_cm_du_club_id(p_club_id)`, ce qui couvre
l'usage OS (staff et CM). J'ajoute `is_club_member` pour ne pas fermer un usage Club+ que je n'ai pas
inventorié ; si tu confirmes que seul l'OS appelle cette fonction, retire-le et resserre.

**À vérouiller après** : l'appel anon doit rendre `[]` ; l'écran de rattachement de galerie de l'OS
doit continuer à lister les matchs (c'est le seul endroit à regarder, ligne 13100) ; et un membre de
club sans droit CM doit voir ce qu'il voyait.

---

## P1-3 — `connect_respond_profile_access_request` casse sur une variable non déclarée

`connect_respond_profile_access_request(p_id, p_accept)` référence `v_proprietaire`, qui **n'est
jamais déclaré** :

```sql
declare
  v_row connect_access_relationships%rowtype;
  v_count integer; v_limit integer; v_profil text; v_tier text;   -- pas de v_proprietaire
begin
  ...
    else
      v_limit := case when (select cps.created_at from connect_profile_settings cps
                           where cps.user_id = v_proprietaire) < timestamptz '2026-08-16 00:00:00+00'
                     then 999 else 3 end; -- droits acquis pré-v67 seulement (v197)
```

plpgsql ne résout pas les identifiants à la création : la fonction existe, et elle échoue au
**premier passage dans la branche `else`**, c'est-à-dire quand le demandeur n'a pas de ligne
`connect_profile_settings`, ou un `profil_particulier` hors de `{agent, parent, tuteur, autre}`.

Mesure, en transaction annulée, deux décors qui ne diffèrent que par ce point :

| contrôle | obtenu |
|---|---|
| le propriétaire ACCEPTE une demande d'un compte **sans** `connect_profile_settings` | **ÉCHEC `42703` : column "v_proprietaire" does not exist** |
| même geste, demandeur avec `profil_particulier = 'parent'` | OK, acceptée |

Portée aujourd'hui : `connect_access_relationships` où `status = 'en_attente'` → **0 ligne**, dont 0
dans la branche morte. Personne n'est bloqué en ce moment ; la première demande d'un compte sans
réglage de profil le sera, avec une erreur SQL brute à l'écran.

La correction : les autres branches calculent le plafond du **demandeur**, donc c'est
`v_row.grantee_user_id` qui était visé.

```sql
-- 29/09/2026 : v_proprietaire n'a jamais été déclaré. La branche « droits acquis pré-v67 » levait
-- 42703 dès qu'un demandeur n'avait pas de ligne connect_profile_settings. Les deux autres
-- branches calculent le plafond du DEMANDEUR : c'est v_row.grantee_user_id qui était visé.
      v_limit := case when (select cps.created_at from connect_profile_settings cps
                           where cps.user_id = v_row.grantee_user_id) < timestamptz '2026-08-16 00:00:00+00'
                     then 999 else 3 end;
```

À reprendre par `create or replace` sur le corps actuel complet, en ne changeant que cette
expression.

**À vérifier après** : rejouer le banc ci-dessus — les deux lignes doivent rendre « OK, acceptée ».
Et noter que dans ce cas le `select` ne ramène rien (le demandeur n'a pas de ligne), donc
`null < timestamptz` vaut `null`, le `case` tombe sur `else 3` : un compte sans réglage de profil
obtient le plafond de 3, ce qui est le comportement attendu pour un compte créé après le 16/08.

---

## P2-1 — `cm_clubs_autorises_de` rend l'affectation CM↔club à un anonyme

```
$ curl -X POST …/rpc/cm_clubs_autorises_de -d '{"p_cm":"be70c4f2-…"}'
200 [{"club_id":"0ab96066-…"}, {"club_id":"f0d3bafa-…"}]
```

Aucune garde (`select a.club_id from club_cm_affectations a where a.cm_id = p_cm …`). C'est une
fonction d'assistance : la variante utilisée par les policies est `cm_clubs_autorises()`, qui elle
part de `auth.uid()`. La fuite demande de connaître l'uuid d'un CM et ne rend que des `club_id` :
faible, mais c'est de l'organisation interne donnée gratuitement.

```sql
revoke execute on function public.cm_clubs_autorises_de(uuid) from public, anon;
```

**À vérifier après** : `cm-v28` / `cm-v29` (périmètre pour invitation, affectation suffit) touchent à
cette fonction — relancer les tests qui les couvrent, et vérifier qu'aucune policy ne l'appelle
(mesuré : aucune, seule `cm_clubs_autorises()` est citée dans les policies).

## P2-2 — `request_team_membership_for_child` n'est retenue que par un `not null`

Même absence de garde que P0-1. La fonction fait `insert into parent_profiles (user_id) values
(auth.uid())`, donc en anonyme elle butte sur la contrainte :

| contrôle | obtenu |
|---|---|
| `request_team_membership_for_child` en ANONYME | REFUSÉ : `null value in column "user_id" of relation "parent_profiles" violates not-null constraint` |

Rien ne passe en base (mesuré : la transaction implicite annule tout). Mais la protection est
accidentelle : elle disparaît le jour où `parent_profiles.user_id` devient nullable. Même correction
que P0-1 — `if auth.uid() is null then raise` en tête, plus
`revoke execute … from public, anon; grant execute … to authenticated;`.

À l'inverse, `request_team_membership_for_existing_child` est **correctement gardée** : mesuré en
anonyme avec un enfant réel et un code valide → `REFUSÉ : Non autorisé`.

## P2-3 — `marquer_invitation_ouverte` écrit sans garde

`SECURITY DEFINER`, ouverte à `anon`, aucune garde : `204` sur un jeton bidon. Elle ne fait que poser
`ouverte_at` sur une invitation dont on présente le jeton, et le jeton est un secret de 64 caractères
hex. Impact réel : un tiers qui intercepte un lien d'invitation peut marquer l'invitation « ouverte »
et fausser le suivi du club. Je le signale, je ne propose pas de la fermer : l'appel a lieu
précisément avant toute authentification, c'est son rôle.

---

## Ce que j'ai contrôlé et trouvé SAIN

Autant que les défauts : ça dit où il est inutile de rechercher.

### Aucune fonction surchargée

`livrables/SportVision-TV/tests/une-fonction-une-signature.test.sql`, lancé sur la base de prod :

```
VERT : aucune fonction publique n'a deux versions appelables du meme nombre d'arguments
```

Le test couvre tout le schéma `public` (chevauchement des plages d'arité par nom). Rien à refaire de
ce côté.

### Aucun cloisonnement familial percé

Deux familles fictives dans deux clubs différents, en transaction annulée, lectures faites en
`set local role authenticated` + `request.jwt.claims.sub` du parent A :

| contrôle | attendu | obtenu |
|---|---|---|
| parent A lit la fiche de l'enfant B (`player_profiles`) | 0 | **0** |
| parent A lit la fiche de SON enfant | 1 | **1** |
| parent A lit la demande d'adhésion de B (`membership_requests`) | 0 | **0** |
| parent A lit SA demande d'adhésion | 1 | **1** |
| parent A lit le lien parental de B (`parent_player_relationships`) | 0 | **0** |
| parent A lit le profil parent de B (`parent_profiles`) | 0 | **0** |
| parent A lit les autorisations parentales de B | 0 | **0** |
| parent A lit les codes d'invitation du club B (`team_invite_codes`) | 0 | **0** |
| parent A lit les invitations du club B (`club_invitations`) | 0 | **0** |
| parent A lit les membres du club B (`club_members`) | 0 | **0** |
| parent A lit TOUTES les fiches joueur de la base | 1 | **1** |
| parent A lit TOUTES les demandes d'adhésion | 1 | **1** |
| parent A lit TOUS les profils parents | 1 | **1** |
| parent A lit TOUS les consentements biométriques | 0 | **0** |
| parent A lit TOUTES les empreintes de visage | refus | **permission denied for table `visages_reference`** |

Les trois « TOUTES » sont la vraie mesure : pas un filtre par identifiant qu'on aurait pu oublier,
mais un balayage complet de la table. Le parent A ne voit que sa propre famille.

### Un anonyme ne lit aucune donnée personnelle, sur aucune table

Balayage des 213 tables où `anon` a le `SELECT`, chacune comptée en `set local role anon` avec
`request.jwt.claims = {"role":"anon"}`. Sur 228 tables au total, **5 seulement rendent des lignes**,
et ce sont des catalogues publics :

| table | lignes visibles par un anonyme |
|---|---|
| `authorization_types` | 12 |
| `authorization_versions` | 12 |
| `catalogue_offres` | 13 |
| `connect_modules` | 25 |
| `organization_role_catalog` | 34 |

Toutes les autres rendent `0` ou un refus. Aucune donnée nominative, aucun club, aucun joueur,
aucune commande. Les textes d'autorisation parentale sont publics à dessein : un parent doit pouvoir
les lire avant de signer.

Note : ~25 tables répondent `42501 permission denied for function …` à `anon` au lieu de `0` — les
policies appellent une fonction d'assistance (`contenus_visible_par_cm`, `media_ref_club_id`,
`parent_visible_to_club_admin`, `est_operateur_terrain`, …) révoquée pour `anon`. C'est volontaire et
sain : toutes ces fonctions ont bien `EXECUTE` pour `authenticated` (mesuré, 9 fonctions concernées,
`auth = true` pour les 9), donc la leçon du 12/09 (« ne pas revoke une fonction de policy ») n'a pas
été rejouée à l'envers. La seule conséquence est un `401` plutôt qu'un `[]` pour un visiteur, ce qui
ne casse rien : les pages publiques passent par les RPC `media_gallery_*`.

### Aucune table sans RLS

Sur 228 tables de `public`, **0 avec `relrowsecurity = false`**. Une seule a la RLS active et zéro
policy, `visages_reference`, et ce n'est pas un oubli : elle n'a **aucun grant** pour `anon` ni
`authenticated` (mesuré : seuls `postgres` et `service_role`), et elle n'est lue que depuis des
fonctions `SECURITY DEFINER` (`photos_de_reference_du_sportif` fait un `exists` dessus). Fermeture
volontaire à double tour. Aucun accès direct dans le code client (vérifié : le seul appel applicatif
du domaine est `retirer_photo_reference`, dans `app-connect/src/lib/supabase/reconnaissance.ts:62`).

### Le chemin des autorisations parentales est correctement gardé

Les trois fonctions vérifient l'autorité **après** avoir trouvé la ligne, ce qui est le bon ordre :

- `submit_parental_authorization` : `is_confirmed_parent_of` / `is_club_admin` / éducateur de l'équipe,
  et refuse la méthode `deja_detenue` à qui n'est pas dirigeant ;
- `verify_parental_authorization` : `is_club_admin` obligatoire ;
- `withdraw_parental_authorization` : `is_confirmed_parent_of` **ou** `is_club_admin`.

Sondées en anon, les trois rendent `400 Autorisation introuvable` — pas de fuite d'existence non
plus, puisqu'elles ne répondent rien d'autre.

### Le chemin de la reconnaissance est correctement gardé, sauf la purge

- `peut_deposer_photo_reference` = parent confirmé **ou** le sportif lui-même, **et** consentement
  actif. En anon : `false`.
- `photos_de_reference_du_sportif` s'appuie dessus dans son `where`. En anon : `[]`.
- `retirer_photo_reference` lève `42501` si `peut_deposer_photo_reference` est faux.
- `parent_set_child_photo` retourne `false` si `is_confirmed_parent_of` est faux.
- `media_etat_reconnaissance` : `401 Authentification requise.`
- `visage_reference_depuis_galerie` : `service_role` ou `media_upload_staff()`, **et** consentement
  actif, **et** version de texte ≥ v2, **et** photo confirmée par un humain. ACL propre
  (`postgres` + `service_role` seulement). C'est le modèle.

Seule `purger_visages_du_joueur` manque à l'appel (P0-2).

### Les fonctions de lecture du domaine club sont gardées

Sondées une par une avec la clé anon, corps plausible, identifiants **réels** :

| fonction | réponse anon | garde interne |
|---|---|---|
| `club_personnes` | `[]` | `cm_clubs_autorises()` |
| `club_membres_coordonnees` | `[]` | `auth.uid()` ou `peut_lire_annuaire_club` |
| `club_donnees_restreintes` | `[]` | — |
| `club_identite` | `[]` | — |
| `club_preparation` | `[]` | — |
| `club_onboarding_completion` | `401 Accès refusé.` | garde explicite |
| `cm_tableau_de_bord` | `401 Accès refusé.` | garde explicite |
| `equipe_roster_contacts` | `[]` | `is_team_educateur` (retour vide) |
| `match_player_candidates` | `401 Non autorisé pour ce club.` | garde explicite |
| `media_joueurs_de_galerie` | `[]` | `peut_marquer_galerie` |
| `media_marquages_famille`, `media_club_galleries`, `media_club_gallery_photos` | `[]` | — |
| `matchs_convocations_compte`, `club_affectations_cm`, `rpc_club_operational_summary` | `[]` | — |
| `connect_os_accounts_list` | `400 FORBIDDEN: reserve au staff` | garde explicite |
| `resolve_player_client_id` | `400 Joueur introuvable ou accès refusé.` | garde explicite |
| `import_club_players` | `400 Seul un administrateur du club peut importer un effectif` | garde |
| `preview_club_players_import` | `400 Non autorisé` | garde |
| `cm_club_infos_maj` | `400 Ce club n'est pas dans votre perimetre.` | garde |
| `provisionner_club_plus_full_com` | `400 Accès refusé : seul le staff SportVision peut provisionner` | garde |
| `copier_modele_photo_vers_saison` | `200 0` | `is_staff` / `is_club_admin` / `peut_operer_club` |
| `media_stats_exclure` | `200 false` | `media_pricing_staff_album` |
| `media_assets_reorder` | `401 Réordonnancement refusé.` | garde |
| `match_confirmation_retirer` | `401 Seul le coach … le président ou le secrétaire` | garde |
| `media_pricing_staff`, `media_commerce_staff`, `is_staff` | `false` | — |

Et toutes les fonctions de gestion des codes d'équipe et des invitations refusent en anon :
`create_invite_code`, `create_team_invite_code`, `deactivate_invite_code`, `rotate_team_invite_code`,
`redeem_invite_code` → `400` avec un message métier, pas une exécution.
Les cinq `connect_*_profile_access*` répondent `400 Authentification requise.`
Les neuf fonctions de traitement de demande (`accept_parent_invitation`, `accept_player_invitation`,
`claim_club_request`, `confirm_request_educateur`, `reject_team_membership`, `request_membership_info`,
`validate_team_membership`, `staff_update_club_request_status`, `update_request_status`,
`suspend_player_access`) refusent aussi.

### Aucun filtre sur une valeur inexistante, dans ce domaine

J'ai extrait, pour 22 tables du domaine (inscription, onboarding, consentement, invitations,
parent-enfant, profils, clubs), la liste réelle des valeurs admises par les contraintes
`CHECK (col = ANY (ARRAY[…]))`, puis cherché dans **tous** les corps de fonctions et **toutes** les
policies les comparaisons `col = 'x'` / `<> 'x'` / `in (…)` / `not in (…)` citant une valeur absente
de cette liste.

Le balayage brut remonte 201 citations. Je les ai reprises une par une : **toutes celles du domaine
sont des faux positifs de ma méthode** — une fonction qui touche plusieurs tables partageant une
colonne `statut` fait apparaître les valeurs de l'une comme suspectes pour l'autre. Vérifié en
lisant le code des candidates les plus plausibles :

- `recompute_request_readiness` compare `pa.statut = 'valide'` sur `parental_authorizations` : `valide`
  **est** dans la contrainte. Correct.
- `visage_reference_depuis_galerie` compare `c.statut = 'accorde'` sur `consentements_biometrie` :
  correct (`{accorde, retire}`).
- `connect_respond_profile_access_request` compare `status = 'active'` sur
  `connect_agent_subscriptions` : correct (`{incomplete, active, past_due, canceled}`).
- `peut_lire_siret_club`, `peut_lire_paiement_club`, `peut_lire_annuaire_club`,
  `peut_lire_sponsors_club` comparent bien `club_members.role` aux rôles de club et `profiles.role`
  aux rôles OS, sans les mélanger.

Donc : **pas de second cas de `statut not in ('annulee','contestee')`** dans le domaine audité. Je
n'étends pas cette conclusion hors domaine : le balayage sur les tables de production, finance et
média n'a pas été dépouillé, et il reste 100 citations à trancher là-bas. C'est le prochain endroit
où chercher.

---

## Ce que je n'ai pas pu vérifier

1. **L'exécution des correctifs proposés.** J'ai voulu les jouer dans une transaction annulée pour te
   livrer du SQL déjà mesuré (revoke, puis re-sonde en anon, puis contrôle que le déclencheur
   `trg_galeries_suivent_la_mission` passe toujours). Le garde-fou de mon environnement a refusé
   l'action, à juste titre : le script contenait des `revoke` et des `create or replace` sur la base
   de production. **Le SQL ci-dessus n'a donc pas été exécuté, même en rollback.** Il est écrit à
   partir des ACL réelles mesurées, mais relis-le avant de l'appliquer, et applique-le dans un
   `begin; … rollback;` d'abord, en rejouant les mesures de chaque section.
2. **Le corps complet des deux fonctions à re-créer** (`request_team_membership_as_player`,
   `galerie_rattachements`, `connect_respond_profile_access_request`). Je donne la garde et
   l'emplacement, pas le corps recopié : reprends-le par `pg_get_functiondef` pour ne rien perdre.
3. **L'effet du `revoke` de `media_activer_commande` sur un achat in-app réel.** Le raisonnement est
   solide (`iap-valider` s'exécute en `service_role`, que le `revoke` ne touche pas), mais c'est le
   chemin de paiement iOS/Android : à confirmer par un achat sandbox, pas par lecture.
4. **Les 100 citations de valeurs hors contrainte sur les domaines production / finance / média.**
   Hors périmètre de cette mission, mais le balayage est prêt et c'est là qu'un second cas se cache
   s'il en existe un.
5. **Les autres rôles applicatifs.** J'ai mesuré `anon` et deux identités `authenticated` de
   familles. Je n'ai pas fait le même balayage complet depuis un coach, un CM ou un opérateur
   terrain : les P0 ci-dessus n'en dépendent pas (ils n'ont aucune garde, donc tous les rôles
   passent), mais un audit des lectures par rôle reste à faire.
