import { requireStaff } from "@/lib/auth";

/** Admin > Reports: downloads built from the live data. Admin only: they name staff cash and buyers. */
export default async function ReportsPage() {
  await requireStaff("admin");
  return (
    <div className="space-y-6">
      <div className="card mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Walk-in sales by staff</h2>
          <p className="text-xs text-zinc-500">
            Excel, built from the live data each time you download it: walk-in totals per staff account, every entry in one list, and one sheet per account.
          </p>
        </div>
        <a href="/api/admin/export?type=staff" className="btn-secondary">Download Excel</a>
      </div>
      <div className="card mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Registrations and orders</h2>
          <p className="text-xs text-zinc-500">Excel with a summary and one sheet per ticket type: every number, holder, vehicle, payment and gate scan.</p>
        </div>
        <a href="/api/admin/export" className="btn-secondary">Download Excel</a>
      </div>
    </div>
  );
}
