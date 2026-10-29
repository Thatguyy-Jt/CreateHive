// Display helpers for results (en-US, matching the rest of the app). Pure.

import type { ComparisonLabel, Metric } from "./baseline";

const full = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const signed = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, signDisplay: "exceptZero" });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

/** "1,234", or "1.2K" when `short`. */
export function formatCount(value: number, short = false): string {
  return (short ? compact : full).format(value);
}

/** "+12" / "-3" / "0". */
export function formatSigned(value: number): string {
  return signed.format(value);
}

/** 0.042 → "4.2%". */
export function formatPercent(rate: number): string {
  return percent.format(rate);
}

export function formatMetric(metric: Metric, value: number): string {
  if (metric === "engagement_rate" || metric === "retention_rate") return formatPercent(value);
  if (metric === "follower_delta") return formatSigned(Math.round(value));
  return formatCount(Math.round(value));
}

/** "1:35" for 95, "1:02:03" for 3723. */
export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Decorative only: the words carry the meaning. */
export const LABEL_ARROWS: Record<ComparisonLabel, string> = { above: "↑", around: "→", below: "↓" };
