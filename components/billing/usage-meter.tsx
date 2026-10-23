import type { FeatureUsage } from "@/lib/services/ai-usage";

// Full class strings (not interpolated) so Tailwind can see them.
const BAR_BASE =
  "h-2.5 w-full appearance-none overflow-hidden rounded-pill border border-border bg-surface-muted [&::-webkit-progress-bar]:bg-surface-muted";
const BAR_NORMAL = `${BAR_BASE} [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary`;
const BAR_AT_CAP = `${BAR_BASE} [&::-webkit-progress-value]:bg-danger [&::-moz-progress-bar]:bg-danger`;

/** "3 of 5 content packages used this month" with a progress bar. */
export function UsageMeter({ feature, id }: { feature: FeatureUsage; id: string }) {
  const atCap = feature.used >= feature.limit;
  return (
    <div className="stack-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p id={id} className="text-sm font-semibold">
          {feature.label}
        </p>
        <p className="text-sm tabular-nums text-muted-foreground" aria-hidden="true">
          {feature.used} / {feature.limit}
        </p>
      </div>
      <progress
        className={atCap ? BAR_AT_CAP : BAR_NORMAL}
        value={Math.min(feature.used, feature.limit)}
        max={feature.limit}
        aria-labelledby={id}
        aria-valuetext={`${feature.used} of ${feature.limit} ${feature.plural} used this month`}
      />
      {atCap ? <p className="field-help">All used. They free up as uses pass 30 days.</p> : null}
    </div>
  );
}
