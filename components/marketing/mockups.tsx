import {
  baseline,
  contentPackage,
  learnedPatterns,
  pillars,
  todaysPlan,
  topOpportunity,
} from "@/lib/marketing/sample-data";

// Static product mockups rendered from sample data. Each one carries a
// visible "Sample" tag so it never reads as real creator metrics.

function SampleTag() {
  return (
    <span className="rounded-pill border border-border px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
      Sample
    </span>
  );
}

function MockupHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="eyebrow text-xs">{label}</p>
      <SampleTag />
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold">{label}</span>
        <span className="font-mono text-muted-foreground">{value}/100</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-pill bg-surface-muted">
        <div className="h-full rounded-pill bg-accent" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function TodaysPlanCard({ className = "" }: { className?: string }) {
  return (
    <div className={`card stack-sm p-5 md:p-5 ${className}`}>
      <MockupHeader label={`Today · ${todaysPlan.date}`} />
      <ul className="grid gap-2 text-sm">
        {todaysPlan.tasks.map((task) => (
          <li key={task.label} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border text-[0.625rem] font-bold ${
                task.done
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border"
              }`}
            >
              {task.done ? "✓" : ""}
            </span>
            <span className={task.done ? "text-muted-foreground line-through" : ""}>
              {task.label}
              <span className="sr-only">{task.done ? " (done)" : " (to do)"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OpportunityCard({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`card stack-sm p-5 md:p-6 ${className}`}>
      <MockupHeader label="Top opportunity" />
      <h3 className="text-lg leading-snug">{topOpportunity.topic}</h3>
      {!compact && (
        <dl className="grid gap-2 text-sm">
          {[
            ["Audience need", topOpportunity.audienceNeed],
            ["Angle", topOpportunity.angle],
            ["Hook", `“${topOpportunity.hook}”`],
            ["Format", topOpportunity.format],
          ].map(([term, detail]) => (
            <div key={term} className="grid gap-0.5 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
              <dt className="font-semibold text-muted-foreground">{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="grid gap-3 pt-1">
        {topOpportunity.signals.map((s) => (
          <Meter key={s.label} label={s.label} value={s.value} />
        ))}
      </div>
      {!compact && (
        <div className="stack-sm border-t border-border pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Evidence
          </p>
          <ul className="grid gap-1.5 text-sm">
            {topOpportunity.evidence.map((e) => (
              <li key={e} className="flex gap-2">
                <span aria-hidden="true" className="text-success">
                  ●
                </span>
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function PillarsCard({ className = "" }: { className?: string }) {
  return (
    <div className={`card stack-sm p-5 md:p-6 ${className}`}>
      <MockupHeader label="Content pillars" />
      <ul className="grid gap-3">
        {pillars.map((p) => (
          <li key={p.name} className="grid gap-1">
            <div className="flex justify-between text-sm">
              <span className="font-semibold">{p.name}</span>
              <span className="font-mono text-muted-foreground">{p.share}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-pill bg-surface-muted">
              <div className="h-full rounded-pill bg-primary" style={{ width: `${p.share}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ContentPackageCard({ className = "" }: { className?: string }) {
  return (
    <div className={`card stack-sm p-5 md:p-6 ${className}`}>
      <MockupHeader label="Content package" />
      <p className="text-sm font-bold">{contentPackage.title}</p>
      <div className="flex flex-wrap gap-1.5" aria-hidden="true">
        {contentPackage.tabs.map((tab, i) => (
          <span
            key={tab}
            className={`rounded-pill px-3 py-1 text-xs font-semibold ${
              i === 0 ? "bg-primary text-primary-foreground" : "bg-surface-muted text-muted-foreground"
            }`}
          >
            {tab}
          </span>
        ))}
      </div>
      <ol className="grid gap-2 text-sm">
        {contentPackage.hooks.map((hook, i) => (
          <li key={hook} className="flex gap-3 rounded-sm bg-surface-muted p-3">
            <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
            <span>“{hook}”</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function BaselineCard({ className = "" }: { className?: string }) {
  return (
    <div className={`card stack-sm p-5 md:p-6 ${className}`}>
      <MockupHeader label="Vs. your baseline" />
      <p className="text-sm font-bold">“{baseline.post}”</p>
      <dl className="grid grid-cols-3 gap-2">
        {baseline.metrics.map((m) => (
          <div key={m.label} className="rounded-sm bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">{m.label}</dt>
            <dd
              className={`font-mono text-lg font-bold ${m.delta >= 0 ? "text-success" : "text-danger"}`}
            >
              {m.delta >= 0 ? "+" : "−"}
              {Math.abs(m.delta)}%
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">{baseline.diagnosis}</p>
      <p className="rounded-sm border border-border p-3 text-sm">
        <span className="font-bold">Next experiment: </span>
        {baseline.nextExperiment}
      </p>
    </div>
  );
}

export function LearnedCard({ className = "" }: { className?: string }) {
  return (
    <div className={`card stack-md ${className}`}>
      <MockupHeader label="What CreateHive learned" />
      <ul className="grid gap-4">
        {learnedPatterns.map((p) => (
          <li key={p.pattern} className="grid gap-1 border-l-2 border-accent pl-4">
            <span className="font-semibold">{p.pattern}</span>
            <span className="text-sm text-muted-foreground">{p.basis}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
