import { EVIDENCE_KIND_LABELS } from "@/lib/schemas/labels";
import type { IdeaEvidence } from "@/lib/schemas/opportunities";

/** An idea's evidence: kind, summary and, when a signal backs it, its source (linked when it has a URL). Text only. */
export function EvidenceList({ evidence }: { evidence: IdeaEvidence }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
      {evidence.map((item, index) => (
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
  );
}
