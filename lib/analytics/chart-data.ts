// Data for the analytics charts. Pure, no I/O: the service builds these from
// the posts it already read, and client chart components only draw them.

import type { Platform } from "@/lib/schemas/creator";
import { baselineFor, isSettled, type BaselinePost, type ComparisonLabel } from "./baseline";

/** Posts drawn per platform on /app/analytics. */
export const CHART_POST_LIMIT = 20;
/** Posts drawn in the dashboard sparkline. */
export const SPARK_POST_LIMIT = 12;

/** One post with views, as a chart draws it. Plain and serialisable. */
export interface ChartPoint {
  id: string;
  title: string;
  published_at: string;
  views: number;
  settled: boolean;
  /** The views comparison; null for early posts or without a baseline. */
  label: ComparisonLabel | null;
}

type TitledPost = BaselinePost & { title: string };

/**
 * The platform's newest `limit` posts that have views, oldest first. Each is
 * labelled against all of `posts`, exactly as the post list labels it.
 */
export function chartPointsFor(
  posts: readonly TitledPost[],
  platform: Platform | null,
  limit: number = CHART_POST_LIMIT,
): ChartPoint[] {
  return posts
    .filter((post) => post.platform === platform && post.latest?.views !== null && post.latest?.views !== undefined)
    .toSorted((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at))
    .slice(-limit)
    .map((post) => ({
      id: post.id,
      title: post.title,
      published_at: post.published_at,
      views: post.latest!.views!,
      settled: isSettled(post),
      label: baselineFor(post, posts).metrics.find((m) => m.metric === "views")?.label ?? null,
    }));
}

/** A clean step (1, 2, 2.5 or 5 × 10ⁿ) at or above `raw`. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * Round tick values from 0 that cover `max`, about `count` intervals.
 * A max of 0 (or less) gives `[0, 1]` so a flat chart still has a scale.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const step = niceStep(max / count);
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

/**
 * A domain that always contains 0, so bars for signed values (follower change)
 * grow from zero in either direction. Padded by `pad` on each non-zero side.
 */
export function signedDomain(values: readonly number[], pad = 1.15): [number, number] {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  if (min === 0 && max === 0) return [0, 1];
  return [min * pad, max * pad];
}
