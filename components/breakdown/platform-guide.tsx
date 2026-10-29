import { Icon } from "@/components/app-shell/icons";
import {
  COUNT_FIELDS,
  fieldLabel,
  NOT_SHOWN,
  PLATFORM_GUIDES,
  ROUNDED,
  type ManualPlatform,
} from "@/lib/breakdown/platform-guides";
import { PLATFORM_LABELS } from "@/lib/schemas/labels";

function GuideBody({ platform }: { platform: ManualPlatform }) {
  const guide = PLATFORM_GUIDES[platform];
  return (
    <div className="stack-sm text-sm">
      <p>{guide.intro}</p>
      <ul className="stack-sm">
        {[...COUNT_FIELDS, "duration" as const].map((field) => (
          <li key={field} className="break-words">
            <span className="font-semibold">{fieldLabel(platform, field)}: </span>
            {guide.fields[field]}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{NOT_SHOWN}</p>
      <p className="text-muted-foreground">{ROUNDED}</p>
    </div>
  );
}

/**
 * "Where to find these numbers" for the detected platform. Open on wide
 * screens; folded on phones so the inputs stay near the top (each input
 * still carries its own hint).
 */
export function PlatformGuide({ platform }: { platform: ManualPlatform }) {
  const heading =
    platform === "other" ? "Where to find these numbers" : `Where to find these numbers on ${PLATFORM_LABELS[platform]}`;
  return (
    <div className="rounded-md border border-border bg-surface-muted p-4" aria-live="polite">
      <details className="md:hidden">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
          <Icon name="lightbulb" size={18} />
          How do I find these numbers?
        </summary>
        <div className="pt-2">
          <GuideBody platform={platform} />
        </div>
      </details>
      <div className="hidden md:block">
        <section className="stack-sm" aria-label={heading}>
          <h3 className="flex items-center gap-2 text-base font-bold">
            <Icon name="lightbulb" size={18} />
            {heading}
          </h3>
          <GuideBody platform={platform} />
        </section>
      </div>
    </div>
  );
}
