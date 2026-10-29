import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { connection } from "next/server";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { formatDay } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import { getBreakdownStatus, HISTORY_MAX, HISTORY_PAGE_SIZE, listBreakdowns, type BreakdownSummary } from "@/lib/services/video-breakdown";
import { createUserClient } from "@/lib/supabase/server";
import { BreakdownForm } from "./breakdown-form";

export function BreakdownLoadError() {
  return (
    <div role="alert" className="card max-w-3xl stack-sm">
      <h2 className="text-heading">We couldn&apos;t load your breakdowns</h2>
      <p className="text-muted-foreground">Something went wrong on our side. Refresh the page to try again.</p>
    </div>
  );
}

function LockedCard() {
  return (
    <section className="card card-offset stack-md" aria-labelledby="breakdown-locked">
      <div className="stack-sm">
        <p className="eyebrow">Pro</p>
        <h2 id="breakdown-locked" className="text-heading">
          Learn from any video, then make it yours
        </h2>
      </div>
      <ul className="list-disc stack-sm pl-5">
        <li>Paste a link to a video you admire, from YouTube, TikTok, Instagram and more.</li>
        <li>See why it likely worked: the hook, structure, format and what the audience responded to.</li>
        <li>Get your own version, for your niche, pillars and voice, ready to take into Studio.</li>
      </ul>
      <UpgradeButton />
    </section>
  );
}

function MissingContextCard() {
  return (
    <section className="card stack-sm" aria-labelledby="breakdown-context">
      <h2 id="breakdown-context" className="text-heading">
        Build your strategy first
      </h2>
      <p className="text-muted-foreground">
        Your version of a video should fit your niche, pillars and platforms, so a breakdown needs your strategy.
      </p>
      <div>
        <Link href="/app/strategy" className="btn btn-primary btn-sm w-full min-[480px]:w-auto">
          Go to Strategy
        </Link>
      </div>
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function History({ items, more, shown }: { items: BreakdownSummary[]; more: boolean; shown: number }) {
  return (
    <section className="stack-md" aria-labelledby="breakdown-history">
      <h2 id="breakdown-history" className="text-heading">
        Your breakdowns
      </h2>
      {items.length === 0 ? (
        <div className="card">
          <p>Your breakdowns will show up here. Paste a link above to start.</p>
        </div>
      ) : (
        <ul className="card stack-sm" aria-label="Breakdowns">
          {items.map((item) => {
            const day = formatDay(item.created_at.slice(0, 10));
            return (
              <li
                key={item.id}
                className="flex flex-col gap-2 border-b border-border pb-3 last:border-0 last:pb-0 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between"
              >
                <div className="grid min-w-0 gap-1">
                  <p className="font-semibold break-words">{item.title ?? `${PLATFORM_LABELS[item.platform]} video · ${hostOf(item.source_url)}`}</p>
                  <p className="text-sm text-muted-foreground">
                    {PLATFORM_LABELS[item.platform]}
                    {day ? ` · ${day}` : ""}
                  </p>
                </div>
                <Link href={`/app/breakdown/${item.id}`} className="btn btn-secondary btn-sm w-full shrink-0 min-[480px]:w-auto">
                  Open
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {more && shown < HISTORY_MAX ? (
        <div>
          <Link href={`/app/breakdown?show=${shown + HISTORY_PAGE_SIZE}`} className="link font-semibold" scroll={false}>
            Show more
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/** Session-bound part of /app/breakdown: the form (or why it's unavailable) and the creator's history. */
export async function BreakdownContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Allowance usage depends on the current time: never prerendered.
  await connection();
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "video_breakdown_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <BreakdownLoadError />;
  }

  const params = await searchParams;
  const requested = Number(typeof params.show === "string" ? params.show : HISTORY_PAGE_SIZE);
  const shown = Number.isFinite(requested) ? Math.min(Math.max(HISTORY_PAGE_SIZE, Math.floor(requested)), HISTORY_MAX) : HISTORY_PAGE_SIZE;

  const [status, history] = await Promise.all([getBreakdownStatus(client, userId), listBreakdowns(client, userId, shown)]);
  if (status.state === "error" || !history.ok) return <BreakdownLoadError />;

  return (
    <div className="stack-md max-w-3xl">
      {params.deleted === "1" ? (
        <p role="status" className="field-help">
          Breakdown deleted.
        </p>
      ) : null}
      {status.state === "plan_required" ? (
        <LockedCard />
      ) : status.state === "missing_context" ? (
        <MissingContextCard />
      ) : (
        <BreakdownForm platforms={status.platforms} used={status.used} limit={status.limit} youtubeConfigured={status.youtubeConfigured} />
      )}
      <History items={history.items} more={history.more} shown={shown} />
    </div>
  );
}
