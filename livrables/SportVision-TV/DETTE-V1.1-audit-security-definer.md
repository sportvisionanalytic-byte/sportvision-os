# Dette V1.1 — Audit SECURITY DEFINER et `search_path`

**Statut** : ouverte · priorité V1.1 · **ne bloque pas le lancement multi-clubs**
**Décidée par** : Fouka, 10/09/2026. « Ne modifie surtout pas les 261 fonctions en masse. […]
Aucun grand refactor avant lancement. »

---

## Pourquoi ce n'est pas urgent, et pourquoi ce n'est pas « on n'y pense plus »

261 fonctions `SECURITY DEFINER` fixent `search_path = public` sans `pg_temp` en dernier. En
théorie, un objet temporaire homonyme pourrait alors masquer une table. En pratique, créer un
objet temporaire demande un accès SQL qu'un utilisateur de l'application n'a pas : il ne parle
qu'à PostgREST. C'est d'ailleurs la forme que le linter Supabase accepte.

Le risque réel est ailleurs : une fonction `SECURITY DEFINER` s'exécute avec les droits de son
propriétaire et **contourne la RLS**. Chacune est donc une porte, et vaut exactement le contrôle
qu'elle fait elle-même. C'est ce contrôle qu'il faut auditer, fonction par fonction — le
`search_path` n'en est qu'un point.

## Le périmètre, mesuré le 10/09/2026

| | Fonctions |
|---|---|
| `SECURITY DEFINER` appelables par l'API (hors triggers) | 240 |
| dont exécutables **sans compte** (`anon`) | 218 |
| qui **écrivent** | 93 |
| qui écrivent **et** touchent une table sensible | **69 — le périmètre de l'audit** |
| parmi elles, exécutables par `anon` | 58 |
| parmi elles, `search_path` sans `pg_temp` | 53 |
| avec du SQL dynamique | 2 — lues le 10/09, **aucune exploitable** (voir plus bas) |

Tables jugées sensibles : membres et invitations de club, profils, clubs, affectations CM,
rattachements joueurs, liens parent-enfant, données Connect, facturation (factures, devis,
contrats, paiements, avoirs), commandes et galeries, `auth.users`.

Les 218 fonctions exécutables par `anon` ne sont pas 218 failles : Postgres accorde `EXECUTE` à
`PUBLIC` par défaut, et la plupart vérifient `auth.uid()` en première ligne. Mais l'audit doit le
**constater** pour chacune, pas le supposer — c'est exactement ainsi qu'est née la faille RPC
anonyme fermée le 09/09.

## Correction du 10/09/2026 : la lecture compte autant que l'écriture

Ce document ne ciblait d'abord que les fonctions qui **écrivent**. Le jour même, deux fuites ont
été trouvées **en lecture**, hors de ce périmètre :

- `club_calendrier` rendait sans compte le calendrier complet d'un club, horaires et lieux
  d'entraînement d'équipes de mineurs compris. Corrigé par v120.
- `find_player_match_candidates` rendait sans compte l'identifiant et la date de naissance d'un
  joueur dont on connaît le club et le nom. `find_duplicate_club_candidates` rendait clubs et
  SIRET. Corrigé par v122, avec deux outils internes qui écrivaient sans contrôle.

Un second balayage (v123) a ajouté les fonctions appelables par **tout compte connecté** et celles
qui ne vérifient que la connexion, pas l'appartenance au club. Trois outils internes qui
écrivaient sans contrôle ont été fermés : le limiteur de débit (un visiteur pouvait bloquer une
adresse e-mail sur les parcours limités), la création de saisons, et `club_president_connu`.

Un balayage ciblé a suivi : toute fonction à droits propriétaire, appelable sans compte, qui
prend un identifiant et ne contient aucun contrôle reconnaissable. Les restantes ont été lues une
par une : elles contrôlent par une fonction au nom non standard (`media_pricing_staff_album`,
`is_member_of_user_group`, `_media_stats_albums`), ou ne rendent qu'un booléen ou des tarifs
publics. **L'audit V1.1 doit donc couvrir aussi les fonctions qui lisent des données
personnelles**, en commençant par celles qui rendent des personnes (joueurs, parents,
encadrants) ou des lieux et horaires.

