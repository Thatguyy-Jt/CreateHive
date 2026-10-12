import Link from "next/link";
import type { ReactNode } from "react";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import type { StoredStrategy } from "@/lib/services/creator-strategy";
import { GenerateStrategyControl } from "./generate-strategy-control";

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="stack-sm" aria-labelledby={id}>
      <h2 id={id} className="text-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function Labelled({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="stack-sm">
      <h3 className="text-base font-semibold">{label}</h3>
      <Bullets items={items} />
    </div>
  );
}

/** The stored strategy as a brief the creator can act on. Text only: React escapes everything. */
export function StrategyView({ strategy }: { strategy: StoredStrategy }) {
  const { audience_profile: audience, voice_profile: voice } = strategy;

  return (
    <div className="stack-lg">
      <section className="card card-offset max-w-3xl stack-sm" aria-labelledby="strategy-positioning">
        <h2 id="strategy-positioning" className="eyebrow">
          Your positioning
        </h2>
        <p className="text-heading font-semibold">{strategy.positioning}</p>
      </section>

      <div className="max-w-3xl stack-lg">
        <Section id="strategy-audience" title="Your audience">
          <p>{audience.summary}</p>
          <div className="grid gap-6 sm:grid-cols-2">
            <Labelled label="What they struggle with" items={audience.pain_points} />
            <Labelled label="What they want" items={audience.desires} />
          </div>
          <Labelled label="Where to find them" items={audience.where_they_are} />
        </Section>
      </div>

      <Section id="strategy-pillars" title="Content pillars">
        <p className="text-muted-foreground max-w-3xl">
          The themes you&apos;ll come back to. Most of your posts should fit one of these.
        </p>
        <ol className="grid-auto-fit">
          {strategy.pillars.map((pillar, index) => (
            <li key={pillar.id} className="card stack-sm">
              <p className="eyebrow">Pillar {index + 1}</p>
              <h3 className="text-lg font-bold">{pillar.name}</h3>
              {pillar.description ? <p className="text-muted-foreground">{pillar.description}</p> : null}
            </li>
          ))}
        </ol>
      </Section>

      <div className="max-w-3xl stack-lg">
        <Section id="strategy-formats" title="Formats and cadence">
          <ul className="stack-md">
            {strategy.format_strategy.map((entry) => (
              <li key={entry.platform} className="card stack-sm">
                <h3 className="text-lg font-bold">{PLATFORM_LABELS[entry.platform]}</h3>
                <p>
                  <span className="font-semibold">Formats:</span> {entry.formats.join(", ")}
                </p>
                <p>
                  <span className="font-semibold">Cadence:</span> {entry.cadence}
                </p>
                <p className="text-muted-foreground">{entry.rationale}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="strategy-voice" title="Your voice">
          <p>{voice.summary}</p>
          <ul className="flex flex-wrap gap-2" aria-label="Voice traits">
            {voice.traits.map((trait, index) => (
              <li key={`${index}-${trait}`}className="rounded-pill border border-border px-3 py-1 text-sm font-semibold">
                {trait}
              </li>
            ))}
          </ul>
          <div className="grid gap-6 sm:grid-cols-2">
            <Labelled label="Sounds like" items={voice.sounds_like} />
            <Labelled label="Avoid" items={voice.avoid} />
          </div>
        </Section>

        <Section id="strategy-objectives" title="Your next 90 days">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="card stack-sm">
              <dt className="eyebrow">Growth</dt>
              <dd>{strategy.growth_objective}</dd>
            </div>
            <div className="card stack-sm">
              <dt className="eyebrow">Monetization</dt>
              <dd>{strategy.monetization_objective}</dd>
            </div>
          </dl>
        </Section>

        <Section id="strategy-plan" title="Your first 30 days">
          <ol className="stack-md">
            {strategy.thirty_day_plan.map((week) => (
              <li key={week.week} className="card stack-sm">
                <p className="eyebrow">Week {week.week}</p>
                <h3 className="text-lg font-bold">{week.theme}</h3>
                <p className="text-muted-foreground">{week.focus}</p>
                <Bullets items={week.actions} />
              </li>
            ))}
          </ol>
        </Section>

        {strategy.notes ? (
          <Section id="strategy-notes" title="A note on this strategy">
            <p>{strategy.notes}</p>
          </Section>
        ) : null}

        <section className="stack-md border-t border-border pt-6" aria-labelledby="strategy-actions">
          <h2 id="strategy-actions" className="sr-only">
            Strategy actions
          </h2>
          <p className="field-help">
            Version {strategy.version} · generated {DATE.format(new Date(strategy.updated_at))} · a starting hypothesis.
            We&apos;ll refine it as your content performs.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <GenerateStrategyControl key={strategy.version} mode="regenerate" />
            <div>
              <Link href="/onboarding" className="btn btn-ghost w-full sm:w-auto">
                Edit profile
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
