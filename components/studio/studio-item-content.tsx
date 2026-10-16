import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { addDays, formatDay, formatTime, localDateKey, localTimeKey, todayIn } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { MAX_DAYS_AHEAD } from "@/lib/schemas/calendar";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import { getTimezone } from "@/lib/services/calendar";
import { downloadFileName, formatRulesFor, packageToText } from "@/lib/schemas/studio";
import {
  EDITABLE_STATUSES,
  getStudioItem,
  listVersions,
  regenerableSections,
  type StudioItem,
  type StudioVersion,
  type VersionSummary,
} from "@/lib/services/studio";
import { createUserClient } from "@/lib/supabase/server";
import { postDateRange } from "@/lib/schemas/analytics";
import { PublishForm } from "../analytics/publish-form";
import { EvidenceList } from "../opportunities/evidence-list";
import { GeneratePackageControl } from "./generate-package-control";
import { LoadError } from "./load-error";
import { PackageSections } from "./package-sections";
import { DiscardDraftControl } from "./discard-draft-control";
import { PackageToolbar } from "./package-toolbar";
import { RestoreVersionForm } from "./restore-version-form";
import { ScheduleDraftForm } from "./schedule-draft-form";
import { SOURCE_LABELS, VersionHistory, versionTime } from "./version-history";

