-- Ce que Club+ voit des galeries, et surtout ce qu'il ne voit pas. Transaction annulée.
begin;

create temp table _res(n text, cas text, attendu text, obtenu text, ok boolean) on commit drop;
create temp table _ctx(nom text, val text) on commit drop;
grant all on _res to authenticated;
grant all on _ctx to authenticated;

do $$
declare
  vA uuid := '8be55101-0d61-4b27-8d7b-a4761547d88b';
  vB uuid; v_saison uuid; alA uuid; alB uuid; i integer;
begin
  select id into v_saison from saisons where label='2026-2027';
  -- Un second club, pour verifier le cloisonnement.
  insert into clubs (nom, saison_id) values ('ZZ Club B', v_saison) returning id into vB;

  insert into media_albums (club_id, saison_id, title, status)
  values (vA, v_saison, 'ZZ galerie club A', 'published') returning id into alA;
  insert into media_albums (club_id, saison_id, title, status)
  values (vB, v_saison, 'ZZ galerie club B', 'published') returning id into alB;
  for i in 1..5 loop
    insert into media_assets (album_id, club_id, original_path, preview_path, thumb_path, original_filename, status, position)
    values (alA, vA, 'm/'||i||'.jpg','p/'||i,'t/'||i,'P'||i||'.JPG','ready',i);
  end loop;

  -- Trois liens sur l'album du club A : un confie au club, deux internes.
  insert into media_album_links (album_id, slug, label, audience, visible_in_clubplus)
  values (alA, media_gallery_unique_slug('ZZ parents'), 'Lien parents', 'club_partenaire', true);
  insert into media_album_links (album_id, slug, label, audience, visible_in_clubplus)
  values (alA, media_gallery_unique_slug('ZZ adverse'), 'Lien equipe adverse', 'equipe_adverse', false);
  insert into media_album_links (album_id, slug, label, audience)
  values (alA, media_gallery_unique_slug('ZZ interne'), 'Promotion interne', 'personnalise');

  insert into _ctx values ('clubA', vA::text), ('clubB', vB::text), ('albumA', alA::text);
end $$;

-- Un membre du club A.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at)
values ('33333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'zz-clubA@exemple.fr','x',now(),now(),now());
-- Decor en service_role (10/09/2026) : protect_sensitive_club_member_fields interdit desormais
-- d'attribuer un role admin ou president a quiconque n'administre pas deja le club. En production
-- ces roles n'entrent que par service_role (acceptation d'invitation) : le decor prend ce chemin.
set local request.jwt.claims = '{"role":"service_role"}';
insert into club_members (club_id, user_id, role, status)
select (select val::uuid from _ctx where nom='clubA'), '33333333-3333-4333-8333-333333333333', 'admin', 'actif';

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare v_n integer; v_txt text;
begin
  -- On cible l'album de test : le club a d'autres albums publies pour de vrai, et compter
  -- l'ensemble ferait dependre le test de donnees qui evoluent.
  select count(*)::integer into v_n from media_club_galleries((select val::uuid from _ctx where nom='clubA'))
   where album_id = (select val::uuid from _ctx where nom='albumA');
  insert into _res values ('1','le club voit sa galerie','1',v_n::text,v_n=1);

  select photos into v_n from media_club_galleries((select val::uuid from _ctx where nom='clubA'))
   where album_id = (select val::uuid from _ctx where nom='albumA');
  insert into _res values ('1','avec le bon nombre de photos','5',v_n::text,v_n=5);

  -- LE point : seul le lien confie remonte.
  select jsonb_array_length(liens) into v_n from media_club_galleries((select val::uuid from _ctx where nom='clubA'))
   where album_id = (select val::uuid from _ctx where nom='albumA');
  insert into _res values ('2','un seul des trois liens est visible','1',v_n::text,v_n=1);
  select liens->0->>'label' into v_txt from media_club_galleries((select val::uuid from _ctx where nom='clubA'))
   where album_id = (select val::uuid from _ctx where nom='albumA');
  insert into _res values ('2','et c est bien le lien parents','Lien parents',coalesce(v_txt,'NULL'),v_txt='Lien parents');

  -- Aucun tarif ne remonte : le club ne voit pas ce que SportVision facture.
  select (liens->0)::text into v_txt from media_club_galleries((select val::uuid from _ctx where nom='clubA'))
   where album_id = (select val::uuid from _ctx where nom='albumA');
  insert into _res values ('2','aucun tarif dans ce que voit le club','aucun prix',
    case when v_txt like '%price%' or v_txt like '%cents%' then 'PRIX PRESENT' else 'aucun prix' end,
    v_txt is not null and v_txt not like '%price%' and v_txt not like '%cents%');

  -- ── 3. Cloisonnement ───────────────────────────────────────────────────
  select count(*)::integer into v_n from media_club_galleries((select val::uuid from _ctx where nom='clubB'));
  insert into _res values ('3','le club A ne voit rien du club B','0',v_n::text,v_n=0);

  -- ── 4. Le club ne peut pas toucher aux regles commerciales ─────────────
  select count(*)::integer into v_n from media_album_link_offers;
  insert into _res values ('4','le club ne lit pas les offres en direct','0',v_n::text,v_n=0);
  select count(*)::integer into v_n from media_album_links;
  insert into _res values ('4','ni les liens en direct','0',v_n::text,v_n=0);
  insert into _res select '4','ni fixer un prix','false', media_pricing_staff()::text, not media_pricing_staff();
end $$;
reset role;

-- ── 5. Un album non publie ne remonte pas ────────────────────────────────
update media_albums set status='draft' where id=(select val::uuid from _ctx where nom='albumA');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare v_n integer;
begin
  select count(*)::integer into v_n from media_club_galleries((select val::uuid from _ctx where nom='clubA'))
   where album_id = (select val::uuid from _ctx where nom='albumA');
  insert into _res values ('5','album non publie : invisible du club','0',v_n::text,v_n=0);
end $$;
reset role;

select n, cas, attendu, obtenu, ok from _res order by n, cas;

rollback;
