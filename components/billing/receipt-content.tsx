import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { formatBillingDate, PAYMENT_KIND_LABELS, PROVIDER_LABELS } from "@/lib/billing/format";
import { formatNaira, readPlanCatalog } from "@/lib/billing/plans";
import { logEvent } from "@/lib/observability/log";
import { getReceipt } from "@/lib/services/billing";
import { getTimezone } from "@/lib/services/calendar";
import { createUserClient } from "@/lib/supabase/server";
import { Logo } from "../marketing/logo";
import { PrintReceipt } from "./print-receipt";

const id = z.uuid();

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 sm:flex-row sm:justify-between sm:gap-6">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold sm:text-right">{children}</dd>
    </div>
  );
}

/** A printable receipt for one of the signed-in creator's paid payments. Anything else is a 404. */
export async function ReceiptContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { userId } = await auth.protect();
  const [{ id: rawId }, query] = await Promise.all([params, searchParams]);
  const paymentId = id.safeParse(rawId);
  if (!paymentId.success) notFound();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "billing_receipt_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <p role="alert">We couldn&apos;t load this receipt. Refresh the page to try again.</p>;
  }

  const [result, timezone] = await Promise.all([
    getReceipt(client, userId, paymentId.data),
    getTimezone(client, userId),
  ]);
  if (!result.ok) return <p role="alert">We couldn&apos;t load this receipt. Refresh the page to try again.</p>;
  if (!result.receipt) notFound();

  const receipt = result.receipt;
  const tz = timezone.ok ? timezone.timezone : null;
  const { plans } = readPlanCatalog();
  const date = (iso: string | null) => (iso ? formatBillingDate(iso, tz) : "—");

  return (
    <article className="card receipt-print stack-md max-w-2xl" aria-labelledby="receipt-heading">
      <div className="flex items-start justify-between gap-4">
        <div className="stack-sm">
          <Logo />
          <h2 id="receipt-heading" className="text-heading">
            Payment receipt
          </h2>
          <p className="text-sm text-muted-foreground">Receipt no. {receipt.number}</p>
        </div>
        <span className="status-dot status-paid text-sm">Paid</span>
      </div>

      <dl className="text-sm">
        <Row label="Date paid">{date(receipt.paidAt)}</Row>
        <Row label="Plan">
          CreateHive {plans[receipt.plan].name} · {PAYMENT_KIND_LABELS[receipt.kind]}
        </Row>
        <Row label="Period covered">
          {date(receipt.paidAt)} – {date(receipt.coversUntil)}
        </Row>
        <Row label="Paid with">{PROVIDER_LABELS[receipt.provider]}</Row>
        {receipt.providerReference ? <Row label={`${PROVIDER_LABELS[receipt.provider]} reference`}>{receipt.providerReference}</Row> : null}
        <Row label="Amount">
          <span className="text-base tabular-nums">{formatNaira(receipt.amountMinor / 100)}</span>
        </Row>
      </dl>

      <p className="field-help">
        This is a record of your payment, not a tax invoice. Prices are in Nigerian naira (NGN).
      </p>
      <div className="no-print flex flex-wrap items-center gap-3">
        <PrintReceipt auto={query.print === "1"} />
        <Link href="/app/settings/billing" className="btn btn-ghost btn-sm">
          Back to billing
        </Link>
      </div>
    </article>
  );
}
