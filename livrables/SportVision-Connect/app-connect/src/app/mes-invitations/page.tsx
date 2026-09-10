"use client";

// /mes-invitations — ce que le club vous a envoyé, et le bouton pour l'accepter.
//
// ── Pourquoi cet écran n'existait pas, et ce que ça coûtait ──
// Un club pouvait inviter un joueur ou un parent depuis Club+ depuis des mois. La ligne partait
// bien en base (`player_invitations`, `parent_invitations`), un compte était même créé — et
// AUCUN écran de Connect ne lisait ces deux tables. `accept_parent_invitation` existait sans
// qu'une seule application servie ne l'appelle. La personne recevait un e-mail, posait un mot de
// passe, arrivait ici, et rien ne lui disait pourquoi.
//
// ── L'adresse tient lieu de jeton ──
// Aucun code dans l'URL. `lister_mes_invitations()` ne rend que les invitations adressées à
// l'adresse du compte connecté. Une invitation ne se transfère donc pas, et il n'y a pas de lien
// secret à protéger — c'est une chaîne de moins où se tromper.
//
// La page n'est pas publique : le middleware renvoie vers la connexion en conservant la
// destination dans `next`. Créer son compte fait partie du parcours, ce n'est pas un détour.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

interface Invitation {
  id: string;
  genre: "joueur" | "parent";
  club_id: string;
  club_nom: string;
  equipe_nom: string | null;
  enfant_prenom: string | null;
  enfant_nom: string | null;
  prenom: string | null;
  nom: string | null;
}

export default function MesInvitationsPage() {
  const router = useRouter();
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  // L'invitation acceptee entiere, pas seulement le nom du club : le message qui suit n'est pas le
  // meme pour un joueur, dont l'adhesion attend la validation du club, et pour un parent, rattache
  // tout de suite puisque c'est le club qui a designe l'enfant (accept_parent_invitation pose
  // directement le statut « confirme »).
  const [acceptee, setAcceptee] = useState<Invitation | null>(null);

  const charger = useCallback(() => {
    void (async () => {
      const { data, error } = await createClient().rpc("lister_mes_invitations");
      setInvitations(error ? [] : ((data ?? []) as Invitation[]));
    })();
  }, []);

  useEffect(charger, [charger]);

  function accepter(inv: Invitation) {
    setEnCours(inv.id);
    setErreur(null);
    const supabase = createClient();
    void (async () => {
      const { error } =
        inv.genre === "joueur"
          ? await supabase.rpc("accepter_invitation_joueur", { p_invitation_id: inv.id })
          : await supabase.rpc("accept_parent_invitation", { p_invitation_id: inv.id });

      if (error) {
        // Le message de la base est écrit pour être lu (« Cette invitation a été envoyée à une
        // autre adresse e-mail. ») : le remplacer par « réessayez » a déjà coûté des jours
        // ailleurs dans ce produit.
        const message = error.message;
        setErreur(message && !/JSON|fetch/i.test(message) ? message : "Impossible d'accepter cette invitation.");
      } else {
        setAcceptee(inv);
        charger();
      }
      setEnCours(null);
    })();
  }

  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col gap-5 px-4 py-10">
      <div>
        <div className="text-[12px] font-bold uppercase tracking-[.08em] text-text-soft">
          SportVision Connect
        </div>
        <h1 className="mt-1.5 text-[24px] font-extrabold tracking-tight">Mes invitations</h1>
      </div>

      {invitations === null && <p className="text-[13.5px] text-text-soft">Chargement…</p>}

      {invitations?.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface p-6 text-center">
          <p className="text-[14px] font-bold">
            {!acceptee
              ? "Aucune invitation en attente"
              : acceptee.genre === "parent"
                ? `Vous êtes rattaché à ${acceptee.enfant_prenom ?? "votre enfant"}.`
                : `Vous avez rejoint ${acceptee.club_nom}.`}
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-soft">
            {/* Jusqu'au 10/09/2026, le parent lisait lui aussi « Le club doit encore valider votre
                adhesion », alors que son rattachement etait deja confirme : il attendait une
                validation qui ne viendrait jamais, puisqu'elle avait deja eu lieu. */}
            {!acceptee
              ? "Si votre club vous a invité, vérifiez que vous êtes connecté avec l'adresse à laquelle il a écrit."
              : acceptee.genre === "parent"
                ? `${acceptee.club_nom} a confirmé ce lien. Vous pouvez suivre ses contenus depuis votre espace.`
                : "Le club doit encore valider votre adhésion. Vous serez prévenu."}
          </p>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => router.push("/")}>
              Aller à mon espace
            </Button>
          </div>
        </div>
      )}

      {invitations?.map((inv) => (
        <div key={inv.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
          <div>
            <div className="text-[15px] font-extrabold tracking-tight">{inv.club_nom}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-text-soft">
              {inv.genre === "joueur" ? (
                <>
                  Vous êtes invité à rejoindre{" "}
                  {inv.equipe_nom ? <span className="font-bold text-text">{inv.equipe_nom}</span> : "ce club"}.
                </>
              ) : (
                <>
                  Vous êtes invité en tant que parent
                  {inv.enfant_prenom ? (
                    <>
                      {" "}
                      de <span className="font-bold text-text">{inv.enfant_prenom} {inv.enfant_nom}</span>
                    </>
                  ) : null}
                  .
                </>
              )}
            </p>
          </div>
          <Button onClick={() => accepter(inv)} loading={enCours === inv.id} disabled={enCours !== null}>
            {inv.genre === "joueur" ? "Rejoindre mon équipe" : "Créer mon espace parent"}
          </Button>
        </div>
      ))}

      {erreur && <p className="text-[12.5px] font-bold text-danger">{erreur}</p>}
    </main>
  );
}
