-- migration-poles-v5-creation-basket.sql
--
-- Migration multi-pôles, Lot 5 — création effective du pôle Basket.
--
-- Statut 'lancement' (pas 'actif') : conforme à la roadmap du cahier des
-- charges (Mois 1 = immersion, aucun contrat encore). Aucun responsable
-- affecté (pole_affectations) — Fouka nommera le Responsable Basket
-- lui-même une fois la fonctionnalité en place (son choix explicite,
-- verbatim : "j'irais nommer le responsable après que tu ai tout
-- développé"). Idempotente (on conflict do nothing).

insert into poles (nom, slug, sport, statut)
values ('Basket', 'basket', 'Basketball', 'lancement')
on conflict (slug) do nothing;
