-- v382 — LES QUESTIONS DE QUIZ, OUVERTES AU PERSONNEL, SANS LES BONNES RÉPONSES (01/10/2026)
--
-- ═══ LE PROBLÈME, MESURÉ ═══════════════════════════════════════════════════════════════════════
--
-- `formation_quiz_questions` contient 1 133 questions, sur 104 formations, de 3 à 128 questions
-- chacune. Mesuré le 01/10/2026 par le chemin réel (`set local role authenticated`, claims
-- d'Antoine Blin, opérateur photo, 10 inscriptions, transaction annulée) :
--
--     select count(*) from formation_quiz_questions  →  0
--
-- Zéro sur 1 133. La seule policy de lecture, `fqq_admin_select`, exige `role = 'admin'`. Et
-- `rpc_get_custom_quiz('sv-culture')` rend « [] » : elle lit `formations_quiz_custom`, vide.
--
-- Un opérateur ne peut donc passer aucun quiz depuis quoi que ce soit d'autre que l'OS, qui porte
-- ses questions en dur dans son JavaScript.
--
-- ═══ POURQUOI LA POLICY N'EST PAS SIMPLEMENT ÉLARGIE ═══════════════════════════════════════════
--
-- Parce que `correct_index` est dans la même table. Une policy borne des LIGNES, pas des colonnes :
-- ouvrir la lecture au personnel, c'est livrer les 1 133 bonnes réponses à qui sait écrire une
-- requête. `migration-audit-08-08-formation-rewards-serveur.sql` l'avait déjà écrit noir sur blanc
-- comme la limite qu'elle ne fermait pas : « les questions ne doivent jamais être envoyées au
-- client avec leur bonne réponse ». Cette migration ferme ce point-là.
--
-- Un privilège de colonne (`revoke select (correct_index)`) a été écarté : PostgREST demande
-- `select=*` par défaut, et une colonne révoquée fait échouer la requête entière au lieu de la
-- réduire. On refuserait la lecture en croyant l'avoir bornée.
--
-- `fqq_admin_select` reste donc INCHANGÉE, et la table n'est jamais lue directement.
--
-- ═══ CE QUE FAIT CETTE MIGRATION ═══════════════════════════════════════════════════════════════
--
-- Une fonction, `rpc_lire_quiz(p_formation_id)`, qui rend les questions et leurs options, sans
-- `correct_index`, dans l'ORDRE EXACT où `rpc_submit_quiz` les corrige.
--
-- CET ORDRE EST TOUTE LA SÉCURITÉ DE LA CORRECTION, et il a été lu dans le corps de
-- `rpc_submit_quiz`, pas deviné : elle boucle sur
--
--     (formations_quiz_custom  where formation_id = … and v_custom_count > 0  order by ordre)
--     union all
--     (formation_quiz_questions where formation_id = … and v_custom_count = 0 order by q_index)
--
-- et lit la réponse donnée avec `p_answers ->> v_pos`, où `v_pos` part de 0 et avance d'un par
-- question. Autrement dit : `p_answers` est un TABLEAU JSON, et la réponse à la question de rang i doit
-- être à l'indice i de ce tableau. `rpc_lire_quiz` rejoue mot pour mot la même union et le même
-- tri, et numérote sa sortie avec le même compteur. Un écran qui affiche la liste dans l'ordre reçu
-- et renvoie un tableau dans le même ordre est donc corrigé sur les bonnes questions.
--
-- Si les deux fonctions divergeaient un jour, le quiz noterait la réponse d'une question sur une
-- autre, sans aucune erreur visible. Le contrôle final de cette migration compare, sur les 104
-- formations, le nombre de questions rendues par `rpc_lire_quiz` et le nombre de questions que
-- `rpc_submit_quiz` corrigerait.
--
-- ═══ QUI Y A DROIT ═════════════════════════════════════════════════════════════════════════════
--
-- La même règle que `rpc_get_custom_quiz`, recopiée pour que les deux ne divergent pas : le rôle
-- 'admin' ou 'prod', ou bien une inscription à CETTE formation. Un quiz est la fin d'une formation,
-- pas une page ouverte ; et un compte OS désactivé est refusé même avec un jeton encore valide.
--
-- ═══ CE QUE ÇA NE CHANGE PAS ═══════════════════════════════════════════════════════════════════
--
-- La correction, le seuil de 70 %, le bonus de 30 % de l'XP, le fait que seul le rôle 'photo' soit
-- crédité : tout reste dans `rpc_submit_quiz`, qui n'est pas touchée. Cette migration ne fait que
-- rendre les questions lisibles. `formations_quiz_custom` garde la priorité, comme aujourd'hui.

begin;

-- ── 1. La source de l'ordre, à UN seul endroit ────────────────────────────────────────────────
--
-- Cette fonction ne contrôle aucun droit : elle n'est appelable par personne d'autre que les deux
-- appelants ci-dessous. Elle existe pour que l'ordre des questions soit écrit une fois, et que le
-- contrôle de fin de migration puisse le vérifier réellement au lieu d'en recopier une deuxième
-- version qui dirait peut-être autre chose.
create or replace function public.quiz_questions_a_poser(p_formation_id text)
returns table (rang integer, question text, options jsonb)
language sql
stable
security definer
set search_path to 'public'
as $$
  with n as (
    select count(*)::int c from formations_quiz_custom where formation_id = p_formation_id
  )
  select (row_number() over (order by ordre) - 1)::int, question, options
    from formations_quiz_custom
   where formation_id = p_formation_id and (select c from n) > 0
  union all
  select (row_number() over (order by q_index) - 1)::int, question, options
    from formation_quiz_questions
   where formation_id = p_formation_id and (select c from n) = 0;
$$;

comment on function public.quiz_questions_a_poser(text) is
  'Les questions d''un quiz dans l''ordre exact où rpc_submit_quiz les corrige, sans les bonnes réponses. Usage interne : personne ne l''appelle directement, rpc_lire_quiz contrôle les droits (v382).';

revoke all on function public.quiz_questions_a_poser(text) from public;
revoke all on function public.quiz_questions_a_poser(text) from authenticated, anon;

-- ── 2. La fonction que l'écran appelle ────────────────────────────────────────────────────────

create or replace function public.rpc_lire_quiz(p_formation_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_autorise boolean;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  select
    exists (select 1 from profiles where id = v_uid and role in ('admin', 'prod'))
    or exists (select 1 from formation_inscriptions
                where formation_id = p_formation_id and collaborateur_id = v_uid)
  into v_autorise;

  if not v_autorise then
    raise exception 'Non autorisé : inscription requise pour accéder à ce quiz.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object('rang', q.rang, 'question', q.question, 'options', q.options)
             order by q.rang
           )
    from public.quiz_questions_a_poser(p_formation_id) q
  ), '[]'::jsonb);
