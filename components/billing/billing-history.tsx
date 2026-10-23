"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Icon } from "@/components/app-shell/icons";
import type { PaymentDisplayStatus } from "@/lib/services/billing";
import { CheckStatusButton } from "./check-status-button";

/** One history row, already formatted on the server. */
export interface HistoryRow {
  id: string;
  /** "Pro · 30-day pass" */
  label: string;
  provider: string;
  amount: string;
  paidOn: string;
  coversUntil: string;
  status: PaymentDisplayStatus;
  statusLabel: string;
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "succeeded", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

const STATUS_CLASS: Record<PaymentDisplayStatus, string> = {
  succeeded: "status-paid",
  pending: "status-pending",
  failed: "status-failed",
  expired: "status-expired",
};

function matches(filter: Filter, status: PaymentDisplayStatus) {
  if (filter === "all") return true;
  // Expired checkouts were never paid: they sit with Failed.
  if (filter === "failed") return status === "failed" || status === "expired";
  return status === filter;
}

function RowActions({ row }: { row: HistoryRow }) {
  if (row.status === "pending") return <CheckStatusButton paymentId={row.id} />;
  if (row.status !== "succeeded") return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/app/settings/billing/receipts/${row.id}?print=1`}
        className="btn btn-secondary btn-sm size-9 p-0"
        aria-label={`Download receipt for ${row.label}, ${row.paidOn}`}
        title="Download receipt"
      >
        <Icon name="download" size={16} />
      </Link>
      <Link
        href={`/app/settings/billing/receipts/${row.id}`}
        className="btn btn-secondary btn-sm size-9 p-0"
        aria-label={`View receipt for ${row.label}, ${row.paidOn}`}
        title="View receipt"
      >
        <Icon name="eye" size={16} />
      </Link>
    </div>
  );
}

/** Billing history: a table on wide screens, stacked rows on phones, with a status filter and CSV export. */
export function BillingHistory({ rows }: { rows: HistoryRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const filterId = useId();
  const shown = rows.filter((row) => matches(filter, row.status));

  return (
    <section className="card stack-md" aria-labelledby="billing-history">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="billing-history" className="text-heading">
          Billing history
        </h2>
        {rows.length ? (
          <div className="flex items-center gap-2">
            <label htmlFor={filterId} className="sr-only">
              Show payments
            </label>
            <select
              id={filterId}
              className="input min-h-10 py-1.5 text-sm"
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
            >
              {FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <a href="/app/settings/billing/export" className="btn btn-secondary btn-sm" download>
              <Icon name="download" size={16} />
              Export CSV
            </a>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">No payments yet. When you upgrade, receipts will appear here.</p>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground">No payments match this filter.</p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-md border border-border md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Plan</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Amount</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Paid on</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Covers until</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((row) => (
                  <tr key={row.id} className="h-14">
                    <td className="px-4 py-2">
                      <span className="font-semibold">{row.label}</span>
                      <span className="block text-xs text-muted-foreground">{row.provider}</span>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{row.amount}</td>
                    <td className="px-4 py-2 tabular-nums">{row.paidOn}</td>
                    <td className="px-4 py-2 tabular-nums">{row.coversUntil}</td>
                    <td className="px-4 py-2">
                      <span className={`status-dot ${STATUS_CLASS[row.status]}`}>{row.statusLabel}</span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end">
                        <RowActions row={row} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-border md:hidden">
            {shown.map((row) => (
              <li key={row.id} className="stack-sm py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{row.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {row.provider} · <span className="tabular-nums">{row.amount}</span>
                    </p>
                  </div>
                  <span className={`status-dot text-sm ${STATUS_CLASS[row.status]}`}>{row.statusLabel}</span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Paid on</dt>
                    <dd className="tabular-nums">{row.paidOn}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Covers until</dt>
                    <dd className="tabular-nums">{row.coversUntil}</dd>
                  </div>
                </dl>
                <RowActions row={row} />
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="field-help">
        Receipts here are payment receipts. Paystack also emails its own receipt.
      </p>
    </section>
  );
}
