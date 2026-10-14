import type { ReactNode } from "react";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import type { StudioPackage } from "@/lib/schemas/studio";
import { CopyButton } from "./copy-button";

// Plain-text versions for Copy: what a creator pastes into a notes app or a
// platform's composer.

const numbered = (lines: string[]) => lines.map((line, index) => `${index + 1}. ${line}`).join("\n");

export function packageText(pkg: StudioPackage) {
  const hashtags = pkg.hashtags.map((tag) => `#${tag}`).join(" ");
  return {
    titles: numbered(pkg.titles.map((title) => title.text)),
    hooks: numbered(pkg.hooks.map((hook) => hook.text)),
    script: pkg.script.beats
      .map((beat) => [beat.label, `Say: ${beat.say}`, beat.show ? `Show: ${beat.show}` : null].filter(Boolean).join("\n"))
      .join("\n\n"),
    shotList: numbered(pkg.shot_list.map((shot) => (shot.notes ? `${shot.shot} (${shot.notes})` : shot.shot))),
    caption: hashtags ? `${pkg.caption}\n\n${hashtags}` : pkg.caption,
    cta: pkg.cta,
    thumbnail: pkg.thumbnail
      ? [pkg.thumbnail.concept, pkg.thumbnail.overlay_text ? `Text on image: ${pkg.thumbnail.overlay_text}` : null]
          .filter(Boolean)
          .join("\n")
      : "",
    repurposing: pkg.repurposing
      .map((item) => `${PLATFORM_LABELS[item.platform]} · ${item.format}: ${item.adaptation}`)
      .join("\n"),
  };
}

function Section({
  id,
  title,
  copyLabel,
  copyText,
  children,
}: {
  id: string;
  title: string;
  copyLabel: string;
  copyText: string;
  children: ReactNode;
}) {
  const headingId = `package-${id}`;
  return (
    <section className="card stack-sm" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id={headingId} className="text-heading">
          {title}
        </h3>
        <CopyButton text={copyText} label={copyLabel} />
      </div>
      {children}
    </section>
  );
}

function Choices({ items }: { items: StudioPackage["titles"] }) {
  return (
    <ol className="stack-sm list-decimal pl-5">
      {items.map((item, index) => (
        <li key={index} className="break-words">
          <p className="font-bold">{item.text}</p>
          <p className="field-help">{item.why}</p>
        </li>
      ))}
    </ol>
  );
}

/** The package as a production sheet, in the order a creator uses it. Text only: React escapes everything. */
export function PackageSections({ pkg }: { pkg: StudioPackage }) {
  const text = packageText(pkg);
  return (
    <div className="stack-lg">
      <Section id="titles" title="Titles" copyLabel="titles" copyText={text.titles}>
        <Choices items={pkg.titles} />
      </Section>

      <Section id="hooks" title="Hooks" copyLabel="hooks" copyText={text.hooks}>
        <Choices items={pkg.hooks} />
      </Section>

      <Section id="script" title="Script" copyLabel="script" copyText={text.script}>
        <ol className="stack-md list-decimal pl-5">
          {pkg.script.beats.map((beat, index) => (
            <li key={index} className="stack-sm break-words">
              <p className="font-bold">{beat.label}</p>
              <p className="whitespace-pre-line">
                <span className="sr-only">Say: </span>
                {beat.say}
              </p>
              {beat.show ? (
                <p className="whitespace-pre-line text-muted-foreground">
                  <span className="font-semibold">Show:</span> {beat.show}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </Section>

      {pkg.shot_list.length ? (
        <Section id="shots" title="Shot list" copyLabel="shot list" copyText={text.shotList}>
          <ol className="stack-sm list-decimal pl-5">
            {pkg.shot_list.map((shot, index) => (
              <li key={index} className="break-words">
                {shot.shot}
                {shot.notes ? <span className="block field-help">{shot.notes}</span> : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section id="caption" title="Caption" copyLabel="caption" copyText={text.caption}>
        <p className="whitespace-pre-line break-words">{pkg.caption}</p>
        {pkg.hashtags.length ? (
          <ul className="flex flex-wrap gap-2" aria-label="Hashtags">
            {pkg.hashtags.map((tag) => (
              <li key={tag} className="rounded-pill border border-border px-3 py-1 text-sm break-all">
                #{tag}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section id="cta" title="Call to action" copyLabel="call to action" copyText={text.cta}>
        <p className="break-words">{pkg.cta}</p>
      </Section>

      {pkg.thumbnail ? (
        <Section id="thumbnail" title="Thumbnail" copyLabel="thumbnail concept" copyText={text.thumbnail}>
          <p className="break-words">{pkg.thumbnail.concept}</p>
          {pkg.thumbnail.overlay_text ? (
            <p className="break-words">
              <span className="font-semibold">Text on image:</span> {pkg.thumbnail.overlay_text}
            </p>
          ) : null}
        </Section>
      ) : null}

      {pkg.repurposing.length ? (
        <Section id="repurposing" title="Repurposing" copyLabel="repurposing ideas" copyText={text.repurposing}>
          <ul className="stack-sm">
            {pkg.repurposing.map((item, index) => (
              <li key={index} className="break-words">
                <p className="font-bold">
                  {PLATFORM_LABELS[item.platform]} · {item.format}
                </p>
                <p className="text-muted-foreground">{item.adaptation}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
