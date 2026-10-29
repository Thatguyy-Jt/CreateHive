import { auth } from "@clerk/nextjs/server";
import { connection } from "next/server";
import { endsSoon, type Entitlement } from "@/lib/billing/entitlement";
import { GATED_FEATURES, planIncludes } from "@/lib/billing/features";
import {
  formatBillingDate,
  PAYMENT_KIND_LABELS,
  PAYMENT_STATUS_LABELS,
  PROVIDER_LABELS,
} from "@/lib/billing/format";
import { checkoutOptions } from "@/lib/billing/plan-options";
import { formatNaira, readBillingConfig, readPlanCatalog, type PlanCatalog } from "@/lib/billing/plans";
import { logEvent } from "@/lib/observability/log";
import type { SubscriptionStatus } from "@/lib/schemas/enums";
import { getPlanUsage, type MonthlyUsageResult } from "@/lib/services/ai-usage";
import { getBillingOverview, type CardOnFile, type PaymentView } from "@/lib/services/billing";
import { getTimezone } from "@/lib/services/calendar";
import { createUserClient } from "@/lib/supabase/server";
import { BillingHistory, type HistoryRow } from "./billing-history";
import { CheckoutButtons } from "./checkout-buttons";
import { PlanCard } from "./plan-card";
import { PlanFocus } from "./plan-focus";
import { SubscriptionControls } from "./subscription-controls";
import { UpgradeButton } from "./upgrade-button";
import { UsageMeter } from "./usage-meter";

const PRO_CARD_ID = "plan-pro";

