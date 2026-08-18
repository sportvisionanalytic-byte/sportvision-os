import { FundingTabs } from "@/app/(joueur)/cotisations/FundingTabs";
import { DEMO_FUNDING } from "@/lib/demo/mock-data";

export default function DemoCotisationsPage() {
  return <FundingTabs fundings={DEMO_FUNDING} basePath="/demo/cotisations" />;
}
