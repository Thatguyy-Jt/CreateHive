import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { StatTile } from "@/components/charts/stat-tile";
import { CopyButton } from "@/components/studio/copy-button";
import { formatCount, formatDuration, formatPercent } from "@/lib/analytics/format";
import { FACT_SOURCE_LABELS, followerRatioText } from "@/lib/breakdown/facts";
import { formatDay } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { CONFIDENCE_LABELS } from "@/lib/schemas/diagnosis";
import { ELEMENT_LABELS, type StoredBreakdown, type StoredFacts } from "@/lib/schemas/breakdown";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import { getBreakdown, type BreakdownDetail } from "@/lib/services/video-breakdown";
import { createUserClient } from "@/lib/supabase/server";
import { BreakdownLoadError } from "./breakdown-content";
import { DeleteBreakdownControl, RerunControl, SaveIdeaControl } from "./item-controls";

const day = (instant: string | null) => (instant ? formatDay(instant.slice(0, 10)) : null);

function FactsCard({ detail }: { detail: BreakdownDetail }) {
  const { facts } = detail;
  const name = detail.title ?? `${PLATFORM_LABELS[detail.platform]} video`;
  const tiles: { label: string; value: string }[] = facts
    ? [
        facts.views !== null ? { label: "Views", value: formatCount(facts.views, true) } : null,
        facts.likes !== null ? { label: "Likes", value: formatCount(facts.likes, true) } : null,
        facts.comments !== null ? { label: "Comments", value: formatCount(facts.comments, true) } : null,
        facts.shares !== null ? { label: "Shares", value: formatCount(facts.shares, true) } : null,
        facts.saves !== null ? { label: "Saves", value: formatCount(facts.saves, true) } : null,
        facts.duration_seconds !== null ? { label: "Length", value: formatDuration(facts.duration_seconds) } : null,
        facts.age_days !== null ? { label: "Age", value: facts.age_days === 1 ? "1 day" : `${facts.age_days} days` } : null,
      ].filter((t): t is { label: string; value: string } => t !== null)
    : [];

  return (
    <section className="card card-offset stack-md" aria-labelledby="breakdown-title">
      <div className="stack-sm">
        <p className="eyebrow">Reference video · {PLATFORM_LABELS[detail.platform]}</p>
        <h2 id="breakdown-title" className="text-heading break-words">
          {name}
        </h2>
        <p className="text-sm text-muted-foreground break-words">
          {[detail.author, facts?.published_at ? `Posted ${day(facts.published_at)}` : null, `Broken down ${day(detail.created_at)}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="text-sm">
          <a href={detail.source_url} target="_blank" rel="noopener noreferrer nofollow" className="link font-semibold break-all">
            Open the original video
          </a>
        </p>
      </div>

      {facts ? (
        <>
          {tiles.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {tiles.map((tile) => (
                <StatTile key={tile.label} label={tile.label} value={tile.value} />
              ))}
            </div>
          ) : null}
          <Ratios facts={facts} />
          <p className="field-help">
            {FACT_SOURCE_LABELS[facts.source]}
            {facts.source === "youtube_api" && detail.fetchedAt ? ` on ${day(detail.fetchedAt)}` : ""}
            {facts.rounded ? " · some numbers are rounded as the platform shows them" : ""}
          </p>
        </>
      ) : detail.expired ? (
        <p className="field-help">
          YouTube data from {day(detail.fetchedAt) ?? "this breakdown"} is no longer stored (we keep it for 30 days). Your breakdown
          below is kept.
        </p>
      ) : (
        <p className="field-help">No numbers were stored for this breakdown.</p>
      )}
    </section>
  );
}

function Ratios({ facts }: { facts: StoredFacts }) {
  const rows = [
    facts.followers !== null ? ["Poster's followers", formatCount(facts.followers)] : null,
    facts.views_per_day !== null ? ["Views per day", formatCount(facts.views_per_day)] : null,
    facts.engagement_rate !== null ? ["Engagement rate", formatPercent(facts.engagement_rate)] : null,
    facts.views_to_followers !== null ? ["Views vs followers", followerRatioText(facts.views_to_followers)] : null,
  ].filter((row): row is string[] => row !== null);
  if (!rows.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm min-[480px]:grid-cols-[auto_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-semibold break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function WhyCard({ breakdown }: { breakdown: StoredBreakdown }) {
  return (
    <section className="card stack-md" aria-labelledby="breakdown-why">
      <div className="stack-sm">
        <h2 id="breakdown-why" className="text-heading">
          Why it likely worked
        </h2>
        <p className="break-words">{breakdown.summary}</p>
      </div>
      <ul className="stack-sm">
        {breakdown.why_it_worked.map((item, index) => (
          <li key={index} className="grid gap-1 border-b border-border pb-3 last:border-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="rounded-pill border border-border px-3 py-0.5 text-sm font-semibold">{ELEMENT_LABELS[item.element]}</span>
              <span className="text-sm text-muted-foreground">{CONFIDENCE_LABELS[item.confidence]}</span>
            </div>
            <p className="break-words">{item.observation}</p>
            <p className="field-help break-words">Based on: {item.evidence}</p>
          </li>
        ))}
      </ul>
      {breakdown.confidence_capped ? (
        <p className="field-help">Confidence about the hook and structure is limited because there was no transcript or caption to read.</p>
      ) : null}
      <p className="field-help">AI reading of one video, not a prediction. One video is never proof.</p>
    </section>
  );
}

function AudienceCard({ reaction }: { reaction: NonNullable<StoredBreakdown["audience_reaction"]> }) {
  return (
    <section className="card stack-sm" aria-labelledby="breakdown-audience">
      <h2 id="breakdown-audience" className="text-heading">
        What the audience reacted to
      </h2>
      <p className="break-words">{reaction.summary}</p>
      {reaction.themes.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Themes">
          {reaction.themes.map((theme, index) => (
            <li key={index} className="rounded-pill border border-border px-3 py-0.5 text-sm break-words">
              {theme}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function YourVersionCard({ detail, breakdown }: { detail: BreakdownDetail; breakdown: StoredBreakdown }) {
  const version = breakdown.your_version;
  return (
    <section className="card stack-md rounded-md border-2 border-foreground" aria-labelledby="breakdown-yours">
      <div className="stack-sm">
        <p className="eyebrow">Your version</p>
        <h2 id="breakdown-yours" className="text-heading break-words">
          {version.topic}
        </h2>
        <p className="break-words">{version.angle}</p>
        <div className="flex flex-wrap gap-2 text-sm">
          {[PLATFORM_LABELS[version.platform], version.format, version.pillar_name].map((chip) => (
            <span key={chip} className="rounded-pill border border-border px-3 py-0.5 font-semibold break-words">
              {chip}
            </span>
          ))}
        </div>
      </div>

      <div className="stack-sm">
        <h3 className="text-base font-bold">Hooks to try</h3>
        <ol className="stack-sm">
          {version.hooks.map((hook, index) => (
            <li
              key={index}
              className="flex flex-col gap-2 border-b border-border pb-3 last:border-0 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between"
            >
              <p className="break-words">
                <span className="font-semibold">{index + 1}. </span>
                {hook}
              </p>
              <CopyButton text={hook} label={`hook ${index + 1}`} />
            </li>
          ))}
        </ol>
      </div>

      <div className="stack-sm">
        <h3 className="text-base font-bold">Outline</h3>
        <ol className="list-decimal stack-sm pl-5">
          {version.outline.map((beat, index) => (
            <li key={index} className="break-words">
              {beat}
            </li>
          ))}
        </ol>
      </div>

      <dl className="stack-sm text-sm">
        <div>
          <dt className="font-semibold">Title</dt>
          <dd className="break-words">{version.title}</dd>
        </div>
        <div>
          <dt className="font-semibold">Call to action</dt>
          <dd className="break-words">{version.cta}</dd>
        </div>
        <div>
          <dt className="font-semibold">Why this fits you</dt>
          <dd className="break-words">{version.why_it_fits}</dd>
        </div>
      </dl>

      <SaveIdeaControl breakdownId={detail.id} savedIdeaId={detail.savedIdeaId} />
    </section>
  );
}

function ListCard({ id, title, items }: { id: string; title: string; items: string[] }) {
  return (
    <section className="card stack-sm" aria-labelledby={id}>
      <h2 id={id} className="text-heading">
        {title}
      </h2>
      <ul className="list-disc stack-sm pl-5">
        {items.map((item, index) => (
          <li key={index} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One breakdown: facts, why it worked, audience, the creator's version and what not to copy. Never calls AI. */
export async function BreakdownView({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { userId } = await auth.protect();
  const { id } = await params;

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "video_breakdown_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <BreakdownLoadError />;
  }
  const loaded = await getBreakdown(client, userId, id);
  if (!loaded.ok) return <BreakdownLoadError />;
  const detail = loaded.breakdown;
  if (!detail) notFound();
  const { breakdown } = detail;

  return (
    <div className="stack-md">
      <FactsCard detail={detail} />
      {breakdown ? (
        <>
          <WhyCard breakdown={breakdown} />
          {breakdown.audience_reaction ? <AudienceCard reaction={breakdown.audience_reaction} /> : null}
          <YourVersionCard detail={detail} breakdown={breakdown} />
          <ListCard id="breakdown-dont-copy" title="Don't copy" items={breakdown.what_not_to_copy} />
          {breakdown.caveats.length ? <ListCard id="breakdown-caveats" title="Keep in mind" items={breakdown.caveats} /> : null}
        </>
      ) : (
        <p role="alert" className="alert font-semibold">
          This breakdown couldn&apos;t be shown. Break it down again to continue.
        </p>
      )}
      <section className="stack-md border-t border-border pt-6" aria-label="Breakdown actions">
        <RerunControl breakdownId={detail.id} manual={detail.platform !== "youtube"} />
        <DeleteBreakdownControl breakdownId={detail.id} />
      </section>
    </div>
  );
}