function LoadError() {
  return (
    <div role="alert" className="card stack-sm">
      <h2 className="text-heading">Something went wrong</h2>
      <p className="text-muted-foreground">We couldn&apos;t load your billing details. Refresh the page to try again.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan cards
// ---------------------------------------------------------------------------

function CurrentPlanButton() {
  return (
    <button type="button" className="btn btn-sm w-full cursor-default bg-surface-muted text-muted-foreground" disabled>
      Current plan
    </button>
  );
}

function PlanRow({
  entitlement,
  plans,
  available,
  subscriptionCard,
}: {
  entitlement: Entitlement;
  plans: PlanCatalog;
  available: boolean;
  subscriptionCard: React.ReactNode;
}) {
  const onFree = !entitlement.paid;
  const proCta = onFree ? (
    <CheckoutButtons plan="pro" options={checkoutOptions(entitlement, "pro", available)} />
  ) : (
    <CurrentPlanButton />
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <PlanCard
        plan={plans.free}
        cta={
          onFree ? (
            <CurrentPlanButton />
          ) : (
            <p className="field-help">You&apos;ll be back on Free when your Pro plan ends.</p>
          )
        }
      />
      <PlanCard id={PRO_CARD_ID} plan={plans.pro} cta={proCta} />
      {subscriptionCard}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Your subscription
// ---------------------------------------------------------------------------

function statusPill(entitlement: Entitlement, status: SubscriptionStatus | null): { label: string; className: string } {
  if (!entitlement.paid) return { label: "Free", className: "status-expired" };
  if (status === "past_due") return { label: "Payment failed", className: "status-failed" };
  if (!entitlement.renews) return { label: "Cancelled", className: "status-pending" };
  return { label: "Active", className: "status-paid" };
}

function statusLine(entitlement: Entitlement, status: SubscriptionStatus | null, date: (iso: string) => string): string {
  if (!entitlement.paid) return "Free forever. Upgrade any time for more of every AI feature.";
  const end = entitlement.endsAt ? date(entitlement.endsAt) : null;
  if (status === "past_due") {
    return end
      ? `Your last payment failed. Update your card by ${end} to keep Pro.`
      : "Your last payment failed. Update your card to keep Pro.";
  }
  if (!entitlement.renews) return end ? `Cancelled. Pro stays active until ${end}.` : "Cancelled.";
  return end ? `Renews on ${end}` : "Renews monthly";
}

function SubscriptionCard({
  entitlement,
  status,
  card,
  plans,
  timezone,
  now,
}: {
  entitlement: Entitlement;
  status: SubscriptionStatus | null;
  card: CardOnFile | null;
  plans: PlanCatalog;
  timezone: string | null;
  now: number;
}) {
  const date = (iso: string) => formatBillingDate(iso, timezone);
  const pill = statusPill(entitlement, status);
  const method = !entitlement.paid
    ? "None"
    : card
      ? `${card.brand} •••• ${card.last4}${card.exp ? ` · expires ${card.exp}` : ""}`
      : "Card on file with Paystack";

  return (
    <section className="card flex h-full flex-col gap-5" aria-labelledby="billing-subscription">
      <div className="flex items-center justify-between gap-3">
        <h2 id="billing-subscription" className="text-lg font-bold">
          Your subscription
        </h2>
        <span className={`status-dot text-sm ${pill.className}`}>{pill.label}</span>
      </div>
      <dl className="stack-md text-sm">
        <div className="stack-sm">
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="text-base font-semibold">
            {plans[entitlement.plan].name}
            {entitlement.paid ? <span className="font-normal text-muted-foreground"> · {formatNaira(plans.pro.priceNaira)}/month</span> : null}
          </dd>
        </div>
        <div className="stack-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd className={endsSoon(entitlement, now) || status === "past_due" ? "font-semibold" : undefined}>
            {statusLine(entitlement, status, date)}
          </dd>
        </div>
        <div className="stack-sm">
          <dt className="text-muted-foreground">Payment method</dt>
          <dd>{method}</dd>
        </div>
      </dl>
      <div className="mt-auto">
        {entitlement.paid ? (
          <SubscriptionControls
            canCancel={entitlement.renews}
            endsOn={entitlement.endsAt ? date(entitlement.endsAt) : null}
            primaryUpdate={status === "past_due"}
          />
        ) : (
          <p className="field-help">Pay by card through Paystack. Renews monthly. Cancel any time.</p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Usage this month
// ---------------------------------------------------------------------------

function UsageCard({ monthly, plan }: { monthly: MonthlyUsageResult; plan: Entitlement["plan"] }) {
  return (
    <section className="card stack-md" aria-labelledby="billing-usage">
      <div className="stack-sm">
        <h2 id="billing-usage" className="text-heading">
          Usage this month
        </h2>
        <p className="text-sm text-muted-foreground">
          Counts uses in the last 30 days. Uses that fail because of a service problem don&apos;t count.
        </p>
      </div>
      {monthly.ok ? (
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {monthly.features.map((feature) =>
            // A 0 allowance means the plan doesn't include it: say so instead of a full meter.
            feature.limit === 0 ? (
              <div key={feature.kind} className="stack-sm">
                <p className="text-sm font-semibold">{feature.label}</p>
                <p className="text-sm text-muted-foreground">Pro only</p>
              </div>
            ) : (
              <UsageMeter key={feature.kind} id={`usage-${feature.kind}`} feature={feature} />
            ),
          )}
          <div className="stack-sm">
            <p className="text-sm font-semibold">{GATED_FEATURES.youtube_research.label}</p>
            <p className="text-sm text-muted-foreground">
              {planIncludes(plan, "youtube_research") ? "Included" : "Pro only"}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">We couldn&apos;t load your usage right now. Refresh to try again.</p>
      )}
      {plan === "free" ? <UpgradeButton /> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

function historyRows(payments: PaymentView[], plans: PlanCatalog, timezone: string | null): HistoryRow[] {
  const date = (iso: string | null) => (iso ? formatBillingDate(iso, timezone) : "—");
  return payments.map((payment) => ({
    id: payment.id,
    label: `${plans[payment.plan].name} · ${PAYMENT_KIND_LABELS[payment.kind]}`,
    provider: PROVIDER_LABELS[payment.provider],
    amount: formatNaira(payment.amountMinor / 100),
    paidOn: payment.paidAt ? date(payment.paidAt) : date(payment.createdAt),
    coversUntil: date(payment.coversUntil),
    status: payment.status,
    statusLabel: PAYMENT_STATUS_LABELS[payment.status],
  }));
}

export async function BillingContent() {
  await connection();
  const { userId } = await auth.protect();

  const { plans } = readPlanCatalog();
  const config = readBillingConfig();
  const available = Boolean(config.paystack && config.appUrl);

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "billing_overview_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const { now, allowance, monthly } = await getPlanUsage(client, userId);
  const [overview, timezone] = await Promise.all([getBillingOverview(client, userId, now), getTimezone(client, userId)]);
  const tz = timezone.ok ? timezone.timezone : null;

  if (!overview.ok) {
    return (
      <div className="stack-lg">
        <LoadError />
        <PlanRow
          entitlement={allowance.entitlement}
          plans={plans}
          available={false}
          subscriptionCard={null}
        />
      </div>
    );
  }

  const { entitlement, subscriptionStatus, card, payments } = overview.overview;

  return (
    <div className="stack-lg">
      <PlanFocus targetId={PRO_CARD_ID} />
      <PlanRow
        entitlement={entitlement}
        plans={plans}
        available={available}
        subscriptionCard={
          <SubscriptionCard
            entitlement={entitlement}
            status={subscriptionStatus}
            card={card}
            plans={plans}
            timezone={tz}
            now={now}
          />
        }
      />
      <UsageCard monthly={monthly} plan={entitlement.plan} />
      <BillingHistory rows={historyRows(payments, plans, tz)} />
    </div>
  );
}
