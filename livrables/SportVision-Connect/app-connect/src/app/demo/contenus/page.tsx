import { ContentGallery } from "@/app/(joueur)/contenus/ContentGallery";
import { DEMO_CONTENT_ITEMS } from "@/lib/demo/mock-data";

export default function DemoContenusPage() {
  return <ContentGallery items={DEMO_CONTENT_ITEMS} favoriteIds={[]} hasClub />;
}