function HeaderCard({ item, tz }: { item: StudioItem; tz: string | null }) {
  const meta = [item.platform ? PLATFORM_LABELS[item.platform] : null, item.format].filter(Boolean).join(" · ");
  const posted = item.status === "published" && item.published_at && tz ? localDateKey(item.published_at, tz) : null;
  const when =
    item.status === "published"
      ? posted
        ? `Posted ${formatDay(posted)}`
        : "Published"
      : item.status === "scheduled"
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
  if (item.status === "published") {
    return (
      <div>
        <Link href={`/app/analytics/${item.id}`} className="btn btn-primary w-full min-[480px]:w-auto">
          View results
        </Link>
      </div>
    );
  }
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

/** The current hour in `tz`, as "HH:00". */
function currentHour(tz: string): string {
  const time = localTimeKey(Date.now(), tz);
  return time ? `${time.slice(0, 2)}:00` : "12:00";
}

/** "Posted it?": marks a draft or scheduled item as published, with the hook prefilled from the package. */
function PublishCard({ item, tz }: { item: StudioItem; tz: string | null }) {
  if (!(EDITABLE_STATUSES as readonly string[]).includes(item.status)) return null;
  const today = tz ? todayIn(tz) : null;
  // The scheduled slot, unless it is still ahead: a post can't be dated in the future.
  const scheduled = item.date && item.time && today && item.date <= today ? { date: item.date, time: item.time } : null;
  return (
    <section id="publish" className="card stack-sm scroll-mt-24" aria-labelledby="studio-publish">
      <h2 id="studio-publish" className="text-heading">
        Posted it? Mark as published
      </h2>
      <p className="field-help">Then add your results to see how it compares with your usual numbers.</p>
      {today && tz ? (
        <PublishForm
          itemId={item.id}
          defaultDate={scheduled?.date ?? today}
          defaultTime={scheduled?.time ?? currentHour(tz)}
          defaultHook={item.version?.package?.hooks[0]?.text ?? null}
          video={formatRulesFor(item.platform, item.format).video}
          {...postDateRange(today)}
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

/** "Version 4 · You · Oct 15, 9:12 AM" plus its note. */
function VersionLine({ version, tz }: { version: StudioVersion; tz: string | null }) {
  const time = versionTime({
    date: tz ? localDateKey(version.created_at, tz) : null,
    time: tz ? localTimeKey(version.created_at, tz) : null,
  });
  return (
    <p className="text-sm">
      <span className="font-semibold">
        Version {version.version_no} · {SOURCE_LABELS[version.source]}
      </span>
      {time ? <span className="text-muted-foreground"> · {time}</span> : null}
      {version.note ? <span className="text-muted-foreground"> · {version.note}</span> : null}
    </p>
  );
}

function PackageArea({ item, versions, tz }: { item: StudioItem; versions: VersionSummary[] | null; tz: string | null }) {
  const version = item.version;
  const pkg = version?.package ?? null;
  const unreadable = version !== null && pkg === null;
  const editable = (EDITABLE_STATUSES as readonly string[]).includes(item.status);
  const rules = formatRulesFor(item.platform, item.format);
  const edit =
    editable && pkg && version
      ? {
          itemId: item.id,
          baseVersion: version.version_no,
          platforms: item.platforms,
          regenerable: regenerableSections(pkg, rules),
        }
      : null;

  // The generate control keeps one tree position whether or not a package
  // exists, so its success toast survives the re-render.
  return (
    <div className="stack-lg">
      {pkg && version ? (
        <div className="stack-md">
          {/* Outline: the section h3s sit under this, not under "Schedule it". */}
          <h2 className="sr-only">Package</h2>
          <div className="stack-sm">
            <VersionLine version={version} tz={tz} />
            <PackageToolbar text={packageToText(pkg, item.title)} fileName={downloadFileName(item.title)} />
            {versions ? (
              <VersionHistory
                itemId={item.id}
                versions={versions}
                latestVersionNo={item.latestVersionNo}
                viewingVersionNo={version.version_no}
              />
            ) : null}
          </div>
          <PackageSections pkg={pkg} edit={edit} />
        </div>
      ) : unreadable ? (
        <div role="alert" className="alert">
          <p className="font-semibold">This package couldn&apos;t be shown. Regenerate it to continue.</p>
        </div>
      ) : null}
      {editable ? (
        <div className={version ? "stack-sm" : "card stack-sm"}>
          {version ? null : (
            <>
              <h2 className="text-heading">No package yet</h2>
              <p className="text-muted-foreground">Turn this idea into a script, shot list and caption in your voice.</p>
            </>
          )}
          <GeneratePackageControl itemId={item.id} hasPackage={version !== null} />
        </div>
      ) : (
        <p className="text-muted-foreground">
          This item is published or archived, so a package can&apos;t be generated for it.
        </p>
      )}
      {item.status === "draft" ? <DiscardDraftControl itemId={item.id} /> : null}
    </div>
  );
}

/** A past version, read-only, with Restore and Back to latest. */
function PreviewArea({ item, versions, tz }: { item: StudioItem; versions: VersionSummary[] | null; tz: string | null }) {
  const version = item.version!;
  const pkg = version.package;
  const editable = (EDITABLE_STATUSES as readonly string[]).includes(item.status);
  const time = versionTime({
    date: tz ? localDateKey(version.created_at, tz) : null,
    time: tz ? localTimeKey(version.created_at, tz) : null,
  });
  return (
    <div className="stack-lg">
      <section className="stack-sm rounded-md border-2 border-foreground p-4" aria-labelledby="studio-preview">
        <h2 id="studio-preview" className="text-base font-bold">
          Viewing version {version.version_no} ({SOURCE_LABELS[version.source]}
          {time ? `, ${time}` : ""})
        </h2>
        <p className="text-sm">This is a read-only copy. Your latest version is unchanged.</p>
        <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-start">
          {pkg && editable && item.latestVersionNo ? (
            <RestoreVersionForm itemId={item.id} versionNo={version.version_no} baseVersion={item.latestVersionNo} />
          ) : null}
          <div>
            <Link href={`/app/studio/${item.id}`} className="btn btn-secondary btn-sm w-full min-[480px]:w-auto">
              Back to latest
            </Link>
          </div>
        </div>
      </section>
      {pkg ? (
        <div className="stack-md">
          <h2 className="sr-only">Package, version {version.version_no}</h2>
          <div className="stack-sm">
            <PackageToolbar text={packageToText(pkg, item.title)} fileName={downloadFileName(item.title)} />
            {versions ? (
              <VersionHistory
                itemId={item.id}
                versions={versions}
                latestVersionNo={item.latestVersionNo}
                viewingVersionNo={version.version_no}
              />
            ) : null}
          </div>
          <PackageSections pkg={pkg} edit={null} />
        </div>
      ) : (
        <div role="alert" className="alert">
          <p className="font-semibold">This version couldn&apos;t be shown, so it can&apos;t be restored.</p>
        </div>
      )}
    </div>
  );
}

/** `?version=`: a positive whole number, or null (anything else shows the latest). */
function parseVersionParam(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^[1-9]\d{0,5}$/.test(raw)) return null;
  return Number(raw);
}

/** Session-bound part of /app/studio/[id]. Another creator's or an unknown id is a 404. */
export async function StudioItemContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Past and upcoming dates depend on the current time: never prerender.
  await connection();
  const { userId } = await auth.protect();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const requested = parseVersionParam(query.version);

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "studio_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const timezone = await getTimezone(client, userId);
  const tz = timezone.ok ? timezone.timezone : null;
  const [result, history] = await Promise.all([
    getStudioItem(client, userId, id, tz, { versionNo: requested }),
    listVersions(client, userId, id, tz),
  ]);
  if (!result.ok) {
    if (result.code === "not_found") notFound();
    return <LoadError />;
  }
  const { item } = result;
  // History is a convenience: if it fails to load, the page still works without it.
  const versions = history.ok ? history.versions : null;
  const previewing = item.version !== null && item.version.version_no !== item.latestVersionNo;

  return (
    <div className="stack-lg">
      <HeaderCard item={item} tz={tz} />
      {item.missingVersion ? (
        <section className="card stack-sm" aria-labelledby="studio-missing-version">
          <h2 id="studio-missing-version" className="text-heading">
            We couldn&apos;t find that version
          </h2>
          <div>
            <Link href={`/app/studio/${item.id}`} className="btn btn-secondary w-full min-[480px]:w-auto">
              Go to the latest version
            </Link>
          </div>
        </section>
      ) : previewing ? (
        <PreviewArea item={item} versions={versions} tz={tz} />
      ) : (
        <>
          <NextAction item={item} tz={tz} />
          <PublishCard item={item} tz={tz} />
          <PackageArea item={item} versions={versions} tz={tz} />
        </>
      )}
    </div>
  );
}
