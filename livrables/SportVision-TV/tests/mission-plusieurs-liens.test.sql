-- Une mission accepte autant de liens que nécessaire, et ils sont tous relus (v233, 14/09/2026).
--
-- DEMANDE DE FOUKA : « sur une mission parfois il y a plusieurs liens à mettre ou pas, faire en
-- sorte que les photographes-vidéastes mettent le nombre de liens qu'ils veulent pour valider la
-- presta ».
--
-- CE QUI EXISTAIT DÉJÀ : la base n'a jamais limité le nombre de liens d'une mission, aucune
-- unicité, aucun plafond. Le défaut était ailleurs, et c'était le revers de cette liberté : les
-- contrôles de clôture se contentaient de TROUVER un lien valide par catégorie. Avec trois liens
-- photo dont un seul relu, la mission se clôturait en laissant deux liens jamais vérifiés, et un
-- lien pour lequel la Production avait demandé une correction ne bloquait rien.
--
-- CE QU'ON MESURE :
--   1. Trois liens photo cohabitent sur la même mission, sans rien casser.
--   2. Tant qu'un lien reste « à vérifier », la mission n'est pas clôturable.
--   3. Un lien en « correction demandée » bloque, même si un autre est validé.
--   4. Tous relus : la mission redevient clôturable.
--   5. Retirer le lien fautif débloque aussi — on n'oblige personne à garder un lien mort.
--   6. Un lien hors catégories habituelles (un drone) est accepté comme les autres : il est relu
--      comme les autres, et une correction demandée dessus bloque comme sur n'importe quel autre.
--
-- 21/09/2026 (v240) : la notion de « livrable attendu » a disparu. Plus rien n'est imposé par la
-- couverture, et en contrepartie AUCUN lien n'échappe à la relecture, qu'il soit « final » ou
-- annexe. Les points 1 à 5 sont inchangés ; le point 6 est devenu plus strict.

begin;

do $$
declare
  v_client uuid; v_pres uuid; v_admin uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid;
  m text[]; e text[] := '{}';
begin
  perform set_config('request.jwt.claims','{"role":"service_role"}', true);
  select id into v_admin from profiles where role='admin' and actif order by created_at limit 1;
  insert into clients (nom, statut) values ('ZZ Client Liens','client') returning id into v_client;
  insert into prestations (client_id, reference, date_prestation, statut, couverture)
    values (v_client,'ZZ-LIENS-001', current_date - 1, 'production_terminée','photo') returning id into v_pres;

  -- Le décor de clôture, hors liens : terrain fait, fichiers sécurisés.
  insert into mission_suivi_operateur (prestation_id, collaborateur_id, prestation_terminee_at, fichiers_securises_at)
    values (v_pres, v_admin, now(), now());

  -- ══ 1. TROIS LIENS PHOTO SUR LA MÊME MISSION ═════════════════════════════
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, transfert_confirme, ajouteur_id)
    values (v_pres,'Photos — 1re mi-temps','https://ex.invalid/1','final','photo','valide',true,v_admin) returning id into l1;
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, ajouteur_id)
    values (v_pres,'Photos — 2e mi-temps','https://ex.invalid/2','final','photo','a_verifier',v_admin) returning id into l2;
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, ajouteur_id)
    values (v_pres,'Photos — podium','https://ex.invalid/3','final','photo','a_verifier',v_admin) returning id into l3;
  if (select count(*) from media_liens where prestation_id = v_pres) <> 3 then
    e := e || 'la base refuse plusieurs liens sur une mission'::text;
  end if;

  -- ══ 2. UN LIEN NON VÉRIFIÉ BLOQUE LA CLÔTURE ═════════════════════════════
  m := mission_cloture_manquant(v_pres);
  if not ('Un lien n''a pas encore été vérifié par la Production' = any(m)) then
    e := e || format('deux liens non relus ne bloquent pas la cloture : %s', array_to_string(m,' ; '));
  end if;

  -- ══ 3. UNE CORRECTION DEMANDÉE BLOQUE, MÊME AVEC UN LIEN VALIDE ══════════
  update media_liens set statut='valide' where id = l2;
  update media_liens set statut='correction_demandee', commentaire='Photos sous-exposées' where id = l3;
  m := mission_cloture_manquant(v_pres);
  if not ('Un lien attend une correction demandée par la Production' = any(m)) then
    e := e || format('une correction demandee ne bloque pas : %s', array_to_string(m,' ; '));
  end if;

  -- ══ 4. TOUS RELUS : LA MISSION EST CLÔTURABLE ════════════════════════════
  update media_liens set statut='valide' where id = l3;
  m := mission_cloture_manquant(v_pres);
  if array_length(m,1) is not null then
    e := e || format('trois liens valides et la cloture reste bloquee : %s', array_to_string(m,' ; '));
  end if;

  -- ══ 5. RETIRER LE LIEN FAUTIF DÉBLOQUE AUSSI ═════════════════════════════
  update media_liens set statut='correction_demandee' where id = l3;
  delete from media_liens where id = l3;
  m := mission_cloture_manquant(v_pres);
  if array_length(m,1) is not null then
    e := e || format('apres retrait du lien fautif, la cloture reste bloquee : %s', array_to_string(m,' ; '));
  end if;

  -- ══ 6. UN LIEN HORS CATEGORIES HABITUELLES ═══════════════════════════════
  -- Un drone n'entre dans aucune categorie « attendue » de l'ancien modele. Il se depose sans
  -- demarche particuliere, et depuis la v240 il est relu comme les autres : il n'y a plus de
  -- liens de seconde zone que la Production pourrait ignorer.
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, ajouteur_id)
    values (v_pres,'Drone — survol','https://ex.invalid/4','livraison','drone','a_verifier',v_admin) returning id into l4;
  m := mission_cloture_manquant(v_pres);
  if not ('Un lien n''a pas encore été vérifié par la Production' = any(m)) then
    e := e || format('un lien annexe non relu passe sous le radar : %s', coalesce(array_to_string(m,' ; '),'rien'));
  end if;
  update media_liens set statut='valide' where id = l4;
  m := mission_cloture_manquant(v_pres);
  if array_length(m,1) is not null then
    e := e || format('le lien annexe relu bloque encore : %s', array_to_string(m,' ; '));
  end if;
  -- En revanche, s'il fait l'objet d'une correction demandee, il bloque comme n'importe quel autre.
  update media_liens set statut='correction_demandee', commentaire='Survol hors cadre' where id = l4;
  m := mission_cloture_manquant(v_pres);
  if not ('Un lien attend une correction demandée par la Production' = any(m)) then
    e := e || 'une correction demandee sur un lien annexe ne bloque pas'::text;
  end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — une mission porte autant de liens que nécessaire, de n''importe quelle nature ; aucun lien ne passe sous le radar et une correction demandée bloque, où qu''elle porte.' as verdict;

rollback;