end;
$$;

comment on function public.rpc_lire_quiz(text) is
  'Les questions d''un quiz et leurs options, sans les bonnes réponses, dans l''ordre exact où rpc_submit_quiz les corrige. La réponse à la question de rang i va à l''indice i du tableau passé à rpc_submit_quiz (v382).';

-- `revoke ... from public` NE SUFFIT PAS, ET C'EST MESURE. Supabase pose une permission par
-- defaut sur les fonctions (`alter default privileges ... grant execute ... to anon, authenticated`)
-- : c'est un droit EXPLICITE sur `anon`, que le revoke sur PUBLIC ne touche pas. Verifie dans
-- `proacl` apres la premiere application : `anon=X/postgres` etait encore la. La fonction refuse
-- de toute facon sans `auth.uid()`, mais un visiteur sans compte n'a rien a faire dans la liste
-- des fonctions qu'il peut appeler. `rpc_get_custom_quiz`, sa voisine, n'a pas ce droit.
revoke all on function public.rpc_lire_quiz(text) from public;
revoke all on function public.rpc_lire_quiz(text) from anon;
grant execute on function public.rpc_lire_quiz(text) to authenticated;

-- ── 3. Contrôle : autant de questions posées que de questions corrigées ───────────────────────
--
-- On compte ce que `rpc_submit_quiz` corrigerait, formation par formation, et on le compare à ce
-- que `quiz_questions_a_poser` rend. Un écart, c'est un quiz où la réponse d'une question serait
-- notée sur une autre, sans aucune erreur à l'écran.
--
-- `rpc_lire_quiz` n'est PAS appelable ici : elle exige `auth.uid()`, et une migration s'exécute en
-- `postgres`, sans jeton. C'est justement pourquoi l'ordre vit dans une fonction séparée.

do $$
declare
  v_ecarts integer;
  v_detail text;
begin
  select count(*), string_agg(x.formation_id || ' : ' || x.posees || ' posées contre ' || x.corrigees || ' corrigées', ', ')
    into v_ecarts, v_detail
  from (
    select r.formation_id,
           (select count(*)::int from public.quiz_questions_a_poser(r.formation_id)) as posees,
           (case when (select count(*) from formations_quiz_custom c where c.formation_id = r.formation_id) > 0
                 then (select count(*)::int from formations_quiz_custom c where c.formation_id = r.formation_id)
                 else (select count(*)::int from formation_quiz_questions q where q.formation_id = r.formation_id)
            end) as corrigees
    from formation_rewards r
  ) x
  where x.posees is distinct from x.corrigees;

  if v_ecarts > 0 then
    raise exception 'quiz_questions_a_poser et rpc_submit_quiz ne comptent pas les mêmes questions sur % formation(s) : %', v_ecarts, v_detail;
  end if;

  -- Les rangs doivent etre 0..n-1 sans trou, sinon `p_answers ->> v_pos` lirait a cote.
  select count(*) into v_ecarts from (
    select r.formation_id,
           (select count(*)::int from public.quiz_questions_a_poser(r.formation_id)) n,
           (select max(rang) from public.quiz_questions_a_poser(r.formation_id)) maxi,
           (select min(rang) from public.quiz_questions_a_poser(r.formation_id)) mini
    from formation_rewards r
  ) y where n > 0 and (mini <> 0 or maxi <> n - 1);
  if v_ecarts > 0 then
    raise exception 'Rangs de quiz non contigus sur % formation(s).', v_ecarts;
  end if;
end $$;

commit;

select count(*) filter (where n > 0) as formations_avec_quiz,
       sum(n) as questions_lisibles
from (select (select count(*)::int from public.quiz_questions_a_poser(formation_id)) n from formation_rewards) s;
