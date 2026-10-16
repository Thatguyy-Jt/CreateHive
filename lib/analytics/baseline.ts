// How a post compares with the creator's own usual numbers. Pure, no I/O.
//
// - A post is represented by its latest check-in.
// - A post is "settled" once that check-in was captured at least 7 days after
//   it was published; earlier results are "early" and never compared.
// - The baseline for a post is the median of each metric over the creator's
//   other settled posts on the same platform. It needs at least 3 of them.
// - Labels are plain words (above / around / below your usual). There is no
//   combined score, percentile or prediction.

import type { Platform } from "@/lib/schemas/creator";

export const SETTLED_AFTER_DAYS = 7;
export const MIN_BASELINE_POSTS = 3;
export const ABOVE_RATIO = 1.25;
export const BELOW_RATIO = 0.8;
/** Follower change compares differences: a quarter of the usual, at least 1 follower. */
export const FOLLOWER_MARGIN_RATIO = 0.25;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CheckInValues {
  captured_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follower_delta: number | null;
  retention_rate: number | null;
}

export interface BaselinePost {
  id: string;
  platform: Platform | null;
  published_at: string;
  /** Video posts also compare average % viewed. */
  video: boolean;
  latest: CheckInValues | null;
}

export const METRICS = ["views", "engagement_rate", "follower_delta", "retention_rate"] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_LABELS: Record<Metric, string> = {
  views: "Views",
  engagement_rate: "Engagement rate",
  follower_delta: "Follower change",
  retention_rate: "Average % viewed",
};

export type ComparisonLabel = "above" | "around" | "below";

export const COMPARISON_TEXT: Record<ComparisonLabel, string> = {
  above: "Above your usual",
  around: "Around your usual",
  below: "Below your usual",
};

export interface MetricComparison {
  metric: Metric;
  value: number | null;
  /** Null when fewer than `MIN_BASELINE_POSTS` other settled posts have this metric. */
  median: number | null;
  /** Other settled posts on the platform with this metric. */
  sampleSize: number;
  /** Null for early posts, a missing value or no baseline. */
  label: ComparisonLabel | null;
}

export interface PostComparison {
  settled: boolean;
  /** Whole days from publishing to the latest check-in; null without one. */
  ageDays: number | null;
  /** Other settled posts on the same platform. */
  peers: number;
  metrics: MetricComparison[];
  headline: { metric: Metric; label: ComparisonLabel } | null;
}

/** The check-in captured last. */
export function latestCheckIn<T extends { captured_at: string }>(checkIns: readonly T[]): T | null {
  let latest: T | null = null;
  for (const checkIn of checkIns) {
    if (!latest || Date.parse(checkIn.captured_at) > Date.parse(latest.captured_at)) latest = checkIn;
  }
  return latest;
}

/** Whole days between publishing and `at` (never negative). */
export function ageInDays(publishedAt: string, at: string | number): number {
  const ms = (typeof at === "number" ? at : Date.parse(at)) - Date.parse(publishedAt);
  return Math.max(0, Math.floor(ms / DAY_MS));
}

export function isSettled(post: Pick<BaselinePost, "published_at" | "latest">): boolean {
  if (!post.latest) return false;
  return Date.parse(post.latest.captured_at) - Date.parse(post.published_at) >= SETTLED_AFTER_DAYS * DAY_MS;
}

/** (likes + comments + shares + saves) / views, when views > 0 and at least one of the four is known. */
export function engagementRate(values: Omit<CheckInValues, "captured_at">): number | null {
  if (values.views === null || values.views <= 0) return null;
  const parts = [values.likes, values.comments, values.shares, values.saves].filter((v): v is number => v !== null);
  if (parts.length === 0) return null;
  return parts.reduce((sum, value) => sum + value, 0) / values.views;
}

