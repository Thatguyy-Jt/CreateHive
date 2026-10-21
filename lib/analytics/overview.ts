// The analytics overview for one platform: KPI tabs, a series per metric,
// top posts, views by format and the above/around/below mix. Pure, no I/O:
// built from the posts the service already read. Every number traces back to
// results the creator logged.

import { platform as platformSchema, type Platform } from "@/lib/schemas/creator";
import {
  baselineFor,
  isSettled,
  median,
  metricValue,
  METRICS,
  MIN_BASELINE_POSTS,
  type BaselinePost,
  type ComparisonLabel,
  type Metric,
  type PostComparison,
} from "./baseline";
import { CHART_POST_LIMIT } from "./chart-data";

/** Rows in the top-posts list. */
export const TOP_POSTS_LIMIT = 5;
/** Bars in the views-by-format chart. */
export const FORMAT_LIMIT = 5;
/** The search-param value for posts saved without a platform. */
export const NO_PLATFORM = "none";
export const NO_FORMAT = "No format";

export type OverviewPost = BaselinePost & { title: string; format: string | null };

export interface MetricKpi {
  metric: Metric;
  /** Median over the platform's settled posts; null below `MIN_BASELINE_POSTS` values. */
  usual: number | null;
  /** Settled posts that have this metric. */
  sample: number;
  /** The most recently published settled post with this metric. */
  latest: { id: string; title: string; value: number } | null;
  /**
   * The latest post against `usual`: a ratio − 1 for views, engagement and
   * % viewed; a signed difference for follower change. Null without both.
   */
  delta: number | null;
}

export interface MetricPoint {
  id: string;
  title: string;
  published_at: string;
  value: number;
  settled: boolean;
  /** This metric's comparison, as the post list labels it. */
  label: ComparisonLabel | null;
}

export interface TopPost {
  id: string;
  title: string;
  format: string | null;
  published_at: string;
  views: number;
  /** Views against the post's own peer baseline (ratio − 1), as its pill compares it. */
  vsUsual: number | null;
}

export interface FormatViews {
  format: string;
  posts: number;
  medianViews: number;
}

export interface ComparisonMix {
  above: number;
  around: number;
  below: number;
}

export interface PlatformOverview {
  platform: Platform | null;
  posts: number;
  settled: number;
  kpis: MetricKpi[];
  series: Record<Metric, MetricPoint[]>;
  topPosts: TopPost[];
  formats: FormatViews[];
  mix: ComparisonMix;
}

const byPublished = (a: { published_at: string }, b: { published_at: string }) =>
  Date.parse(a.published_at) - Date.parse(b.published_at);

/** The latest-post delta: signed difference for follower change, ratio − 1 otherwise. */
export function kpiDelta(metric: Metric, value: number, usual: number): number | null {
  if (metric === "follower_delta") return value - usual;
  if (usual === 0) return null;
  return value / usual - 1;
}

/** Most common original spelling in a group, first seen wins ties. */
function displayName(spellings: string[]): string {
  const counts = new Map<string, number>();
  for (const name of spellings) counts.set(name, (counts.get(name) ?? 0) + 1);
  let best = spellings[0];
  for (const [name, count] of counts) if (count > (counts.get(best) ?? 0)) best = name;
  return best;
}