Repère pratique : une fonction publique **par conception** prend un secret (un jeton, un slug de
galerie avec son jeton, un code d'invitation). Une fonction qui prend un simple identifiant et
reste appelable sans compte est suspecte jusqu'à preuve du contraire.

## La grille, pour chaque fonction du périmètre

1. **Qui a le droit** — le contrôle d'autorité est-il en tête, avant toute lecture ou écriture ?
   S'appuie-t-il sur une fonction d'autorité existante (`peut_operer_club`, `is_club_admin`,
   `is_real_club_admin`, `peut_basculer_saison`, `is_team_educateur`) plutôt que sur une règle
   réécrite ?
2. **`search_path`** — `public, pg_temp`, ou références qualifiées `public.`.
3. **SQL dynamique** — aucun ; ou identifiants passés par `%I`, valeurs par `USING`, et liste
   blanche des identifiants acceptés.
4. **`EXECUTE` minimal** — `revoke … from public, anon` si la fonction n'a aucun sens sans compte ;
   `grant … to authenticated`. Révoquer depuis `PUBLIC`, pas seulement depuis `anon` (leçon du
   09/09).
5. **Preuve** — un appel réel par PostgREST avec le jeton d'un rôle qui ne doit pas passer, refus
   mesuré sur la ligne en base, pas sur une réponse vide.

## Les deux fonctions à SQL dynamique, lues le 10/09/2026

- `connect_update_profile_access_right` — exige un compte, n'accepte que 9 noms de droits
  (liste blanche), cite l'identifiant par `%I`, passe les valeurs par `USING`, vérifie que
  l'appelant possède la ligne. **Sûre.** À durcir seulement : `search_path` et `EXECUTE` anon.
- `rls_auto_enable` — déclencheur d'événement (`event_trigger`), non appelable directement.

## Déjà traitées pendant le chantier Permissions CM / Club V1

v111 (durcissement), v114, v115 et v116 ont posé `search_path = public, pg_temp` et, là où
c'était utile, révoqué `EXECUTE` depuis `PUBLIC` et `anon` sur les fonctions qu'elles créaient
ou réécrivaient.

## Ordre proposé

1. Les **58** exécutables par `anon` qui écrivent une table sensible (en tête de la liste).
2. Les 11 autres du périmètre.
3. Le reste seulement si l'audit des deux premiers groupes révèle un motif récurrent.

Une fonction à la fois, avec son test. Pas de migration de masse.

## La liste (69 fonctions, anon d'abord)

| Fonction | Exécutable par | `search_path` | Tables sensibles touchées |
|---|---|---|---|
| `accept_player_invitation` | anon + connectés | à durcir | player_profiles, clubs |
| `cancel_coverage_wish` | anon + connectés | à durcir | profiles, club_members, clubs |
| `claim_club_request` | anon + connectés | à durcir | profiles |
| `client_decide_devis` | anon + connectés | à durcir | devis |
| `client_mark_message_read` | anon + connectés | à durcir | connect_access_relationships, connect_owner_client_id |
| `client_valider_contenu` | anon + connectés | à durcir | profiles |
| `club_booking_send_to_production` | anon + connectés | à durcir | profiles, clubs |
| `clubplus_claim_self_service_onboarding` | anon + connectés | à durcir | club_members, clubs |
| `cm_reject_coverage_wish` | anon + connectés | à durcir | profiles |
| `cm_select_coverage_wish` | anon + connectés | à durcir | profiles, clubs |
| `connect_add_manual_calendar_event` | anon + connectés | à durcir | connect_access_relationships, connect_manual_calendar_events, connect_add_manual_calendar_event |
| `connect_choose_especes_for_prestation` | anon + connectés | à durcir | connect_client_ids_for_caller, connect_choose_especes_for_prestation |
| `connect_create_managed_athlete` | anon + connectés | à durcir | connect_particulier_limit, connect_create_managed_athlete, connect_particulier_total_sportifs_count |
| `connect_delete_manual_calendar_event` | anon + connectés | à durcir | connect_manual_calendar_events, connect_delete_manual_calendar_event |
| `connect_join_club_via_smart_link` | anon + connectés | à durcir | connect_join_club_via_smart_link, player_profiles, clubs |
| `connect_remove_athlete_relationship` | anon + connectés | à durcir | connect_remove_athlete_relationship, connect_access_relationships |
| `connect_request_profile_access` | anon + connectés | à durcir | connect_access_relationships, connect_request_profile_access, auth.users |
| `connect_resolve_beneficiary_client_id` | anon + connectés | à durcir | auth.users, connect_resolve_beneficiary_client_id, connect_access_relationships, player_profiles, connect_profile_settings |
| `connect_respond_profile_access_request` | anon + connectés | à durcir | connect_agent_tier_limit, connect_agent_subscriptions, connect_access_relationships, connect_respond_profile_access_request, connect_particulier_limit, connect_agent_effective_tier, connect_particulier_total_sportifs_count, connect_profile_settings |
| `connect_revoke_profile_access` | anon + connectés | à durcir | connect_access_relationships, connect_revoke_profile_access |
| `connect_update_profile_access_right` | anon + connectés | à durcir | connect_access_relationships, connect_update_profile_access_right, factures |
| `create_coverage_wishes` | anon + connectés | à durcir | profiles, club_members, clubs |
| `create_group_funding` | anon + connectés | à durcir | connect_access_relationships, devis, player_profiles, connect_client_ids_for_caller |
| `credit_organization` | anon + connectés | à durcir | profiles |
| `fin_ignorer_transaction` | anon + connectés | à durcir | profiles |
| `fin_rapprocher_transaction` | anon + connectés | à durcir | paiements, stripe_payment_intent_id, profiles, factures |
| `generate_missions_from_plan` | anon + connectés | à durcir | profiles |
| `import_club_players` | anon + connectés | à durcir | team_memberships, player_profiles |
| `join_user_group` | anon + connectés | à durcir | player_profiles, auth.users |
| `pole_calculer_remuneration_responsable` | anon + connectés | à durcir | contrats |
| `pole_valider_remuneration_responsable` | anon + connectés | à durcir | profiles |
| `provisionner_club_plus_full_com` | anon + connectés | à durcir | profiles, contrats, clubs |
| `request_team_membership_as_player` | anon + connectés | à durcir | player_profiles, clubs |
| `request_team_membership_for_child` | anon + connectés | à durcir | player_profiles, clubs |
| `request_team_membership_for_existing_child` | anon + connectés | à durcir | player_profiles, clubs |
| `resolve_player_client_id` | anon + connectés | à durcir | player_profiles |
| `rpc_ajouter_membre_equipe` | anon + connectés | à durcir | profiles |
| `rpc_complete_formation` | anon + connectés | à durcir | profiles |
| `rpc_retirer_membre_equipe` | anon + connectés | à durcir | profiles |
| `rpc_submit_quiz` | anon + connectés | à durcir | profiles |
| `staff_mark_media_order_shipped` | anon + connectés | à durcir | media_orders |
| `submit_club_request` | anon + connectés | à durcir | contrats, club_members, clubs |
| `submit_parental_authorization` | anon + connectés | à durcir | team_memberships, player_profiles |
| `suspend_player_access` | anon + connectés | à durcir | player_profiles |
| `update_club_request_status` | anon + connectés | à durcir | profiles, clubs |
| `update_request_status` | anon + connectés | à durcir | profiles |
| `validate_team_membership` | anon + connectés | à durcir | team_memberships, player_profiles, clubs |
| `verify_parental_authorization` | anon + connectés | à durcir | player_profiles |
| `withdraw_parental_authorization` | anon + connectés | à durcir | player_profiles |
| `cm_annuler_couverture` | anon + connectés | ✅ | clubs |
| `cm_client_logo_maj` | anon + connectés | ✅ | profiles |
| `cm_club_infos_maj` | anon + connectés | ✅ | factures, clubs |
| `cm_definir_couverture` | anon + connectés | ✅ | clubs |
| `media_gallery_claim_order` | anon + connectés | ✅ | media_orders, auth.users |
| `media_gallery_order_select` | anon + connectés | ✅ | media_orders |
| `media_link_save` | anon + connectés | ✅ | media_orders |
| `media_link_type_product` | anon + connectés | ✅ | clubs |
| `staff_update_club_request_status` | anon + connectés | ✅ | profiles, clubs |
| `accept_club_invitation` | connectés | à durcir | club_members |
| `decline_club_invitation` | connectés | à durcir | club_members |
| `propose_candidature_direction` | connectés | à durcir | profiles |
| `validate_production` | connectés | à durcir | profiles, contrats, connect_orders |
| `accepter_invitation_club` | connectés | ✅ | auth.users, club_invitations, club_members |
| `accepter_invitation_joueur` | connectés | ✅ | player_profiles, clubs |
| `decider_lien_parent` | connectés | ✅ | team_memberships, player_profiles |
| `marquer_invitation_envoyee` | connectés | ✅ | club_invitations |
| `preparer_invitation_club` | connectés | ✅ | club_invitations |
| `renew_season_membership` | connectés | ✅ | team_memberships |
| `revoquer_invitation_club` | connectés | ✅ | club_invitations |

Liste recalculable par `tests/inventaire-security-definer.sql` (fonctions
`prosecdef`, hors `trigger`, `has_function_privilege` pour `anon` / `authenticated`, recherche
des `insert into` / `update … set` / `delete from` dans le corps).