export function metricValue(values: CheckInValues | null, metric: Metric): number | null {
  if (!values) return null;
  return metric === "engagement_rate" ? engagementRate(values) : values[metric];
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function compare(value: number, usual: number, metric: Metric): ComparisonLabel {
  if (metric === "follower_delta") {
    const margin = Math.max(1, Math.abs(usual) * FOLLOWER_MARGIN_RATIO);
    if (value >= usual + margin) return "above";
    if (value <= usual - margin) return "below";
    return "around";
  }
  if (usual === 0) return value > 0 ? "above" : "around";
  const ratio = value / usual;
  if (ratio >= ABOVE_RATIO) return "above";
  if (ratio <= BELOW_RATIO) return "below";
  return "around";
}

const metricsFor = (video: boolean): readonly Metric[] => (video ? METRICS : METRICS.filter((m) => m !== "retention_rate"));

/** The other settled posts on the same platform. */
function peersOf(post: BaselinePost, posts: readonly BaselinePost[]): BaselinePost[] {
  return posts.filter((other) => other.id !== post.id && other.platform === post.platform && isSettled(other));
}

/** Views first; engagement rate when views can't be labelled. */
export function headlineFor(metrics: readonly MetricComparison[]): PostComparison["headline"] {
  for (const metric of ["views", "engagement_rate"] as const) {
    const found = metrics.find((m) => m.metric === metric && m.label !== null);
    if (found?.label) return { metric, label: found.label };
  }
  return null;
}

/** How `post` compares with the creator's other settled posts on its platform. */
export function baselineFor(post: BaselinePost, posts: readonly BaselinePost[]): PostComparison {
  const settled = isSettled(post);
  const peers = peersOf(post, posts);
  const metrics = metricsFor(post.video).map((metric): MetricComparison => {
    const value = metricValue(post.latest, metric);
    const peerValues = peers.map((p) => metricValue(p.latest, metric)).filter((v): v is number => v !== null);
    const usual = peerValues.length >= MIN_BASELINE_POSTS ? median(peerValues) : null;
    const label = settled && value !== null && usual !== null ? compare(value, usual, metric) : null;
    return { metric, value, median: usual, sampleSize: peerValues.length, label };
  });
  return {
    settled,
    ageDays: post.latest ? ageInDays(post.published_at, post.latest.captured_at) : null,
    peers: peers.length,
    metrics,
    headline: headlineFor(metrics),
  };
}

export interface PlatformSummary {
  platform: Platform | null;
  posts: number;
  settled: number;
  /** Medians over settled posts; null below `MIN_BASELINE_POSTS` values. */
  usualViews: number | null;
  usualEngagementRate: number | null;
}

/** One summary per platform with posts, most posts first. */
export function platformSummaries(posts: readonly BaselinePost[]): PlatformSummary[] {
  const groups = new Map<Platform | null, BaselinePost[]>();
  for (const post of posts) groups.set(post.platform, [...(groups.get(post.platform) ?? []), post]);

  const usual = (settled: BaselinePost[], metric: Metric) => {
    const values = settled.map((p) => metricValue(p.latest, metric)).filter((v): v is number => v !== null);
    return values.length >= MIN_BASELINE_POSTS ? median(values) : null;
  };
  return [...groups.entries()]
    .map(([platform, group]) => {
      const settled = group.filter(isSettled);
      return {
        platform,
        posts: group.length,
        settled: settled.length,
        usualViews: usual(settled, "views"),
        usualEngagementRate: usual(settled, "engagement_rate"),
      };
    })
    .toSorted((a, b) => b.posts - a.posts);
}

/**
 * Posts whose results are missing or still early a week after publishing,
 * oldest first. Posts with no results at all always need them.
 */
export function needsResults<T extends BaselinePost>(posts: readonly T[], now: number): T[] {
  return posts
    .filter((post) => {
      if (Date.parse(post.published_at) > now) return false;
      if (!post.latest) return true;
      return !isSettled(post) && ageInDays(post.published_at, now) >= SETTLED_AFTER_DAYS;
    })
    .toSorted((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
}