/** Everything the analytics overview draws for `platform`. */
export function platformOverview<T extends OverviewPost>(posts: readonly T[], platform: Platform | null): PlatformOverview {
  const own = posts.filter((post) => post.platform === platform);
  const settled = own.filter(isSettled);

  // One comparison per post, against all of `posts`, exactly as the post list does.
  const comparisons = new Map<string, PostComparison>();
  const comparisonOf = (post: T) => {
    let found = comparisons.get(post.id);
    if (!found) {
      found = baselineFor(post, posts);
      comparisons.set(post.id, found);
    }
    return found;
  };
  const labelOf = (post: T, metric: Metric) => comparisonOf(post).metrics.find((m) => m.metric === metric)?.label ?? null;

  const kpis = METRICS.map((metric): MetricKpi => {
    const withValue = settled
      .map((post) => ({ post, value: metricValue(post.latest, metric) }))
      .filter((entry): entry is { post: T; value: number } => entry.value !== null);
    const usual = withValue.length >= MIN_BASELINE_POSTS ? median(withValue.map((entry) => entry.value)) : null;
    const newest = withValue.toSorted((a, b) => byPublished(b.post, a.post))[0] ?? null;
    const latest = newest ? { id: newest.post.id, title: newest.post.title, value: newest.value } : null;
    return {
      metric,
      usual,
      sample: withValue.length,
      latest,
      delta: latest && usual !== null ? kpiDelta(metric, latest.value, usual) : null,
    };
  });

  const series = Object.fromEntries(
    METRICS.map((metric) => [
      metric,
      own
        .map((post) => ({ post, value: metricValue(post.latest, metric) }))
        .filter((entry): entry is { post: T; value: number } => entry.value !== null)
        .toSorted((a, b) => byPublished(a.post, b.post))
        .slice(-CHART_POST_LIMIT)
        .map(({ post, value }): MetricPoint => ({
          id: post.id,
          title: post.title,
          published_at: post.published_at,
          value,
          settled: isSettled(post),
          label: labelOf(post, metric),
        })),
    ]),
  ) as Record<Metric, MetricPoint[]>;

  const withViews = settled.filter((post) => post.latest?.views !== null && post.latest?.views !== undefined);

  const topPosts = withViews
    .toSorted((a, b) => b.latest!.views! - a.latest!.views! || byPublished(b, a))
    .slice(0, TOP_POSTS_LIMIT)
    .map((post): TopPost => {
      const views = post.latest!.views!;
      const usual = comparisonOf(post).metrics.find((m) => m.metric === "views")?.median ?? null;
      return {
        id: post.id,
        title: post.title,
        format: post.format,
        published_at: post.published_at,
        views,
        vsUsual: usual !== null && usual > 0 ? views / usual - 1 : null,
      };
    });

  const groups = new Map<string, { spellings: string[]; views: number[] }>();
  for (const post of withViews) {
    const spelling = post.format?.trim() ?? "";
    const key = spelling.toLowerCase();
    const group = groups.get(key) ?? { spellings: [], views: [] };
    group.spellings.push(spelling);
    group.views.push(post.latest!.views!);
    groups.set(key, group);
  }
  const formats = [...groups.entries()]
    .map(([key, group]): FormatViews => ({
      format: key === "" ? NO_FORMAT : displayName(group.spellings),
      posts: group.views.length,
      medianViews: median(group.views) ?? 0,
    }))
    .toSorted((a, b) => b.posts - a.posts || b.medianViews - a.medianViews)
    .slice(0, FORMAT_LIMIT);

  const mix: ComparisonMix = { above: 0, around: 0, below: 0 };
  for (const post of withViews) {
    const label = labelOf(post, "views");
    if (label) mix[label] += 1;
  }

  return { platform, posts: own.length, settled: settled.length, kpis, series, topPosts, formats, mix };
}

/** The search-param value for a platform group. */
export const platformParam = (platform: Platform | null): string => platform ?? NO_PLATFORM;

/**
 * The platform the page shows: the requested one when the creator has posts
 * on it, otherwise the first (most posts). Never trusts the raw param.
 */
export function pickPlatform(
  requested: string | string[] | undefined,
  available: readonly (Platform | null)[],
): Platform | null | undefined {
  if (available.length === 0) return undefined;
  const value = Array.isArray(requested) ? requested[0] : requested;
  if (value === NO_PLATFORM && available.includes(null)) return null;
  const parsed = platformSchema.safeParse(value);
  if (parsed.success && available.includes(parsed.data)) return parsed.data;
  return available[0];
}
