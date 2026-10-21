import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { connection } from "next/server";
import { METRICS, MIN_BASELINE_POSTS, type Metric } from "@/lib/analytics/baseline";
import { formatCount } from "@/lib/analytics/format";
import { pickPlatform, platformParam, type PlatformOverview } from "@/lib/analytics/overview";
import { formatDay, localDateKey, todayIn } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { postDateRange } from "@/lib/schemas/analytics";
import { PLATFORM_LABELS, type Platform } from "@/lib/schemas/creator";
import { getAnalyticsOverview, POST_LIST_LIMIT, type PostListEntry, type PostSummary } from "@/lib/services/analytics";
import { getTimezone } from "@/lib/services/calendar";
import { createUserClient } from "@/lib/supabase/server";
import { EmptyHero } from "../app-shell/empty-hero";
import type { DrawnColumn } from "../charts/column-chart";
import { ComparisonDonut } from "../charts/comparison-donut";
import { FormatBars } from "../charts/format-bars";
import { StatTile } from "../charts/stat-tile";
import { ComparisonPill } from "./comparison";
import { LoadError } from "./load-error";
import { MetricOverview } from "./metric-overview";
import { PastPostForm } from "./past-post-form";
import { TopPosts } from "./top-posts";

/** "Wed, Oct 14" in the creator's zone, or null without one. */
export function postDay(instant: string, tz: string | null): string | null {
  const key = tz ? localDateKey(instant, tz) : null;
  return key ? formatDay(key) : null;
}

const metaLine = (post: Pick<PostSummary, "platform" | "format">) =>
  [post.platform ? PLATFORM_LABELS[post.platform] : null, post.format].filter(Boolean).join(" · ");

const platformLabel = (platform: Platform | null) => (platform ? PLATFORM_LABELS[platform] : "No platform");

/** One link per platform with posts; the selected one is the current page. */
function PlatformSwitcher({ platforms, selected }: { platforms: (Platform | null)[]; selected: Platform | null }) {
  return (
    <nav aria-label="Platform">
      <ul className="flex flex-wrap gap-2">
        {platforms.map((platform) => {
          const current = platform === selected;
          return (
            <li key={platformParam(platform)}>
              <Link
                href={`/app/analytics?platform=${platformParam(platform)}`}
                aria-current={current ? "page" : undefined}
                scroll={false}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-pill border px-4 text-sm font-bold ${
                  current ? "" : "border-border hover:border-muted-foreground"
                }`}
              >
                {platformLabel(platform)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The selected platform: KPI tabs and chart, then top posts, views by format and the comparison mix. */
function PlatformOverviewSection({ overview, tz }: { overview: PlatformOverview; tz: string | null }) {
  const name = platformLabel(overview.platform);
  const series = Object.fromEntries(
    METRICS.map((metric) => [
      metric,
      overview.series[metric].map((point): DrawnColumn => ({ ...point, dateLabel: postDay(point.published_at, tz) })),
    ]),
  ) as Record<Metric, DrawnColumn[]>;
  const dayOf = Object.fromEntries(overview.topPosts.map((post) => [post.id, postDay(post.published_at, tz)]));
  const compared = overview.mix.above + overview.mix.around + overview.mix.below;
  const onlyFormat = overview.formats.length === 1 ? overview.formats[0] : null;

  return (
    <>
      <MetricOverview platformName={name} kpis={overview.kpis} series={series} />
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <TopPosts posts={overview.topPosts} dayOf={dayOf} />
        <section className="card stack-md" aria-labelledby="analytics-formats">
          <div>
            <h2 id="analytics-formats" className="text-heading">
              Views by format
            </h2>
            <p className="field-help">Median views of settled posts</p>
          </div>
          {overview.formats.length > 1 ? (
            <FormatBars formats={overview.formats} />
          ) : onlyFormat ? (
            <StatTile
              label={onlyFormat.format}
              value={formatCount(Math.round(onlyFormat.medianViews), true)}
              note={`Median of ${onlyFormat.posts} ${onlyFormat.posts === 1 ? "post" : "posts"}. Try another format to compare.`}
            />
          ) : (
            <p className="text-muted-foreground">Views by format appear once posts have week-old results.</p>
          )}
        </section>
        <section className="card stack-md md:col-span-2 lg:col-span-1" aria-labelledby="analytics-mix">
          <div>
            <h2 id="analytics-mix" className="text-heading">
              How your posts compare
            </h2>
            <p className="field-help">Settled posts, views vs your usual</p>
          </div>
          {compared >= MIN_BASELINE_POSTS ? (
            <ComparisonDonut mix={overview.mix} />
          ) : (
            <p className="text-muted-foreground">
              Not enough compared posts yet ({compared} of {MIN_BASELINE_POSTS}). A post is compared once{" "}
              {MIN_BASELINE_POSTS} others on {name} have week-old results.
            </p>
          )}
        </section>
      </div>
    </>
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
/** Session-bound part of /app/analytics: the platform overview, posts needing results, the post list and the past-post form. */
export async function AnalyticsContent({ searchParams }: { searchParams: Promise<{ platform?: string | string[] }> }) {
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

  const [result, timezone, profile, params] = await Promise.all([
    getAnalyticsOverview(client, userId),
    getTimezone(client, userId),
    client.from("creator_profiles").select("platforms").eq("user_id", userId).maybeSingle(),
    searchParams,
  ]);
  if (!result.ok) return <LoadError />;
  const { overview } = result;
  const tz = timezone.ok ? timezone.timezone : null;
  const today = tz ? todayIn(tz) : null;
  const firstPlatform = profile.data?.platforms?.[0] ?? null;
  const empty = overview.posts.length === 0;

  // Validated against the creator's own platforms; never used in a query.
  const platforms = overview.overviews.map((o) => o.platform);
  const selected = pickPlatform(params.platform, platforms);
  const current = selected === undefined ? null : (overview.overviews.find((o) => o.platform === selected) ?? null);

  return (
    <div className="stack-lg">
      {empty ? (
        <EmptyHero
          title="No posts yet"
          titleId="analytics-empty"
          action={
            <a href="#log-past-post" className="btn btn-primary">
              Log a past post
            </a>
          }
        >
          <p>Mark a Studio item as published, or log a post you already made, to start your baseline.</p>
        </EmptyHero>
      ) : (
        <>
          {current ? (
            <section className="stack-md" aria-labelledby="analytics-overview">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="analytics-overview" className="text-heading">
                  Overview{platforms.length > 1 ? null : ` · ${platformLabel(current.platform)}`}
                </h2>
                {platforms.length > 1 ? <PlatformSwitcher platforms={platforms} selected={current.platform} /> : null}
              </div>
              <PlatformOverviewSection key={platformParam(current.platform)} overview={current} tz={tz} />
            </section>
          ) : null}
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

      <details id="log-past-post" className="card stack-sm scroll-mt-24" open={empty ? true : undefined}>
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
