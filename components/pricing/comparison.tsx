import { Icon } from "@/components/app-shell/icons";
import { GATED_FEATURES, PLAN_ALLOWANCES, QUOTA_FEATURES, UNLIMITED_FEATURES } from "@/lib/billing/features";
import { PLAN_ORDER, type PlanCatalog } from "@/lib/billing/plans";
import type { SubscriptionPlan } from "@/lib/schemas/enums";

type Cell = { kind: "count"; value: number } | { kind: "yes" } | { kind: "no" } | { kind: "unlimited" };

interface ComparisonRow {
  label: string;
  cells: Record<SubscriptionPlan, Cell>;
}

function rows(): ComparisonRow[] {
  const byPlan = (fn: (plan: SubscriptionPlan) => Cell) =>
    Object.fromEntries(PLAN_ORDER.map((plan) => [plan, fn(plan)])) as Record<SubscriptionPlan, Cell>;
  return [
    ...QUOTA_FEATURES.map((feature) => ({
      label: `${feature.label} per month`,
      cells: byPlan((plan) => ({ kind: "count", value: PLAN_ALLOWANCES[plan][feature.kind] })),
    })),
    ...Object.values(GATED_FEATURES).map((feature) => ({
      label: feature.label,
      cells: byPlan((plan) => (feature.plans.includes(plan) ? { kind: "yes" } : { kind: "no" })),
    })),
    ...UNLIMITED_FEATURES.map((label) => ({ label, cells: byPlan(() => ({ kind: "unlimited" })) })),
  ];
}

function CellView({ cell }: { cell: Cell }) {
  switch (cell.kind) {
    case "count":
      return <span className="font-semibold tabular-nums">{cell.value}</span>;
    case "unlimited":
      return <span className="font-semibold">Unlimited</span>;
    case "yes":
      return (
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Icon name="check-circle" size={18} className="plan-check" />
          Included
        </span>
      );
    default:
      return <span className="text-muted-foreground">Not included</span>;
  }
}

/** Every plan row from `lib/billing/features.ts`: a table on wide screens, one list per plan on phones. */
export function Comparison({ plans }: { plans: PlanCatalog }) {
  const data = rows();
  return (
    <section className="section border-t border-border" aria-labelledby="compare-heading">
      <div className="container-page stack-lg">
        <div className="stack-sm max-w-2xl">
          <p className="eyebrow">Compare plans</p>
          <h2 id="compare-heading">Everything in each plan</h2>
          <p className="lead">
            Monthly allowances count uses in the last 30 days. Anything without an AI cost is unlimited on both plans.
          </p>
        </div>

        <div className="hidden overflow-hidden rounded-lg border border-border md:block">
          <table className="w-full text-left">
            <thead className="bg-surface-muted">
              <tr>
                <th scope="col" className="px-5 py-4 text-sm font-semibold text-muted-foreground">
                  Feature
                </th>
                {PLAN_ORDER.map((plan) => (
                  <th key={plan} scope="col" className="w-48 px-5 py-4 text-sm font-bold">
                    {plans[plan].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-5 py-3.5 text-sm font-normal">
                    {row.label}
                  </th>
                  {PLAN_ORDER.map((plan) => (
                    <td key={plan} className="px-5 py-3.5 text-sm">
                      <CellView cell={row.cells[plan]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 md:hidden">
          {PLAN_ORDER.map((plan) => (
            <div key={plan} className="card stack-sm">
              <h3 className="text-lg font-bold">{plans[plan].name}</h3>
              <dl className="divide-y divide-border text-sm">
                {data.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
                    <dt>{row.label}</dt>
                    <dd className="text-right">
                      <CellView cell={row.cells[plan]} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
