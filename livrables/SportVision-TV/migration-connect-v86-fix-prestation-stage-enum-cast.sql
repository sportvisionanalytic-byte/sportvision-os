-- migration-connect-v86-fix-prestation-stage-enum-cast.sql
-- EXÉCUTÉE, vérifiée le 20/08/2026.
--
-- Bug remonté en direct dans l'OS (20/08/2026) : "Erreur : function connect_prestation_stage
-- (statut_prestation) does not exist" en enregistrant une prestation dont le statut change.
-- prestations.statut est de type énuméré statut_prestation, mais connect_prestation_stage()
-- (migration-connect-v53) n'accepte que du texte — trg_notify_prestation_stage() lui passait
-- old.statut/new.statut sans caster, ce que Postgres ne convertit pas implicitement dans un
-- appel de fonction. Le trigger avait été créé sans erreur (plpgsql ne type-check pas le corps à
-- la création), donc invisible jusqu'au premier UPDATE de statut réellement exécuté en prod —
-- ici, la première prestation issue d'une réservation Connect (Espace joueur, paiement à
-- plusieurs/cotisation) à changer de statut. Cast explicite ::text au point d'appel, aucun
-- changement de signature (connect_prestation_stage reste appelable avec du texte simple
-- ailleurs si besoin).

create or replace function public.trg_notify_prestation_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old_stage text;
  v_new_stage text;
  v_title text;
  v_body text;
  v_label text;
begin
  v_old_stage := connect_prestation_stage(old.statut::text);
  v_new_stage := connect_prestation_stage(new.statut::text);

  if v_new_stage = v_old_stage or v_new_stage = 'en_validation' then
    return new;
  end if;

  v_label := coalesce(nullif(new.reference, ''), 'Votre prestation');

  case v_new_stage
    when 'confirmee' then
      v_title := 'Prestation confirmée';
      v_body := v_label || ' a été confirmée par SportVision.';
    when 'planifiee' then
      v_title := 'Prestation planifiée';
      v_body := v_label || ' est planifiée' ||
        case when new.date_prestation is not null then ' le ' || to_char(new.date_prestation, 'DD/MM/YYYY') else '' end || '.';
    when 'en_production' then
      v_title := 'Contenus en cours de production';
      v_body := 'L''équipe SportVision travaille sur les contenus de ' || v_label || '.';
    when 'livree' then
      v_title := 'Vos contenus sont livrés';
      v_body := 'Les contenus de ' || v_label || ' sont disponibles.';
    when 'terminee' then
      v_title := 'Prestation terminée';
      v_body := v_label || ' est maintenant terminée.';
    when 'annulee' then
      v_title := 'Prestation annulée';
      v_body := v_label || ' a été annulée.';
    else
      return new;
  end case;

  perform connect_notify_by_client_id(new.client_id, 'services', v_title, v_body, '/commandes/' || new.id, '/particulier/commandes/' || new.id);

  return new;
end;
$function$;
