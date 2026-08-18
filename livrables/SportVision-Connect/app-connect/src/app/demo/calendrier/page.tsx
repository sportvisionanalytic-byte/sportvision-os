import { CalendarView } from "@/app/(joueur)/calendrier/CalendarView";
import { DEMO_CALENDAR_EVENTS } from "@/lib/demo/mock-data";

export default function DemoCalendrierPage() {
  return <CalendarView events={DEMO_CALENDAR_EVENTS} hasClub />;
}
