import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import { EVIDENCE_KIND_LABELS } from "@/lib/schemas/opportunities";
import type { RankedIdea } from "@/lib/services/daily-recommendation";

/** Pillar chip and "Platform · Format", shared by ideas and calendar items. Text only. */
export function IdeaMeta({
  pillar,
  platform,
  format,
}: {
  pillar: string | null;
  platform: RankedIdea["platform"];
  format: string | null;
}) {
  const meta = [platform ? PLATFORM_LABELS[platform] : null, format].filter(Boolean).join(" · ");
  if (!pillar && !meta) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {pillar ? (
        <span className="max-w-full truncate rounded-pill border border-border px-3 py-1 font-semibold" title={pillar}>
          {pillar}
        </span>
      ) : null}
      {meta ? <span className="text-muted-foreground">{meta}</span> : null}
    </div>
  );
}

/** One idea on the dashboard: what it is, why it was picked, and its evidence. */
export function IdeaSummary({ idea }: { idea: RankedIdea }) {
  return (
    <div className="stack-sm">
      <IdeaMeta pillar={idea.pillar_name} platform={idea.platform} format={idea.format} />
      <p className="font-bold break-words">{idea.topic}</p>
      {idea.hook ? (
        <blockquote className="line-clamp-2 border-l-4 border-accent pl-4 font-accent text-lg italic break-words">
          {idea.hook}
        </blockquote>
      ) : null}
      {idea.reasons.length ? (
        <div className="stack-sm">
          <p className="text-sm font-semibold">Why this one</p>
          <ul className="field-help list-disc space-y-1 pl-5">
            {idea.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {idea.evidence.length ? (
        <details className="stack-sm">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Evidence</summary>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {idea.evidence.map((item, index) => (
              <li key={index} className="break-words">
                <span className="font-semibold text-foreground">{EVIDENCE_KIND_LABELS[item.kind]}:</span> {item.summary}
                {item.source ? (
                  <>
                    {" "}
                    (
                    {item.source_url ? (
                      <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="link">
                        {item.source}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      item.source
                    )}
                    )
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
