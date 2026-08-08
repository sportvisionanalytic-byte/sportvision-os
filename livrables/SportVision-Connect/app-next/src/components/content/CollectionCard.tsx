import Link from "next/link";
import { Images } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { Collection } from "@/lib/types/content";
import { COLLECTION_KIND_LABELS } from "@/lib/types/content";

export function CollectionCard({ collection }: { collection: Collection }) {
  return (
    <Link href={`/content/collections/${collection.id}`}>
      <Card className="flex flex-col overflow-hidden hover:-translate-y-0.5 hover:border-brand-blue-pale hover:shadow-sv-card-hover">
        <div
          className="flex aspect-[16/9] w-full items-center justify-center"
          style={{
            backgroundImage:
              "repeating-linear-gradient(125deg, rgba(0,200,255,.5) 0px, rgba(0,200,255,.5) 16px, rgba(131,45,255,.5) 16px, rgba(131,45,255,.5) 32px)",
          }}
        >
          <Images className="h-6 w-6 text-white/85" aria-hidden />
        </div>
        <div className="flex flex-col gap-1 p-3.5">
          <span className="truncate text-[13.5px] font-bold text-text">{collection.name}</span>
          <span className="text-[11.5px] text-text-faint">
            {COLLECTION_KIND_LABELS[collection.kind]} · {collection.itemCount} élément{collection.itemCount > 1 ? "s" : ""}
          </span>
        </div>
      </Card>
    </Link>
  );
}
