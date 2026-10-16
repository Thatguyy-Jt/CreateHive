import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatCount, formatDuration, formatPercent, formatSigned } from "@/lib/analytics/format";
import { formatDay, formatTime, todayIn } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { postDateRange, RESULT_FIELD_LABELS } from "@/lib/schemas/analytics";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import { getPost, type CheckInEntry, type PostDetail } from "@/lib/services/analytics";
import { getTimezone } from "@/lib/services/calendar";
import { getLatestDiagnosis } from "@/lib/services/diagnosis";
import { createUserClient } from "@/lib/supabase/server";
import { LineChart } from "../charts/line-chart";
import { MetricBars } from "../charts/metric-bars";
import { ComparisonPill, ComparisonTable, comparisonNote } from "./comparison";
import { DiagnosisCard } from "./diagnosis-card";
import { DeletePostControl, DeleteResultsButton } from "./delete-controls";
import { EditDetailsForm } from "./edit-details-form";
import { LoadError } from "./load-error";
import { ResultsForm } from "./results-form";

function HeaderCard({ post }: { post: PostDetail }) {
  const meta = [post.platform ? PLATFORM_LABELS[post.platform] : null, post.format].filter(Boolean).join(" · ");
  const day = post.date ? formatDay(post.date) : null;
  const time = post.time ? formatTime(post.time) : null;
  return (
    <section className="card card-offset stack-sm" aria-labelledby="post-title">
      <p className="eyebrow">Published post</p>
      <h2 id="post-title" className="text-heading break-words">
        {post.title}
      </h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {post.pillar_name ? (
          <span className="rounded-pill border border-border px-3 py-1 font-semibold break-words">{post.pillar_name}</span>
        ) : null}
        {meta ? <span className="text-muted-foreground break-words">{meta}</span> : null}
      </div>
      <p className="text-sm font-semibold">{day ? `Posted ${day}${time ? `, ${time}` : ""}` : "Posted"}</p>
      <dl className="stack-sm text-sm">
        {post.hook_used ? (
          <div>
            <dt className="font-semibold">Hook used</dt>
            <dd className="break-words text-muted-foreground">{post.hook_used}</dd>
          </div>
        ) : null}
        {post.duration_seconds ? (
          <div>
            <dt className="font-semibold">Length</dt>
            <dd className="tabular-nums text-muted-foreground">{formatDuration(post.duration_seconds)}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {post.published_url ? (
          <a href={post.published_url} target="_blank" rel="noopener noreferrer" className="link break-all">
            View the post<span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        {post.from_studio ? (
          <Link href={`/app/studio/${post.id}`} className="link">
            Made in Studio: view the package
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function ComparisonCard({ post }: { post: PostDetail }) {
  const { comparison } = post;
  const note = comparisonNote(comparison, post.platform, post.checkIns.length > 0);
  return (
    <section className="card stack-sm" aria-labelledby="post-compare">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="post-compare" className="text-heading">
          Compared with your usual
        </h2>
        {comparison.headline ? <ComparisonPill label={comparison.headline.label} /> : null}
      </div>
      {note ? <p className="text-muted-foreground">{note}</p> : null}
      {post.checkIns.length ? (
        <>
          <MetricBars metrics={comparison.metrics} settled={comparison.settled} />
          <details className="stack-sm">
            <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Show as table</summary>
            <ComparisonTable comparison={comparison} platform={post.platform} />
          </details>
        </>
      ) : null}
      <p className="field-help">
        Your usual is the middle value of your other posts on this platform, using each post&apos;s latest results from at
        least a week after posting. It&apos;s a comparison, not a prediction.
      </p>
    </section>
  );
}

/** "1,200 views · 80 likes · +4 followers · 41.5% viewed". */
function checkInText(checkIn: CheckInEntry): string {
  const parts: string[] = [];
  const count = (value: number | null, label: string) => {
    if (value !== null) parts.push(`${formatCount(value)} ${label}`);
  };
  count(checkIn.views, "views");
  count(checkIn.likes, "likes");
  count(checkIn.comments, "comments");
  count(checkIn.shares, "shares");
  count(checkIn.saves, "saves");
  if (checkIn.follower_delta !== null) parts.push(`${formatSigned(checkIn.follower_delta)} followers`);
  if (checkIn.avg_view_duration_seconds !== null) {
    parts.push(`${formatDuration(checkIn.avg_view_duration_seconds)} ${RESULT_FIELD_LABELS.avg_view_duration_seconds.toLowerCase()}`);
  }
  if (checkIn.retention_rate !== null) parts.push(`${formatPercent(checkIn.retention_rate)} viewed`);
  return parts.join(" · ");
}

function History({ checkIns, usualViews }: { checkIns: CheckInEntry[]; usualViews: number | null }) {
  if (checkIns.length === 0) return null;
  const withViews = checkIns.flatMap((c) =>
    c.views === null ? [] : [{ day: c.day, views: c.views, dateLabel: c.date ? formatDay(c.date) : null }],
  );
  return (
    <section className="card stack-sm" aria-labelledby="post-history">
      <h2 id="post-history" className="text-heading">
        Results history
      </h2>
      {withViews.length >= 2 ? (
        <figure className="stack-sm">
          <figcaption className="text-sm font-semibold">Views over time</figcaption>
          <LineChart
            points={withViews}
            usual={usualViews}
            label={`Views over time: from ${formatCount(withViews[0].views)} on day ${withViews[0].day} to ${formatCount(withViews[withViews.length - 1].views)} on day ${withViews[withViews.length - 1].day}${usualViews !== null ? `; your usual is ${formatCount(usualViews)}` : ""}`}
          />
        </figure>
      ) : null}
      <ol className="stack-sm">
        {checkIns.toReversed().map((checkIn) => {
          const day = checkIn.date ? formatDay(checkIn.date) : null;
          const label = day ?? `day ${checkIn.day}`;
          return (
            <li
              key={checkIn.id}
              className="flex flex-col gap-2 border-b border-border pb-3 last:border-0 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {day ? `${day} · ` : ""}Day {checkIn.day}
                </p>
                <p className="tabular-nums break-words text-muted-foreground">{checkInText(checkIn)}</p>
              </div>
              <DeleteResultsButton snapshotId={checkIn.id} label={label} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Session-bound part of /app/analytics/[id]. Another creator's, unpublished or invalid id → 404. */
export async function PostContent({ params }: { params: Promise<{ id: string }> }) {
  // Day numbers and the date range depend on the current time.
  await connection();
  const { userId } = await auth.protect();
  const { id } = await params;

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "analytics_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const timezone = await getTimezone(client, userId);
  const tz = timezone.ok ? timezone.timezone : null;
  const result = await getPost(client, userId, id, tz);
  if (!result.ok) {
    if (result.code === "not_found") notFound();
    return <LoadError />;
  }
  const { post } = result;
  // The diagnosis is secondary: if it fails to load, the rest of the page still works.
  const diagnosis = await getLatestDiagnosis(client, userId, post.id, post.checkIns.at(-1)?.id ?? null);
  const today = tz ? todayIn(tz) : null;

  return (
    <div className="stack-lg">
      <HeaderCard post={post} />
      <ComparisonCard post={post} />
      <DiagnosisCard post={post} latest={diagnosis.ok ? diagnosis.latest : undefined} tz={tz} />
      <section id="results" className="card stack-sm scroll-mt-24" aria-labelledby="post-add-results">
        <h2 id="post-add-results" className="text-heading">
          {post.checkIns.length ? "Update results" : "Add results"}
        </h2>
        {!post.live ? (
          <p className="text-muted-foreground">This post&apos;s date is in the future. Add results once it&apos;s live.</p>
        ) : (
          <>
            <p className="field-help">
              Copy the numbers from the platform&apos;s insights. Fill in what you have; each save is kept as a check-in.
            </p>
            <ResultsForm itemId={post.id} video={post.video} />
          </>
        )}
      </section>
      <History
        checkIns={post.checkIns}
        usualViews={post.comparison.metrics.find((m) => m.metric === "views")?.median ?? null}
      />
      {today && post.date && post.time ? (
        <EditDetailsForm
          itemId={post.id}
          identity={!post.from_studio}
          video={post.video}
          defaults={{
            title: post.title,
            platform: post.platform ?? "",
            format: post.format ?? "",
            date: post.date,
            time: post.time,
            published_url: post.published_url ?? "",
            hook_used: post.hook_used ?? "",
            duration_seconds: post.duration_seconds ? formatDuration(post.duration_seconds) : "",
          }}
          {...postDateRange(today)}
        />
      ) : null}
      <DeletePostControl itemId={post.id} fromStudio={post.from_studio} />
    </div>
  );
}
