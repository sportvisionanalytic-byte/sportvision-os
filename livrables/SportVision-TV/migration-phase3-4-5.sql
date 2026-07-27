-- Migration : Signatures, Auto-tâches, Templates email — SportVision OS Phase 3-4-5
-- À exécuter dans Supabase → SQL Editor

-- PHASE 3 : Suivi des signatures sur devis
alter table devis
  add column if not exists signature_statut text
    check (signature_statut in ('non_demandee','demandee','signee','refusee'))
    default 'non_demandee',
  add column if not exists signature_demandee_at timestamptz,
  add column if not exists signature_confirmee_at timestamptz;

-- Suivi des signatures sur contrats
alter table contrats
  add column if not exists signature_statut text
    check (signature_statut in ('non_demandee','demandee','signee','refusee'))
    default 'non_demandee',
  add column if not exists signature_demandee_at timestamptz,
  add column if not exists signature_confirmee_at timestamptz;

-- PHASE 4 : Colonnes source sur notifications (pour les auto-tâches)
alter table notifications
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists priorite text
    check (priorite in ('faible','normale','haute','urgente'))
    default 'normale';

-- PHASE 5 : Templates email
create table if not exists email_templates (
  id uuid default gen_random_uuid() primary key,
  code text not null unique,
  nom text not null,
  sujet text not null,
  corps text not null,
  variables text[] default '{}',
  actif boolean default true,
  modifie_par uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table email_templates enable row level security;

create policy "email_tpl_read" on email_templates for select using (
  exists (select 1 from profiles where id = auth.uid())
);

create policy "email_tpl_manage" on email_templates for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec'))
);

-- Templates par défaut
insert into email_templates (code, nom, sujet, corps, variables) values
('devis_envoye', 'Devis envoyé', 'Votre devis SportVision — {{numero}}',
'Bonjour {{prenom_contact}},

Veuillez trouver ci-joint votre devis {{numero}} d''un montant de {{montant_ttc}} TTC.

Ce devis est valable {{validite_jours}} jours. Pour l''accepter, répondez à cet email avec la mention "Bon pour accord" ou contactez-nous directement.

Cordialement,
L''équipe SportVision',
ARRAY['prenom_contact', 'numero', 'montant_ttc', 'validite_jours']),

('relance_acompte', 'Relance acompte', 'Rappel : acompte en attente — {{reference}}',
'Bonjour {{prenom_contact}},

Nous vous rappelons qu''un acompte est en attente pour la prestation {{reference}} prévue le {{date_prestation}}.

Montant de l''acompte : {{montant_acompte}} TTC.

Merci de procéder au règlement afin de confirmer votre prestation.

Cordialement,
L''équipe SportVision',
ARRAY['prenom_contact', 'reference', 'date_prestation', 'montant_acompte']),

('livraison_prete', 'Livraison prête', 'Vos médias sont disponibles — {{reference}}',
'Bonjour {{prenom_contact}},

Vos photos et vidéos de la prestation {{reference}} du {{date_prestation}} sont disponibles en téléchargement.

Lien de téléchargement : {{lien_livraison}}

Ce lien sera disponible pendant 30 jours.

Merci de votre confiance,
L''équipe SportVision',
ARRAY['prenom_contact', 'reference', 'date_prestation', 'lien_livraison']),

('contrat_signer', 'Contrat à signer', 'Votre contrat SportVision — signature requise',
'Bonjour {{prenom_contact}},

Votre contrat {{type_contrat}} d''un montant de {{montant_mensuel}} TTC/mois est prêt à être signé.

Merci de nous retourner le document signé (scan ou photo) pour finaliser notre partenariat.

Cordialement,
L''équipe SportVision',
ARRAY['prenom_contact', 'type_contrat', 'montant_mensuel']),

('relance_facture', 'Relance facture', 'Rappel de paiement — {{reference}}',
'Bonjour {{prenom_contact}},

Sauf erreur de notre part, la facture correspondant à la prestation {{reference}} du {{date_prestation}} d''un montant de {{montant_ttc}} TTC est toujours en attente de règlement.

Merci de procéder au paiement dans les meilleurs délais.

Cordialement,
L''équipe SportVision',
ARRAY['prenom_contact', 'reference', 'date_prestation', 'montant_ttc'])

on conflict (code) do nothing;

-- Trigger updated_at
create or replace function update_email_tpl_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_email_tpl_upd on email_templates;
create trigger trg_email_tpl_upd before update on email_templates
  for each row execute procedure update_email_tpl_updated_at();

create index if not exists idx_email_tpl_code on email_templates(code, actif);
create index if not exists idx_devis_sig on devis(signature_statut);
create index if not exists idx_contrats_sig on contrats(signature_statut);
