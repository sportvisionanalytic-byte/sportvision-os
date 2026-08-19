-- migration-clubplus-v45-facture-pdf-pennylane-fallback.sql
-- EXÉCUTÉE le 19/08/2026 (audit Club+ du 19/08 : "Export PDF de facture" — vérifié par
-- exploration du vrai code avant correction, voir ci-dessous).
--
-- Constat : le lien "Voir le PDF" de billing/page.tsx (Club+ et Espace Projet) lit
-- factures.pdf_url via la vue client_factures. Un vrai PDF EST déjà généré automatiquement au
-- moment de l'envoi Pennylane (send-facture-pennylane/index.ts, staff uniquement), mais stocké
-- dans une colonne différente : factures.pennylane_public_url. pdf_url n'est écrite nulle part
-- dans le code (confirmé par recherche exhaustive) — le bouton "Voir le PDF" restait donc
-- fonctionnellement mort pour toute facture envoyée via Pennylane.
--
-- Correctif minimal, sans changement d'application : la vue préfère pdf_url si renseignée
-- (chemin manuel éventuel), sinon retombe sur pennylane_public_url (chemin réel automatique).
--
-- Risque au moment du correctif : nul — 0 ligne dans `factures` au total (vérifié avant
-- exécution), donc aucune donnée réelle affectée.

create or replace view client_factures as
select
  id, numero, type_facture, statut, client_id, prestation_id, devis_id, lignes,
  montant_ht, tva_pct, montant_ttc, montant_paye, date_emission, date_echeance,
  coalesce(pdf_url, pennylane_public_url) as pdf_url,
  created_at
from factures f
where (exists (select 1 from client_users cu where cu.id = auth.uid() and cu.client_id = f.client_id))
   or club_member_has_financial_view_access(client_id);
