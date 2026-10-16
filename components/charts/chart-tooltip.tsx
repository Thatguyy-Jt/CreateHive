import type { ReactNode } from "react";
import { formatCount } from "@/lib/analytics/format";

/** Half the tooltip's max width: keeps it inside the chart near the edges. */
const HALF = 96;

/**
 * Floating readout above a point: the value leads, details follow. Positioned
 * in the chart container's pixel space; never takes pointer events.
 */
export function ChartTooltip({
  x,
  y,
  width,
  value,
  children,
}: {
  x: number;
  y: number;
  /** The container's width, to keep the tooltip inside it. */
  width: number;
  value: string;
  children?: ReactNode;
}) {
  const left = Math.min(Math.max(x, HALF), Math.max(HALF, width - HALF));
  return (
    <div
      className="pointer-events-none absolute z-10 w-max max-w-48 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-sm"
      style={{ left, top: y - 12 }}
    >
      <p className="flex items-center gap-2 font-semibold">
        <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded-full bg-[var(--chart-accent)]" />
        {value}
      </p>
      {children ? <div className="mt-1 grid gap-0.5 text-muted-foreground">{children}</div> : null}
    </div>
  );
}

/**
 * Key for the reference line, above the plot: a line key and the value. Kept
 * out of the plot so it never collides with columns or the data line.
 */
export function UsualKey({ usual }: { usual: number }) {
  return (
    <p className="mb-1 flex items-center justify-end gap-2 text-sm text-muted-foreground">
      <span aria-hidden="true" className="inline-block h-[1.5px] w-4 bg-foreground" />
      Your usual · <span className="font-semibold text-foreground">{formatCount(usual, true)}</span>
    </p>
  );
}
