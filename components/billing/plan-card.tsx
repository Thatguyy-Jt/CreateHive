import type { ReactNode } from "react";
import { Icon } from "@/components/app-shell/icons";
import { planHighlights } from "@/lib/billing/features";
import { formatNaira, type Plan } from "@/lib/billing/plans";

/**
 * One plan: name, badge, price, call to action, then what's included. Pro is
 * the dark, highlighted card. Shared by /pricing and Settings › Billing.
 */
export function PlanCard({
  plan,
  cta,
  id,
  headingLevel = "h3",
}: {
  plan: Plan;
  /** Buttons or a status line, directly under the price. */
  cta: ReactNode;
  id?: string;
  headingLevel?: "h2" | "h3";
}) {
  const pro = plan.id === "pro";
  const headingId = `${id ?? `plan-${plan.id}`}-heading`;
  const Heading = headingLevel;
  return (
    <article
      id={id}
      tabIndex={id ? -1 : undefined}
      className={`card flex h-full flex-col gap-5 ${pro ? "plan-card-dark" : ""}`}
      aria-labelledby={headingId}
    >
      <div className="stack-sm">
        <div className="flex items-center justify-between gap-3">
          <Heading id={headingId} className="text-lg font-bold">
            {plan.name} plan
          </Heading>
          <span
            className={`rounded-pill border px-2.5 py-0.5 text-xs font-bold tracking-wide ${
              pro ? "plan-badge-pro" : "border-border"
            }`}
          >
            {pro ? "PRO" : "FREE"}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{plan.tagline}</p>
      </div>
      <p className="flex items-baseline gap-1.5">
        <span className="text-4xl font-extrabold tabular-nums tracking-tight">{formatNaira(plan.priceNaira)}</span>
        <span className="text-muted-foreground">/month</span>
      </p>
      <div>{cta}</div>
      <ul className="stack-sm border-t border-current/15 pt-5 text-sm" aria-label={`Included in ${plan.name}`}>
        {planHighlights(plan.id).map((line) => (
          <li key={line} className="flex items-start gap-2.5">
            <Icon name="check-circle" size={20} className="plan-check" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
