import { auth } from "@clerk/nextjs/server";
import { toCsv } from "@/lib/billing/csv";
import { PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS, PROVIDER_LABELS } from "@/lib/billing/format";
import { logEvent } from "@/lib/observability/log";
import { listPaymentsForExport } from "@/lib/services/billing";
import { createUserClient } from "@/lib/supabase/server";

/** The signed-in creator's payment history as CSV. RLS limits it to their own rows. */
export async function GET() {
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "billing_export_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return new Response("We couldn't export your payments right now. Try again in a minute.", { status: 500 });
  }

  const result = await listPaymentsForExport(client, userId, Date.now());
  if (!result.ok) return new Response("We couldn't export your payments right now. Try again in a minute.", { status: 500 });

  const csv = toCsv(
    ["date", "plan", "type", "provider", "amount_ngn", "status", "covers_until"],
    result.payments.map((p) => [
      (p.paidAt ?? p.createdAt).slice(0, 10),
      p.plan,
      PAYMENT_KIND_LABELS[p.kind],
      PROVIDER_LABELS[p.provider],
      (p.amountMinor / 100).toFixed(2),
      PAYMENT_STATUS_LABELS[p.status],
      p.coversUntil?.slice(0, 10) ?? "",
    ]),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="createhive-payments.csv"',
      "Cache-Control": "no-store",
    },
  });
}
