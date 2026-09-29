-- v358 — LE RÉCAPITULATIF MENSUEL DE PRESTATIONS (29/09/2026)
--
-- CE QUE FOUKA A DEMANDÉ. « À chaque fin du mois je peux couper, dire fin de salaire, ça va du
-- premier au dernier jour du mois. Et après ça lui envoie une fiche récapitulative, toutes les
-- prestations qu'il a faites, les pénalités, les primes. C'est moi en tant qu'admin qui décide
-- combien je paie. Et en même temps, il reçoit sa paye d'ici 3 à 5 jours. »
--
-- CE QUE CE N'EST PAS, ET C'EST UNE DÉCISION PRISE PAR FOUKA LE 29/09 APRÈS QUE JE L'AIE ALERTÉ :
-- ce n'est PAS une fiche de paie, et le document ne dira jamais « salaire ». Les 18 collaborateurs
-- sont tous en `type_contrat = 'freelance'`, vérifié en base. Un bulletin de paie est le document
-- d'un employeur à un salarié : en envoyer un à un indépendant, c'est fabriquer soi-même la preuve
-- écrite d'un lien de subordination, exactement la pièce qu'un contrôle URSSAF demande en premier.
-- D'où « récapitulatif de prestations », qui décrit ce qui s'est réellement passé : des missions
-- réalisées, un montant dû.
--
-- LE MODÈLE, ET POURQUOI IL EST FAIT D'INSTANTANÉS. Un document parti chez une vraie personne ne
-- doit plus jamais changer. Si le récapitulatif se recalculait à chaque affichage, une correction
-- de grille faite en octobre changerait après coup ce qu'on a écrit en septembre, et personne ne
-- saurait plus ce que le collaborateur a reçu. On copie donc, au moment de l'envoi, chaque ligne
-- avec son montant : le récapitulatif devient une pièce, pas une vue.
--
-- LA PÉRIODE SE COMPTE À PARIS. `date_trunc('month', now())` en UTC ferait basculer le mois entre
-- minuit et 2 h du matin heure française : une mission du 1er octobre à 0 h 30 tomberait dans
-- septembre. C'est la leçon du 14/09, et elle se rejoue partout où il y a une date.

