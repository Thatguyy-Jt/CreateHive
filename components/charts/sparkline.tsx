"use client";

import type { ChartPoint } from "@/lib/analytics/chart-data";
import { useWidth } from "./use-width";

const HEIGHT = 48;
const PAD = 6;

/**
 * Recent views as a small line, with the usual as a hairline. Decorative: the
 * card states the numbers in text and a visually hidden summary.
 */
export function Sparkline({ points, usual }: { points: ChartPoint[]; usual: number | null }) {
  const [ref, width] = useWidth<HTMLDivElement>(280);
  const max = Math.max(1, ...points.map((p) => p.views), usual ?? 0);
  const step = points.length > 1 ? (width - PAD * 2) / (points.length - 1) : 0;
  const x = (index: number) => (points.length > 1 ? PAD + index * step : width / 2);
  const y = (value: number) => HEIGHT - PAD - (value / max) * (HEIGHT - PAD * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.views)}`).join(" ");

  return (
    <div ref={ref} className="w-full" aria-hidden="true">
      <svg width={width} height={HEIGHT} className="block overflow-visible">
        {usual !== null ? (
          <line x1={0} x2={width} y1={y(usual)} y2={y(usual)} stroke="var(--muted-foreground)" strokeWidth={1} />
        ) : null}
        <path d={line} fill="none" stroke="var(--chart-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle
            key={p.id}
            cx={x(i)}
            cy={y(p.views)}
            r={i === points.length - 1 || !p.settled ? 4 : 0}
            fill={p.settled ? "var(--chart-accent)" : "var(--chart-muted)"}
            stroke="var(--surface)"
            strokeWidth={2}
          />
        ))}
      </svg>
    </div>
  );
}
