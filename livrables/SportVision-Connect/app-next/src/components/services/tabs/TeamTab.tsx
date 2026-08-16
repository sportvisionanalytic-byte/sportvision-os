import { Mail, Phone } from "lucide-react";
import type { Service } from "@/lib/types/services";
import { EmptyState } from "@/components/ui/EmptyState";

export function TeamTab({ service }: { service: Service }) {
  const sportvision = service.team.filter((m) => m.side === "sportvision");
  const client = service.team.filter((m) => m.side === "client");

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <TeamGroup title="Équipe SportVision" members={sportvision} />
      <TeamGroup title="Interlocuteurs côté club" members={client} />
    </div>
  );
}

function TeamGroup({ title, members }: { title: string; members: Service["team"] }) {
  return (
    <div>
      <div className="text-[13px] font-extrabold tracking-tight">{title}</div>
      <div className="mt-3 flex flex-col gap-2.5">
        {members.length === 0 ? (
          <EmptyState variant="compact" title="Aucun intervenant renseigné" className="py-4" />
        ) : (
          members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-alt p-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[11px] font-extrabold text-white">
                {member.name
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-text">{member.name}</span>
                <span className="block truncate text-[11.5px] text-text-faint">{member.role}</span>
              </span>
              <span className="flex flex-none items-center gap-1.5">
                {member.phone && (
                  <a
                    href={`tel:${member.phone}`}
                    aria-label={`Appeler ${member.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-text-soft hover:bg-surface-sunken"
                  >
                    <Phone className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
                {member.email && (
                  <a
                    href={`mailto:${member.email}`}
                    aria-label={`Écrire à ${member.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-text-soft hover:bg-surface-sunken"
                  >
                    <Mail className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
