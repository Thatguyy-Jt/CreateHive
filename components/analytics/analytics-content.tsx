import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { connection } from "next/server";
import { COMPARISON_TEXT, MIN_BASELINE_POSTS, type PlatformSummary } from "@/lib/analytics/baseline";
import { CHART_POST_LIMIT, type ChartPoint } from "@/lib/analytics/chart-data";
import { formatCount, formatPercent } from "@/lib/analytics/format";
import { formatDay, localDateKey, todayIn } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { postDateRange } from "@/lib/schemas/analytics";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import { getAnalyticsOverview, POST_LIST_LIMIT, type PostListEntry, type PostSummary } from "@/lib/services/analytics";
import { getTimezone } from "@/lib/services/calendar";
import { createUserClient } from "@/lib/supabase/server";
import { ColumnChart, type DrawnColumn } from "../charts/column-chart";
import { StatTile } from "../charts/stat-tile";
import { ComparisonPill, platformName } from "./comparison";
import { LoadError } from "./load-error";
import { PastPostForm } from "./past-post-form";

/** "Wed, Oct 14" in the creator's zone, or null without one. */
export function postDay(instant: string, tz: string | null): string | null {
  const key = tz ? localDateKey(instant, tz) : null;
  return key ? formatDay(key) : null;
}

const metaLine = (post: Pick<PostSummary, "platform" | "format">) =>
  [post.platform ? PLATFORM_LABELS[post.platform] : null, post.format].filter(Boolean).join(" · ");

const VIEWS_HELP = "Needs 3 posts with settled results";

