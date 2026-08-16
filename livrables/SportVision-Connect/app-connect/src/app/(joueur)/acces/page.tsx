import { createClient } from "@/lib/supabase/server";
import { requireJoueurAccount } from "@/lib/supabase/session";
import { RequestCard } from "./RequestCard";
import { GrantCard, type GrantRights } from "./GrantCard";

function formatSince(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Accès à mon profil — voir design-connect-personnel-12-08/README.md § Accès à mon profil.
// Vrai système de permissions serveur (table connect_access_relationships + RPC SECURITY
// DEFINER, migration-connect-personnel-accueil-profil-acces.sql §2) : ni les demandes ni les
// droits accordés ne sont de la donnée simulée — tout est lu/écrit en base, et la vérification
// "c'est bien le propriétaire du profil qui agit" est faite CÔTÉ SERVEUR dans chaque RPC, jamais
// seulement parce que cette page s'affiche (MASTER-CONNECT-V1.md §36).
export default async function AccesPage() {
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const { data: requests } = await supabase
    .from("connect_access_relationships")
    .select("id, grantee_display_name, grantee_email, relation_type, message, requested_at")
    .eq("owner_user_id", user.id)
    .eq("status", "en_attente")
    .order("requested_at", { ascending: false });

  const { data: granted } = await supabase
    .from("connect_access_relationships")
    .select(
      "id, grantee_user_id, grantee_display_name, relation_type, responded_at, right_voir, right_download, right_reserver, right_commandes, right_factures, right_payer, right_cotisation, right_calendrier, right_modifier",
    )
    .eq("owner_user_id", user.id)
    .eq("status", "acceptee")
    .order("responded_at", { ascending: false });

  const requestList = requests || [];
  const grantedList = granted || [];

  // Nom d'agence (connect_profile_settings.nom_agence, migration-connect-v70) pour les relations
  // 'agent' uniquement. La policy RLS de connect_profile_settings ("cps_self_all") ne laisse lire
  // que sa propre ligne — un select direct ici (session du sportif) ne pourrait donc jamais lire
  // la ligne de l'agent. connect_get_agent_agency_names() (RPC SECURITY DEFINER, migration-
  // connect-v70) contourne ça proprement : elle ne renvoie QUE (user_id, nom_agence), jamais le
  // reste de la ligne de l'agent (téléphone, ville, etc.), et uniquement pour les agents avec
  // lesquels L'APPELANT (auth.uid(), vérifié en interne) a une relation 'agent' acceptée — jamais
  // un paramètre à fournir pour ce filtre, impossible de la détourner pour lire l'agence d'un
  // agent avec qui on n'a aucune relation.
  const agentGranteeIds = grantedList
    .filter((g) => g.relation_type === "agent")
    .map((g) => g.grantee_user_id);
  const agencyNameByUserId: Record<string, string | null> = {};
  if (agentGranteeIds.length > 0) {
    const { data: agencies } = await supabase.rpc("connect_get_agent_agency_names", {
      p_agent_user_ids: agentGranteeIds,
    });
    for (const a of (agencies || []) as Array<{ user_id: string; nom_agence: string | null }>) {
      agencyNameByUserId[a.user_id] = a.nom_agence;
    }
  }

  return (
    <div className="flex max-w-[760px] flex-col gap-7 animate-sv-in">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Accès à mon profil</h1>
          <p className="max-w-[620px] text-[15px] text-text-tertiary">
            Les personnes qui vous accompagnent et ce que vous les autorisez à voir. Vous pouvez
            retirer un accès à tout moment.
          </p>
        </div>

        {requestList.length > 0 && (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-2.5">
              <h2 className="font-sora text-[17px] font-semibold">Demandes en attente</h2>
              <span className="rounded-sv-pill bg-attente-bg px-2.5 py-1 text-[12px] font-medium text-attente">{requestList.length}</span>
            </div>
            <div className="flex flex-col gap-3.5">
              {requestList.map((r) => (
                <RequestCard
                  key={r.id}
                  id={r.id}
                  name={r.grantee_display_name || r.grantee_email || "Utilisateur SportVision"}
                  email={r.grantee_email || ""}
                  relationType={r.relation_type}
                  message={r.message}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5">
            <h2 className="font-sora text-[17px] font-semibold">Accès accordés</h2>
            <span className="rounded-sv-pill bg-white/[.07] px-2.5 py-1 text-[12px] font-medium text-text-tertiary">{grantedList.length}</span>
          </div>

          {grantedList.length > 0 ? (
            <div className="flex flex-col gap-3">
              {grantedList.map((g) => {
                const rights: GrantRights = {
                  voir: g.right_voir,
                  download: g.right_download,
                  reserver: g.right_reserver,
                  commandes: g.right_commandes,
                  factures: g.right_factures,
                  payer: g.right_payer,
                  cotisation: g.right_cotisation,
                  calendrier: g.right_calendrier,
                  modifier: g.right_modifier,
                };
                return (
                  <GrantCard
                    key={g.id}
                    id={g.id}
                    name={g.grantee_display_name || "Utilisateur SportVision"}
                    relationType={g.relation_type}
                    since={g.responded_at ? formatSince(g.responded_at) : "récemment"}
                    initialRights={rights}
                    agencyName={g.relation_type === "agent" ? agencyNameByUserId[g.grantee_user_id] ?? null : null}
                  />
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 rounded-sv-card border border-dashed border-border-strong bg-white/[.02] p-6">
              <span className="flex h-[46px] w-[46px] items-center justify-center rounded-sv bg-affiliations-bg">
                <span className="material-symbols-rounded !text-[23px] text-affiliations">lock_person</span>
              </span>
              <span className="font-sora text-[18px] font-semibold">Personne n&apos;a accès à votre profil</span>
              <p className="text-[14px] leading-relaxed text-text-tertiary">
                Un parent, un proche ou un agent peut vous envoyer une demande depuis son espace
                Connect. Vous restez seul à décider.
              </p>
            </div>
          )}
        </div>
      </div>
    );
}
