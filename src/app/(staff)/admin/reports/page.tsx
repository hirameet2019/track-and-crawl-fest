import { requireStaff } from "@/lib/auth";
import { EventDayReport } from "@/components/EventDayReport";

/** Admin > Reports: the event-day report. Admin only: it names staff cash and buyers. */
export default async function ReportsPage() {
  await requireStaff("admin");
  return (
    <div className="space-y-6">
      <div className="card mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Walk-in sales by staff</h2>
          <p className="text-xs text-zinc-500">
            Excel, built from the live data each time you download it: Adult and Kids Walk-in totals per staff account, every entry in one list, and one sheet per account.
          </p>
        </div>
        <a href="/api/admin/export?type=staff" className="btn-secondary">Download Excel</a>
      </div>
      <EventDayReport />
    </div>
  );
}