function PlatformCard({
  summary,
  points,
  tz,
}: {
  summary: PlatformSummary;
  points: ChartPoint[];
  tz: string | null;
}) {
  const name = summary.platform ? PLATFORM_LABELS[summary.platform] : "No platform";
  const headingId = `platform-${summary.platform ?? "none"}`;
  const ready = summary.usualViews !== null || summary.usualEngagementRate !== null;
  const drawn: DrawnColumn[] = points.map((point) => ({ ...point, dateLabel: postDay(point.published_at, tz) }));
  const both = drawn.some((p) => p.settled) && drawn.some((p) => !p.settled);
  const usual = summary.usualViews;
  return (
    <li className="card stack-md" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-lg font-bold">
        {name}
      </h3>
      <div className="@container">
        <div className="grid gap-3 @[34rem]:grid-cols-3">
        <StatTile
          label="Posts"
          value={formatCount(summary.posts)}
          note={`${summary.settled} with settled results`}
        />
        <StatTile
          label="Usual views"
          value={usual !== null ? formatCount(Math.round(usual), true) : "—"}
          note={usual !== null ? "Middle of your settled posts" : VIEWS_HELP}
        />
        <StatTile
          label="Usual engagement"
          value={summary.usualEngagementRate !== null ? formatPercent(summary.usualEngagementRate) : "—"}
          note={summary.usualEngagementRate !== null ? "Likes, comments, shares, saves per view" : VIEWS_HELP}
        />
        </div>
      </div>
      {ready ? null : (
        <p className="text-muted-foreground">
          Not enough posts yet: {Math.min(summary.settled, MIN_BASELINE_POSTS)} of {MIN_BASELINE_POSTS} with settled results
          on {platformName(summary.platform)}. Log a past post to compare sooner.
        </p>
      )}
      {drawn.length >= 2 ? (
        <figure className="stack-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <figcaption className="text-sm font-semibold">
              Views per post{drawn.length === CHART_POST_LIMIT ? ` (last ${CHART_POST_LIMIT})` : ""}
            </figcaption>
            {both ? (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label="Legend">
                <li className="flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-3 w-3 rounded-[3px] bg-[var(--chart-accent)]" />
                  Settled
                </li>
                <li className="flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-3 w-3 rounded-[3px] bg-[var(--chart-muted)]" />
                  Early (first week)
                </li>
              </ul>
            ) : null}
          </div>
          <ColumnChart
            points={drawn}
            usual={usual}
            label={`Views per post on ${name}, oldest to newest: ${drawn.length} posts from ${formatCount(Math.min(...drawn.map((p) => p.views)))} to ${formatCount(Math.max(...drawn.map((p) => p.views)))} views${usual !== null ? `; your usual is ${formatCount(Math.round(usual))}` : ""}. Each column links to its post.`}
          />
          <details className="stack-sm">
            <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Show as table</summary>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Views per post on {name}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-3 font-semibold">Post</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Posted</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">Views</th>
                  <th scope="col" className="hidden py-2 font-semibold min-[480px]:table-cell">Compared</th>
                </tr>
              </thead>
              <tbody>
                {drawn.toReversed().map((point) => (
                  <tr key={point.id} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 pr-3 font-normal break-words">
                      <Link href={`/app/analytics/${point.id}`} className="link">
                        {point.title}
                      </Link>
                    </th>
                    <td className="py-2 pr-3 whitespace-nowrap">{point.dateLabel ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCount(point.views)}</td>
                    <td className="hidden py-2 min-[480px]:table-cell">
                      {point.label ? COMPARISON_TEXT[point.label] : point.settled ? "Not compared" : "Early results"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </figure>
      ) : (
        <p className="field-help">Add results to 2 or more posts to see a chart.</p>
      )}
    </li>
  );
}

function NeedsResults({ posts, tz }: { posts: PostSummary[]; tz: string | null }) {
  return (
    <section className="card stack-sm" aria-labelledby="analytics-needs">
      <h2 id="analytics-needs" className="text-heading">
        Needs results
      </h2>
      <p className="field-help">Posts with no numbers yet, or only early ones from their first week.</p>
      <ul className="stack-sm">
        {posts.map((post) => {
          const day = postDay(post.published_at, tz);
          return (
            <li key={post.id} className="flex flex-col gap-2 border-b border-border pb-3 last:border-0 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
              <div className="min-w-0">
                <p className="font-semibold break-words">{post.title}</p>
                <p className="field-help">
                  {[metaLine(post), day ? `Posted ${day}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Link
                href={`/app/analytics/${post.id}#results`}
                className="btn btn-secondary btn-sm w-full shrink-0 min-[480px]:w-auto"
                aria-label={`${post.latest ? "Update" : "Add"} results for ${post.title}`}
              >
                {post.latest ? "Update results" : "Add results"}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PostRow({ post, tz }: { post: PostListEntry; tz: string | null }) {
  const headingId = `post-${post.id}`;
  const day = postDay(post.published_at, tz);
  const status = post.comparison.headline ? (
    <ComparisonPill label={post.comparison.headline.label} />
  ) : (
    <span className="text-sm text-muted-foreground">
      {!post.latest ? "No results yet" : !post.comparison.settled ? "Early results" : "Not enough posts to compare"}
    </span>
  );
  return (
    <article className="card stack-sm" aria-labelledby={headingId}>
      <p className="field-help">{[metaLine(post), day ? `Posted ${day}` : null].filter(Boolean).join(" · ")}</p>
      <h3 id={headingId} className="text-lg font-bold break-words">
        <Link href={`/app/analytics/${post.id}`} className="link">
          {post.title}
        </Link>
      </h3>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {post.latest?.views !== null && post.latest?.views !== undefined ? (
          <span className="tabular-nums">{formatCount(post.latest.views, true)} views</span>
        ) : null}
        {status}
      </div>
    </article>
  );
}

/** Session-bound part of /app/analytics: summaries, posts needing results, the post list and the past-post form. */
export async function AnalyticsContent() {
  // "Needs results" and dates depend on the current time: never prerender.
  await connection();
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "analytics_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const [result, timezone, profile] = await Promise.all([
    getAnalyticsOverview(client, userId),
    getTimezone(client, userId),
    client.from("creator_profiles").select("platforms").eq("user_id", userId).maybeSingle(),
  ]);
  if (!result.ok) return <LoadError />;
  const { overview } = result;
  const tz = timezone.ok ? timezone.timezone : null;
  const today = tz ? todayIn(tz) : null;
  const firstPlatform = profile.data?.platforms?.[0] ?? null;
  const empty = overview.posts.length === 0;

  return (
    <div className="stack-lg">
      {empty ? (
        <section className="card stack-sm" aria-labelledby="analytics-empty">
          <h2 id="analytics-empty" className="text-heading">
            No posts yet
          </h2>
          <p className="text-muted-foreground">
            Mark a Studio item as published, or log a post you already made, to start your baseline.
          </p>
        </section>
      ) : (
        <>
          <section className="stack-sm" aria-labelledby="analytics-platforms">
            <h2 id="analytics-platforms" className="text-heading">
              Your usual numbers
            </h2>
            <ul className="stack-md">
              {overview.platforms.map((summary, index) => (
                <PlatformCard
                  key={summary.platform ?? "none"}
                  summary={summary}
                  points={overview.charts[index]?.points ?? []}
                  tz={tz}
                />
              ))}
            </ul>
          </section>
          {overview.needsResults.length ? <NeedsResults posts={overview.needsResults} tz={tz} /> : null}
          <section className="stack-sm" aria-labelledby="analytics-posts">
            <h2 id="analytics-posts" className="text-heading">
              Posts
            </h2>
            {overview.truncated ? <p className="field-help">Showing your {POST_LIST_LIMIT} most recent posts.</p> : null}
            <ul className="stack-md">
              {overview.posts.map((post) => (
                <li key={post.id}>
                  <PostRow post={post} tz={tz} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <details className="card stack-sm" open={empty ? true : undefined}>
        <summary className="min-h-11 cursor-pointer content-center text-heading">Log a past post</summary>
        <div className="stack-sm pt-2">
          <p className="field-help">
            Add a post you made before using CreateHive, or outside Studio, so your usual numbers build faster.
          </p>
          {today ? (
            <PastPostForm defaultDate={today} defaultPlatform={firstPlatform} {...postDateRange(today)} />
          ) : (
            <p className="text-muted-foreground">
              Confirm your timezone on the{" "}
              <Link href="/app/calendar" className="link">
                calendar
              </Link>{" "}
              first, so dates line up with your week.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
