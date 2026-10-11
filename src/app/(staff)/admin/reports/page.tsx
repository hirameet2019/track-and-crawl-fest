import { requireStaff } from "@/lib/auth";
import { EventDayReport } from "@/components/EventDayReport";

/** Admin > Reports: the event-day report. Admin only: it names staff cash and buyers. */
export default async function ReportsPage() {
  await requireStaff("admin");
  return <EventDayReport />;
}
