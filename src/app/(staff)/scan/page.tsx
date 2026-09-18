import { requireStaff } from "@/lib/auth";
import { Scanner } from "@/components/Scanner";

export default async function ScanPage() {
  const session = await requireStaff("scanner");
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-xl font-bold">Gate scanner</h1>
      <p className="text-sm text-zinc-500">Signed in as {session.staff.full_name}. Point the camera at the buyer&apos;s QR code.</p>
      <div className="mt-4">
        <Scanner />
      </div>
    </div>
  );
}
