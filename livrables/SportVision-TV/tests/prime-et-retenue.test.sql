-- La Production peut récompenser, pas seulement retenir — et les deux obéissent aux mêmes règles.
--
-- DEMANDE DE FOUKA (27/09/2026) : « permettre aux responsables de production de donner des primes à
-- ces photographes vidéastes, de 0 jusqu'à 100 euros. Et aussi de pouvoir faire des retraits de
-- salaire de 0 jusqu'à 100. »
--
-- POURQUOI LA PRIME SUIT EXACTEMENT LES RÈGLES DE LA RETENUE, et ce n'est pas de la symétrie
-- décorative : un geste qui engage l'argent de l'entreprise se justifie et se trace, qu'il soit
-- favorable ou non. Un responsable qui n'a que le bâton ne s'en sert pas, ou s'en sert mal.
--
-- LA VÉRIFICATION QUI COMPTE LE PLUS est la dernière : le net à payer. Une prime décidée, tracée,
-- notifiée — et jamais versée — serait pire que pas de prime du tout, et ça ne se verrait qu'au
-- moment de payer.
--
-- N'ÉCRIT RIEN : le RAISE final annule la transaction.

do $$
declare
  v_prod uuid; v_ope uuid; v_autre uuid; v_client uuid; v_pres uuid; v_aff uuid; v_aff_prod uuid;
  v_pole uuid; v_res jsonb; e text[] := '{}'; m text; n numeric;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select id into v_pole from poles order by nom limit 1;

  v_prod := gen_random_uuid(); v_ope := gen_random_uuid(); v_autre := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
   values (v_prod,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-prime-prod@example.invalid','',now(),now(),now()),
          (v_ope,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-prime-ope@example.invalid','',now(),now(),now()),
          (v_autre,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-prime-autre@example.invalid','',now(),now(),now());
  insert into profiles (id,prenom,nom,email,role,actif) values
   (v_prod,'ZZ','PrimeProd','zz-prime-prod@example.invalid','prod',true),
   (v_ope,'ZZ','PrimeOpe','zz-prime-ope@example.invalid','photo',true),
   (v_autre,'ZZ','PrimeTiers','zz-prime-autre@example.invalid','photo',true);
  insert into pole_affectations (user_id,pole_id,actif) values (v_prod,v_pole,true);
  insert into clients (nom,statut,pole_id) values ('ZZ Client Prime','client',v_pole) returning id into v_client;
  insert into prestations (client_id,reference,date_prestation,statut,couverture)
   values (v_client,'ZZ-PRIME-T',current_date-1,'production_terminée','photo') returning id into v_pres;
  insert into prestations_equipe (prestation_id,collaborateur_id,fonction,remuneration,statut,statut_paiement)
   values (v_pres,v_ope,'Photo',80,'acceptée','en_attente') returning id into v_aff;
  -- La ligne du responsable lui-meme, pour verifier qu'il ne s'y sert pas.
  insert into prestations_equipe (prestation_id,collaborateur_id,fonction,remuneration,statut,statut_paiement)
   values (v_pres,v_prod,'Photo',60,'acceptée','en_attente') returning id into v_aff_prod;

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',v_prod::text,'role','authenticated')::text, true);

  -- ══ 1. LE NET À PAYER COMPTE LA PRIME ET LA RETENUE ══════════════════════
  if mission_net_a_payer(v_aff) <> 80 then
    e := e || format('net de depart %s au lieu de 80', mission_net_a_payer(v_aff)); end if;
  perform mission_primer(v_aff, 25, 'Belle couverture du plateau');
  if mission_net_a_payer(v_aff) <> 105 then
    e := e || format('apres une prime de 25 : net %s au lieu de 105 — LA PRIME NE SERA JAMAIS VERSEE', mission_net_a_payer(v_aff));
  end if;
  perform mission_penaliser(v_aff, 10, 'Trois matchs manquants');
  if mission_net_a_payer(v_aff) <> 95 then
    e := e || format('apres une retenue de 10 : net %s au lieu de 95', mission_net_a_payer(v_aff)); end if;

  -- ══ 2. LE PLAFOND DE 100 €, DES DEUX CÔTÉS ═══════════════════════════════
  m := null;
  begin perform mission_primer(v_aff, 150, 'Trop'); exception when others then m := sqlerrm; end;
  if m is null then e := e || 'une prime de 150 EUR a ete acceptee'::text; end if;
  m := null;
  begin perform mission_penaliser(v_aff, 150, 'Trop'); exception when others then m := sqlerrm; end;
  if m is null then e := e || 'une retenue de 150 EUR a ete acceptee'::text; end if;

  -- ══ 3. PAS DE MOTIF, PAS DE GESTE ════════════════════════════════════════
  m := null;
  begin perform mission_primer(v_aff, 20, '   '); exception when others then m := sqlerrm; end;
  if m is null then e := e || 'une prime sans motif a ete acceptee'::text; end if;

  -- ══ 4. JAMAIS SUR SA PROPRE LIGNE ════════════════════════════════════════
  --
  -- Meme frontiere que la retenue depuis la v231 : on n'est pas juge et partie sur son propre
  -- salaire. Se VALIDER est permis depuis la v270, se PRIMER ne l'est pas — ce n'est pas la meme
  -- chose : l'un constate un travail fait, l'autre décide d'un versement.
  m := null;
  begin perform mission_primer(v_aff_prod, 30, 'Sur ma propre ligne'); exception when others then m := sqlerrm; end;
  if m is null then e := e || 'un responsable s est prime LUI-MEME'::text; end if;

  -- ══ 5. UN TIERS NE DECIDE RIEN ═══════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub',v_autre::text,'role','authenticated')::text, true);
  m := null;
  begin perform mission_primer(v_aff, 20, 'Je me sers'); exception when others then m := sqlerrm; end;
  if m is null then e := e || 'un operateur tiers a accorde une prime'::text; end if;

  -- ══ 6. ANNULER LAISSE LA TRACE, ET REND L'ARGENT ═════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub',v_prod::text,'role','authenticated')::text, true);
  perform mission_prime_annuler((select id from mission_primes where affectation_id = v_aff limit 1),
                                'Finalement la livraison etait incomplete');
  if mission_net_a_payer(v_aff) <> 70 then
    e := e || format('apres annulation de la prime : net %s au lieu de 70', mission_net_a_payer(v_aff)); end if;
  perform set_config('role','postgres',true);
  select count(*) into n from mission_primes where affectation_id = v_aff and statut = 'annulee'
    and annulee_par = v_prod and annulation_motif is not null;
  if n <> 1 then e := e || 'la prime annulee ne garde pas sa trace (qui, pourquoi)'::text; end if;
  select count(*) into n from mission_primes where affectation_id = v_aff;
  if n <> 1 then e := e || 'la prime a ete EFFACEE au lieu d etre marquee annulee'::text; end if;

  if cardinality(e) > 0 then
    raise exception 'ROUGE : %', array_to_string(e, ' | ');
  end if;
  raise exception 'VERT : la prime et la retenue obeissent aux memes regles, et le net a payer les compte toutes les deux';
end $$;