create table if not exists public.recapitulatifs_remuneration (
  id uuid primary key default gen_random_uuid(),
  collaborateur_id uuid not null references public.profiles(id) on delete restrict,
  -- Le premier jour du mois couvert. Une date plutôt qu'un couple (année, mois) : les comparaisons,
  -- les tris et les intervalles s'écrivent sans arithmétique.
  mois date not null,
  -- CE QUE LE DOCUMENT ANNONCE, figé. `montant_du` est la somme des lignes telle qu'elle était au
  -- moment de l'envoi ; `montant_verse` est ce que Fouka a décidé de payer. Les deux existent
  -- séparément parce qu'ils peuvent différer, et que cacher l'écart serait malhonnête des deux
  -- côtés : envers le collaborateur qui doit pouvoir le voir, et envers nous qui devons l'expliquer.
  montant_prestations numeric(10,2) not null default 0,
  montant_primes numeric(10,2) not null default 0,
  montant_ajustements numeric(10,2) not null default 0,
  montant_frais numeric(10,2) not null default 0,
  montant_du numeric(10,2) not null default 0,
  montant_verse numeric(10,2) not null,
  -- Le mot de Fouka au collaborateur, quand l'écart demande une phrase.
  note text,
  nb_prestations integer not null default 0,
  -- « Vous recevrez le virement d'ici 3 à 5 jours » : on écrit la date annoncée plutôt que le
  -- délai, parce qu'un délai se relit mal une semaine plus tard.
  virement_annonce_le date,
  envoye_le timestamptz,
  envoye_par uuid references public.profiles(id),
  destinataire_email text,
  statut text not null default 'brouillon'
    check (statut in ('brouillon', 'envoye', 'annule')),
  annule_le timestamptz,
  annule_par uuid references public.profiles(id),
  annulation_motif text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- UN SEUL RÉCAPITULATIF VIVANT PAR PERSONNE ET PAR MOIS. Deux récapitulatifs envoyés pour le même
-- mois, c'est un double paiement annoncé. L'index laisse passer les annulés : on garde la trace de
-- ce qu'on a envoyé par erreur plutôt que de l'effacer.
create unique index if not exists recapitulatifs_un_par_mois
  on public.recapitulatifs_remuneration (collaborateur_id, mois)
  where statut <> 'annule';

create index if not exists recapitulatifs_par_mois
  on public.recapitulatifs_remuneration (mois desc, statut);

comment on table public.recapitulatifs_remuneration is
  'Récapitulatif mensuel de prestations d''un collaborateur FREELANCE. Ce n''est pas une fiche de '
  'paie et le document ne doit jamais employer le mot « salaire » : les collaborateurs sont '
  'indépendants, et un bulletin de paie serait la preuve écrite d''un lien de subordination '
  '(décision de Fouka du 29/09/2026, après alerte). Les montants sont des INSTANTANÉS pris à '
  'l''envoi : un document parti chez quelqu''un ne change plus.';

-- ── Les lignes du récapitulatif, copiées au moment de l'envoi ───────────────────────────────────
create table if not exists public.recapitulatifs_remuneration_lignes (
  id uuid primary key default gen_random_uuid(),
  recapitulatif_id uuid not null references public.recapitulatifs_remuneration(id) on delete cascade,
  -- On garde le lien vers la ligne d'origine pour pouvoir remonter, mais SANS en dépendre pour
  -- afficher : le libellé et le montant sont copiés ici. Une mission supprimée plus tard ne doit
  -- pas trouer un document déjà envoyé.
  affectation_id uuid references public.prestations_equipe(id) on delete set null,
  date_prestation date,
  libelle text not null,
  fonction text,
  montant numeric(10,2) not null default 0,
  -- 'prestation' | 'prime' | 'ajustement' | 'frais'. Un ajustement porte un montant NÉGATIF : on ne
  -- range pas les retenues dans une colonne à part, sinon le total ne se lit plus d'un coup d'oeil.
  nature text not null check (nature in ('prestation', 'prime', 'ajustement', 'frais')),
  motif text,
  created_at timestamptz not null default now()
);

create index if not exists recapitulatifs_lignes_par_recap
  on public.recapitulatifs_remuneration_lignes (recapitulatif_id, nature, date_prestation);

comment on table public.recapitulatifs_remuneration_lignes is
  'Le détail d''un récapitulatif, COPIÉ à l''envoi. Le libellé et le montant vivent ici et non dans '
  'une jointure : une mission supprimée ou corrigée plus tard ne doit pas modifier un document déjà '
  'parti. Un ajustement porte un montant négatif.';

alter table public.recapitulatifs_remuneration enable row level security;
alter table public.recapitulatifs_remuneration_lignes enable row level security;

-- QUI VOIT QUOI. L'Admin et la comptabilité, parce qu'ils paient. Et LE COLLABORATEUR, son propre
-- récapitulatif, une fois envoyé : c'est son document, il doit pouvoir le relire sans redemander.
-- Pas un brouillon, en revanche — un montant en cours d'arbitrage n'est pas une annonce.
create policy recap_lecture_admin on public.recapitulatifs_remuneration
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role in ('admin','compta'))
  );

create policy recap_lecture_interesse on public.recapitulatifs_remuneration
  for select using (collaborateur_id = auth.uid() and statut = 'envoye');

create policy recap_ecriture_admin on public.recapitulatifs_remuneration
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'admin')
  ) with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'admin')
  );

create policy recap_lignes_lecture on public.recapitulatifs_remuneration_lignes
  for select using (
    exists (select 1 from recapitulatifs_remuneration r
             where r.id = recapitulatif_id
               and (exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role in ('admin','compta'))
                    or (r.collaborateur_id = auth.uid() and r.statut = 'envoye')))
  );

create policy recap_lignes_ecriture_admin on public.recapitulatifs_remuneration_lignes
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'admin')
  ) with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'admin')
  );

notify pgrst, 'reload schema';
