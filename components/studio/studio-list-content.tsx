import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { connection } from "next/server";
import { formatDay, formatTime, localDateKey, localTimeKey } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import { getTimezone } from "@/lib/services/calendar";
import { listStudioItems, type StudioListItem } from "@/lib/services/studio";
import { createUserClient } from "@/lib/supabase/server";
import { LoadError } from "./load-error";

/** "Wed, Oct 14, 9:00 AM" in the creator's timezone, or null without one. */
export function scheduleLabel(instant: string, tz: string | null): string | null {
  if (!tz) return null;
  const date = localDateKey(instant, tz);
  const time = localTimeKey(instant, tz);
  if (!date || !time) return null;
  return `${formatDay(date)}, ${formatTime(time)}`;
}

function StudioRow({ item, tz }: { item: StudioListItem; tz: string | null }) {
  const headingId = `studio-item-${item.id}`;
  const meta = [item.platform ? PLATFORM_LABELS[item.platform] : null, item.format].filter(Boolean).join(" · ");
  const scheduled = item.status === "scheduled" && item.scheduled_for;
  const label = scheduled ? scheduleLabel(item.scheduled_for!, tz) : null;
  return (
    <article className="card stack-sm" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {item.pillar_name ? (
          <span className="rounded-pill border border-border px-3 py-1 font-semibold break-words">{item.pillar_name}</span>
        ) : null}
        {meta ? <span className="text-muted-foreground break-words">{meta}</span> : null}
      </div>
      <h2 id={headingId} className="text-lg font-bold break-words">
        <Link href={`/app/studio/${item.id}`} className="link">
          {item.title}
        </Link>
      </h2>
      <p className="text-sm">
        {scheduled ? (label ? `Scheduled for ${label}` : "Scheduled") : "Not scheduled"}
        {item.passed ? <span className="text-muted-foreground"> · Date passed</span> : null}
      </p>
      <p className="text-sm font-semibold">{item.has_package ? "Package ready" : "No package yet"}</p>
    </article>
  );
}

/** Session-bound part of /app/studio: the list, its empty state, or a load error. */
export async function StudioListContent() {
  // "Date passed" depends on the current time: never prerender.
  await connection();
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "studio_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const [list, timezone] = await Promise.all([listStudioItems(client, userId), getTimezone(client, userId)]);
  if (!list.ok) return <LoadError />;
  const tz = timezone.ok ? timezone.timezone : null;

  if (list.items.length === 0) {
    return (
      <section className="card max-w-3xl stack-sm" aria-labelledby="studio-empty">
        <h2 id="studio-empty" className="text-heading">
          Nothing in Studio yet
        </h2>
        <p className="text-muted-foreground">Pick a saved idea to start.</p>
        <div>
          <Link href="/app/opportunities?view=saved" className="btn btn-primary w-full min-[480px]:w-auto">
            Go to saved ideas
          </Link>
        </div>
      </section>
    );
  }

  return (
    <ul className="stack-md max-w-3xl" aria-label="Studio items">
      {list.items.map((item) => (
        <li key={item.id}>
          <StudioRow item={item} tz={tz} />
        </li>
      ))}
    </ul>
  );
}
