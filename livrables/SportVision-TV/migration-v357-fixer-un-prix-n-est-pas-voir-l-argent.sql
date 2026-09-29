-- v357 — FIXER UN PRIX N'EST PAS VOIR L'ARGENT (29/09/2026, décision de Fouka)
--
-- LE DÉFAUT, ET SON ORIGINE. La décision du 07/09 donnait au Secrétariat le droit de FIXER les prix
-- des liens de galerie : « c'est lui qui prépare les liens au quotidien ». Elle ne disait rien du
-- droit de VOIR LE CHIFFRE D'AFFAIRES. Mais les deux passaient par la même porte,
-- `media_pricing_staff()`, donc le Secrétariat a gagné l'accès au CA par lien en même temps, sans
-- que ce soit demandé ni examiné. Le test `galerie-permissions-tarifs` tenait ce rouge en attente
-- depuis le 28/09 plutôt que de graver un choix que personne n'avait fait.
--
-- ARBITRAGE DE FOUKA, 29/09 : « Non, le CA reste réservé. »
--
-- CE QU'ON NE FAIT PAS, ET C'EST LE PIÈGE QUE LE TEST TENDAIT. Son attente d'origine était « aucune
-- ligne » pour le Secrétariat. Or cette fonction alimente l'écran de GESTION des liens : libellés,
-- offres, prix, activation, nombre de vues. Zéro ligne, c'est un écran vide, et le Secrétariat ne
-- peut plus faire le travail que la décision du 07/09 lui confie. On aurait échangé une fuite de
-- données contre un blocage de travail — la faute symétrique, celle du 11/09 (« écran toujours vide
-- = droits trop fermés »).
--
-- Il voit donc ses liens, et l'argent est MASQUÉ : `orders_count` et `revenue_cents` reviennent null.
-- Les deux ensemble, parce que masquer le seul chiffre d'affaires ne sert à rien quand le nombre de
-- commandes multiplié par le prix le redonne.

create or replace function public.media_revenus_visibles()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Qui a le droit de voir l'argent : la direction, la production, la comptabilité, et un
  -- responsable de pôle sur son périmètre. PAS le Secrétariat, qui fixe les prix sans voir les
  -- recettes (décision de Fouka du 29/09/2026).
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.actif and p.role in ('admin','prod','compta')
  )
  or exists (
    select 1 from pole_affectations pa
    where pa.user_id = auth.uid() and pa.role_pole = 'responsable' and pa.actif
      and not public.compte_os_desactive()
  );
$$;

comment on function public.media_revenus_visibles() is
  'Qui voit l''argent : admin, prod, compta, responsable de pôle. PAS le Secrétariat, qui fixe les '
  'prix (media_pricing_staff) sans voir les recettes. Ne jamais confondre les deux : c''est en les '
  'faisant passer par la même porte que le Secrétariat a gagné le CA par lien sans que ce soit '
  'demandé (07/09, corrigé le 29/09).';

revoke all on function public.media_revenus_visibles() from public, anon;
grant execute on function public.media_revenus_visibles() to authenticated, service_role;

create or replace function public.media_album_links_stats(p_album_id uuid)
returns table (id uuid, label text, slug text, token text, audience text, offer_name text,
               offer_type text, price_cents integer, is_enabled boolean,
               expires_at timestamp with time zone, view_count integer,
               unique_visitor_count integer, orders_count integer, revenue_cents integer)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.label, l.slug, l.token, l.audience,
         o.offer_name, o.offer_type, o.price_cents,
         l.is_enabled, l.expires_at, l.view_count, l.unique_visitor_count,
         -- L'ARGENT SEULEMENT POUR CEUX QUI Y ONT DROIT. Le reste de la ligne est le matériel de
         -- travail du Secrétariat : il le garde.
         case when media_revenus_visibles() then coalesce(v.n, 0)::integer end,
         case when media_revenus_visibles() then coalesce(v.ca, 0)::integer end
  from media_album_links l
  cross join lateral media_link_offer(l.id) o
  left join lateral (
    select count(*) as n, sum(amount_cents) as ca
    from media_orders mo where mo.link_id = l.id and mo.status = 'paid'
  ) v on true
  where l.album_id = p_album_id
    and media_pricing_staff()
  order by l.created_at;
$$;

comment on function public.media_album_links_stats(uuid) is
  'Les liens d''une galerie, pour l''écran qui les gère. Ouvert à media_pricing_staff (Secrétariat '
  'compris : il prépare les liens), mais `orders_count` et `revenue_cents` sont null pour qui n''a '
  'pas media_revenus_visibles(). Ne pas refuser la ligne entière au Secrétariat : son écran de '
  'gestion des liens se viderait.';

notify pgrst, 'reload schema';
