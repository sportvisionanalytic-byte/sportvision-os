"use client";

import { useEffect, useRef } from "react";

// Finding accessibilité P2 (audit transversal, 04/09/2026, décision Fouka) : AddEventModal,
// CreateTeamModal, CreateSponsorModal, InviteUserModal n'avaient ni Escape ni piège de focus
// clavier, contrairement à l'OS (SportVision-OS-Full.html) qui a les deux depuis l'audit QA du
// 29/08. Hook partagé plutôt que dupliquer la logique dans chaque modale : Escape ferme, Tab/
// Shift+Tab restent piégés dans la modale, le focus revient à l'élément qui l'avait avant
// l'ouverture (perdu sinon pour un utilisateur clavier/lecteur d'écran).
export function useModalA11y(containerRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusable = containerRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // Relit containerRef.current à chaque frappe (pas capturé une seule fois) : une modale à
      // rendu conditionnel (ex. InviteUserModal, formulaire → écran identifiants) peut faire
      // pointer la ref vers un nouveau nœud DOM sans jamais redéclencher cet effet (deps = []).
      const nodes = containerRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
