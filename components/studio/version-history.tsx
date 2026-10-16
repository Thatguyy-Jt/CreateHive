import Link from "next/link";
import { formatDay, formatTime } from "@/lib/calendar/dates";
import type { AuthorSource } from "@/lib/schemas/enums";
import type { VersionSummary } from "@/lib/services/studio";

/** "Oct 15, 9:12 AM"-style label for a version time, or null without a timezone. */
export function versionTime(version: Pick<VersionSummary, "date" | "time">): string | null {
  if (!version.date || !version.time) return null;
  return `${formatDay(version.date)}, ${formatTime(version.time)}`;
}

export const SOURCE_LABELS: Record<AuthorSource, string> = { ai: "AI", user: "You" };

/** The latest versions, newest first, each with a Preview link (`?version=N`). Server-rendered; no AI. */
export function VersionHistory({
  itemId,
  versions,
  latestVersionNo,
  viewingVersionNo,
}: {
  itemId: string;
  versions: VersionSummary[];
  latestVersionNo: number | null;
  viewingVersionNo: number | null;
}) {
  return (
    <details className="stack-sm">
      <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">
        History<span className="font-normal text-muted-foreground"> ({versions.length === 1 ? "1 version" : `latest ${versions.length}`})</span>
      </summary>
      {versions.length <= 1 ? (
        <p className="field-help">Only one version so far.</p>
      ) : (
        <ol className="stack-sm" aria-label="Versions, newest first">
          {versions.map((version) => {
            const time = versionTime(version);
            const isLatest = version.version_no === latestVersionNo;
            const isViewing = version.version_no === viewingVersionNo;
            return (
              <li
                key={version.version_no}
                className="flex flex-col gap-1 border-b border-border pb-2 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between min-[480px]:gap-3"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">
                    Version {version.version_no} · {SOURCE_LABELS[version.source]}
                    {time ? <span className="font-normal text-muted-foreground"> · {time}</span> : null}
                  </p>
                  {version.note ? <p className="field-help break-words">{version.note}</p> : null}
                </div>
                {isViewing ? (
                  <span className="text-sm font-semibold">Viewing</span>
                ) : (
                  <Link
                    href={isLatest ? `/app/studio/${itemId}` : `/app/studio/${itemId}?version=${version.version_no}`}
                    className="link text-sm"
                    aria-label={isLatest ? "Back to the latest version" : `Preview version ${version.version_no}`}
                  >
                    {isLatest ? "Latest" : "Preview"}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </details>
  );
}
