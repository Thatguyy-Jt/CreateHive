import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { addDays, formatDay, formatTime, todayIn } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { MAX_DAYS_AHEAD } from "@/lib/schemas/calendar";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import { getTimezone } from "@/lib/services/calendar";
import { EDITABLE_STATUSES, getStudioItem, type StudioItem } from "@/lib/services/studio";
import { createUserClient } from "@/lib/supabase/server";
import { EvidenceList } from "../opportunities/evidence-list";
import { GeneratePackageControl } from "./generate-package-control";
import { LoadError } from "./load-error";
import { PackageSections } from "./package-sections";
import { ScheduleDraftForm } from "./schedule-draft-form";

function HeaderCard({ item }: { item: StudioItem }) {
  const meta = [item.platform ? PLATFORM_LABELS[item.platform] : null, item.format].filter(Boolean).join(" · ");
  const when =
    item.status === "scheduled"
      ? item.date && item.time
        ? `Scheduled for ${formatDay(item.date)}, ${formatTime(item.time)}`
        : "Scheduled"
      : "Not scheduled";
  const idea = item.idea;
  return (
    <section className="card card-offset stack-sm" aria-labelledby="studio-item-title">
      <p className="eyebrow">Content package</p>
      <h2 id="studio-item-title" className="text-heading break-words">
        {item.title}
      </h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {item.pillar_name ? (
          <span className="rounded-pill border border-border px-3 py-1 font-semibold break-words">{item.pillar_name}</span>
        ) : null}
        {meta ? <span className="text-muted-foreground break-words">{meta}</span> : null}
      </div>
      <p className="text-sm font-semibold">
        {when}
        {item.passed ? <span className="font-normal text-muted-foreground"> · Date passed</span> : null}
      </p>
      {idea && (idea.audience_need || idea.angle || idea.evidence.length) ? (
        <details className="stack-sm">
          <summary className="min-h-11 cursor-pointer content-center font-semibold">About this idea</summary>
          <dl className="stack-sm pt-2">
            {idea.audience_need ? (
              <div>
                <dt className="font-semibold">Who it&apos;s for</dt>
                <dd className="text-muted-foreground break-words">{idea.audience_need}</dd>
              </div>
            ) : null}
            {idea.angle ? (
              <div>
                <dt className="font-semibold">Angle</dt>
                <dd className="text-muted-foreground break-words">{idea.angle}</dd>
              </div>
            ) : null}
            {idea.evidence.length ? (
              <div>
                <dt className="font-semibold">Evidence</dt>
                <dd>
                  <EvidenceList evidence={idea.evidence} />
                </dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}
    </section>
  );
}

function NextAction({ item, tz }: { item: StudioItem; tz: string | null }) {
  if (item.status === "scheduled") {
    return (
      <div>
        <Link
          href={item.date ? `/app/calendar?week=${item.date}` : "/app/calendar"}
          className="btn btn-secondary w-full min-[480px]:w-auto"
        >
          View in calendar
        </Link>
      </div>
    );
  }
  if (item.status !== "draft") return null;

  const today = tz ? todayIn(tz) : null;
  return (
    <section className="card stack-sm" aria-labelledby="studio-schedule">
      <h2 id="studio-schedule" className="text-heading">
        Schedule it
      </h2>
      {today ? (
        <ScheduleDraftForm
          itemId={item.id}
          defaultDate={addDays(today, 1) ?? today}
          min={today}
          max={addDays(today, MAX_DAYS_AHEAD) ?? today}
        />
      ) : (
        <p className="text-muted-foreground">
          Confirm your timezone on the{" "}
          <Link href="/app/calendar" className="link">
            calendar
          </Link>{" "}
          first, so the date lines up with your week.
        </p>
      )}
    </section>
  );
}

function PackageArea({ item }: { item: StudioItem }) {
  const latest = item.latest;
  const pkg = latest?.package ?? null;
  const unreadable = latest !== null && pkg === null;
  const editable = (EDITABLE_STATUSES as readonly string[]).includes(item.status);

  // The generate control keeps one tree position whether or not a package
  // exists, so its success toast survives the re-render.
  return (
    <div className="stack-lg">
      {pkg ? (
        <div>
          {/* Outline: the section h3s sit under this, not under "Schedule it". */}
          <h2 className="sr-only">Package</h2>
          <PackageSections pkg={pkg} />
        </div>
      ) : unreadable ? (
        <div role="alert" className="alert">
          <p className="font-semibold">This package couldn&apos;t be shown. Regenerate it to continue.</p>
        </div>
      ) : null}
      {editable ? (
        <div className={latest ? "stack-sm" : "card stack-sm"}>
          {latest ? null : (
            <>
              <h2 className="text-heading">No package yet</h2>
              <p className="text-muted-foreground">Turn this idea into a script, shot list and caption in your voice.</p>
            </>
          )}
          <GeneratePackageControl itemId={item.id} hasPackage={latest !== null} />
        </div>
      ) : (
        <p className="text-muted-foreground">
          This item is published or archived, so a package can&apos;t be generated for it.
        </p>
      )}
    </div>
  );
}

/** Session-bound part of /app/studio/[id]. Another creator's or an unknown id is a 404. */
export async function StudioItemContent({ params }: { params: Promise<{ id: string }> }) {
  // Past and upcoming dates depend on the current time: never prerender.
  await connection();
  const { userId } = await auth.protect();
  const { id } = await params;

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "studio_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const timezone = await getTimezone(client, userId);
  const tz = timezone.ok ? timezone.timezone : null;
  const result = await getStudioItem(client, userId, id, tz);
  if (!result.ok) {
    if (result.code === "not_found") notFound();
    return <LoadError />;
  }
  const { item } = result;

  return (
    <div className="stack-lg">
      <HeaderCard item={item} />
      <NextAction item={item} tz={tz} />
      <PackageArea item={item} />
    </div>
  );
}
