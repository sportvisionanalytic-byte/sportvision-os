-- RCP Fontainebleau — mise en service du Pass Photo (14/09/2026, décisions de Fouka).
--
-- CE QUI EST DÉCIDÉ :
--   • Prix du Pass Photo saison : 39,90 € TTC, paiement unique.
--   • Politique par défaut des galeries du club : `pass_saison`. Une famille sans Pass voit les
--     aperçus filigranés et peut acheter ; avec le Pass, elle accède à tout pour la saison.
--   • Reversement au club (`revenue_share_pct`) : laissé VIDE. Ce pourcentage n'est utilisé par
--     AUCUN calcul aujourd'hui — l'inscrire reviendrait à promettre au président un montant que
--     personne ne calcule. Décision en attente.
--
-- CE QUE LE PASS OUVRE, tel que `can_access_media` le lit déjà : portée `club`, donc toutes les
-- galeries du club pour la saison 2026-2027, et seulement celle-là (un Pass ne déborde pas sur la
-- saison suivante, borne posée le 04/09).
--
-- Le reste de la chaîne existe et n'a rien à recevoir ici : `create-pass-photo-checkout` relit le
-- prix en base (jamais celui envoyé par le navigateur), le webhook Stripe écrit le droit après
-- paiement réel, et `gallery-download` honore ce droit depuis la correction du 13/09.
--
-- Idempotente : rejouer ne crée pas de second produit ni de seconde politique.

do $$
declare
  v_club uuid;
  v_saison uuid;
  v_admin uuid;
  v_produit uuid;
begin
  select id into v_club from clubs where nom = 'RCP Fontainebleau';
  if v_club is null then raise exception 'Club RCP Fontainebleau introuvable'; end if;

  select id into v_saison from saisons where label = '2026-2027';
  if v_saison is null then raise exception 'Saison 2026-2027 introuvable'; end if;

  -- Un auteur traçable : l'administrateur SportVision, pas un identifiant inventé.
  select id into v_admin from profiles where role = 'admin' and actif order by created_at limit 1;

  -- ── La politique du club ───────────────────────────────────────────────────
  if not exists (select 1 from media_club_policy where club_id = v_club and saison_id = v_saison) then
    insert into media_club_policy (club_id, saison_id, default_policy, revenue_share_pct, status, created_by)
    values (v_club, v_saison, 'pass_saison', null, 'active', v_admin);
  else
    update media_club_policy
       set default_policy = 'pass_saison', status = 'active', updated_at = now()
     where club_id = v_club and saison_id = v_saison;
  end if;

  -- ── Le Pass Photo saison ───────────────────────────────────────────────────
  select id into v_produit from media_products
   where club_id = v_club and saison_id = v_saison and type = 'pass_saison' and status <> 'ended';

  if v_produit is null then
    insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type,
                                physical_product, status, valid_from, created_by)
    values (v_club, v_saison, 'Pass Photo saison 2026-2027', 'pass_saison', 3990, 'eur', 'club',
            false, 'active', current_date, v_admin);
  else
    update media_products
       set name = 'Pass Photo saison 2026-2027', price_cents = 3990, currency = 'eur',
           scope_type = 'club', physical_product = false, status = 'active', updated_at = now()
     where id = v_produit;
  end if;
end $$;

select c.nom || ' · ' || p.default_policy || ' · pass ' || (m.price_cents / 100.0) || ' ' || upper(m.currency)
       || ' · ' || m.status || ' · reversement : ' || coalesce(p.revenue_share_pct::text || ' %', 'non défini') as verdict
  from media_club_policy p
  join clubs c on c.id = p.club_id
  join media_products m on m.club_id = p.club_id and m.saison_id = p.saison_id and m.type = 'pass_saison'
 where c.nom = 'RCP Fontainebleau';
