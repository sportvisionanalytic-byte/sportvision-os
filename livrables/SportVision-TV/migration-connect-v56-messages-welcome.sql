-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v56
-- Message d'accueil automatique dans "Messages" (Espace joueur).
--
-- Contexte : la maquette de référence (design-connect-personnel-12-08/
-- Connect Espace Joueur.dc.html, tableau `thread` par défaut) montre un
-- premier message du staff dans toute conversation neuve : "Bienvenue sur
-- SportVision Connect. Écrivez-nous ici pour toute question sur vos
-- prestations." Repéré le 15/08 en comparant l'implémentation réelle
-- (src/app/messages/MessagesThread.tsx) à cette maquette : l'app affichait
-- un état vide générique ("Aucun message pour le moment") à la place —
-- aucun seed de ce message n'existe côté base. Volontairement PAS reproduit
-- côté frontend seul (aurait fabriqué un faux message affiché sans jamais
-- exister en base, incohérent dès le premier vrai échange) : la source doit
-- être `messages_client`, comme tout le reste de la conversation.
--
-- Effet : `resolve_player_client_id` (migration-connect-v43-espace-joueur.sql)
-- crée la ligne `clients` la première fois qu'un joueur ouvre /messages. On
-- ajoute l'insertion du message de bienvenue à CET instant précis (juste
-- après la création du client, dans la même fonction) — jamais rejoué pour
-- un client déjà résolu (le `if v_client_id is not null then return` existant
-- empêche toute double insertion).
--
-- auteur_staff_id laissé NULL : message automatique, pas émis par une
-- personne précise (même convention que migration-connect-validation-
-- contenus.sql pour acteur_id/auteur_client_id).
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor.
-- Idempotente pour les clients déjà résolus (aucun effet, la branche insert
-- n'est atteinte que pour un client_id encore nul) ; pour les clients déjà
-- résolus SANS message de bienvenue historique, cette migration ne rattrape
-- rien rétroactivement — hors périmètre (pas de nouvelle donnée à inventer
-- pour des conversations déjà réelles).
-- ============================================================

create or replace function resolve_player_client_id(p_player_id uuid)
returns uuid language plpgsql security definer as $$
declare
  v_client_id uuid;
  v_prenom text;
  v_nom text;
begin
  select client_id, prenom, nom into v_client_id, v_prenom, v_nom
  from player_profiles
  where id = p_player_id and user_id = auth.uid();

  if not found then
    raise exception 'Joueur introuvable ou accès refusé.';
  end if;

  if v_client_id is not null then
    return v_client_id;
  end if;

  insert into clients (nom, type_client, prenom_contact, nom_contact)
  values (v_prenom || ' ' || v_nom, 'particulier', v_prenom, v_nom)
  returning id into v_client_id;

  update player_profiles set client_id = v_client_id where id = p_player_id;

  insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
    values (
      v_client_id, 'staff', null,
      'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.'
    );

  return v_client_id;
end;
$$;
