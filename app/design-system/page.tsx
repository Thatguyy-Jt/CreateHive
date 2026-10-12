import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design System · AI Creator Strategist",
  robots: { index: false, follow: false },
};

const ramps = [
  {
    name: "ink",
    steps: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"],
  },
  {
    name: "signal",
    steps: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"],
  },
  { name: "neutral", steps: ["50", "200", "400", "600", "900"] },
  { name: "tint", steps: ["sky", "blush", "butter", "lilac"] },
];

const semantic = [
  "background",
  "foreground",
  "surface",
  "surface-muted",
  "primary",
  "primary-foreground",
  "accent",
  "accent-foreground",
  "muted",
  "muted-foreground",
  "border",
  "ring",
  "success",
  "warning",
  "danger",
];

const typeScale = [
  { className: "text-display-xl", label: "display-xl" },
  { className: "text-display-lg", label: "display-lg" },
  { className: "text-display-md", label: "display-md" },
  { className: "text-heading", label: "heading" },
  { className: "text-lead", label: "lead" },
  { className: "text-base", label: "base (16px)" },
  { className: "text-sm", label: "sm" },
];

const spacing = ["section-sm", "section-md", "section-lg"];

const buttonVariants = ["btn-primary", "btn-secondary", "btn-ghost", "btn-accent"];
const buttonSizes = [
  { className: "btn-sm", label: "Small" },
  { className: "", label: "Default" },
  { className: "btn-lg", label: "Large" },
];

const sectionTints = [
  "section-tint-sky",
  "section-tint-blush",
  "section-tint-butter",
  "section-tint-lilac",
  "section-dark",
];

function Swatch({ cssVar, label }: { cssVar: string; label: string }) {
  return (
    <div className="stack-sm">
      <div
        className="h-16 rounded-sm border border-border"
        style={{ backgroundColor: `var(${cssVar})` }}
      />
      <code className="text-xs text-muted-foreground">{label}</code>
    </div>
  );
}

function SpecimenSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="section-sm border-t border-border">
      <div className="container-page stack-md">
        <div className="stack-sm">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {children}
      </div>
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="announcement-bar">Announcement bar · design system specimen</div>
      <header className="site-header">
        <div className="container-page site-header-inner">
          <span className="font-bold">Logo</span>
          <nav className="site-header-nav text-sm font-semibold" aria-label="Specimen sections">
            <a className="link" href="#colour">Colour</a>
            <a className="link" href="#type">Type</a>
            <a className="link" href="#buttons">Buttons</a>
            <a className="link" href="#layout">Layout</a>
          </nav>
          <div className="site-header-actions">
            <span className="site-header-menu-button text-sm text-muted-foreground">
              Menu (below lg)
            </span>
            <a className="btn btn-primary btn-sm" href="#buttons">
              Primary CTA
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="section">
          <div className="container-page stack-md max-w-4xl">
            <p className="eyebrow">Development specimen</p>
            <h1 className="text-display-xl">
              The design <span className="accent-word">system</span>
            </h1>
            <p className="lead max-w-2xl">
              Every token and primitive defined in app/globals.css, rendered in one place for
              visual verification in light and dark mode.
            </p>
          </div>
        </section>

        <SpecimenSection id="colour" eyebrow="Tokens" title="Colour">
          {ramps.map((ramp) => (
            <div key={ramp.name} className="stack-sm">
              <h3 className="text-base">{ramp.name}</h3>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-11">
                {ramp.steps.map((step) => (
                  <Swatch
                    key={step}
                    cssVar={`--color-${ramp.name}-${step}`}
                    label={`${ramp.name}-${step}`}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="stack-sm">
            <h3 className="text-base">semantic (flip in dark mode)</h3>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
              {semantic.map((token) => (
                <Swatch key={token} cssVar={`--${token}`} label={token} />
              ))}
            </div>
          </div>
        </SpecimenSection>

        <SpecimenSection id="type" eyebrow="Tokens" title="Typography">
          <div className="stack-md">
            {typeScale.map((t) => (
              <div key={t.label} className="grid gap-2 md:grid-cols-[10rem_1fr] md:items-baseline">
                <code className="text-xs text-muted-foreground">{t.label}</code>
                <p className={`${t.className} font-bold`}>Plan the next post with evidence</p>
              </div>
            ))}
          </div>
          <div className="card stack-sm">
            <p className="eyebrow">Eyebrow label</p>
            <h3>
              Heading with an <span className="accent-word">accent</span> word
            </h3>
            <p className="lead">Lead paragraph for introductions and section summaries.</p>
            <p>
              Body copy at 16px with 1.6 line-height. Inline <a className="link" href="#type">text links</a>{" "}
              thicken their underline on hover, and <code className="text-sm">mono</code> uses
              Geist Mono.
            </p>
          </div>
        </SpecimenSection>

        <SpecimenSection id="spacing" eyebrow="Tokens" title="Spacing, radii and shadows">
          <div className="stack-sm">
            {spacing.map((s) => (
              <div key={s} className="flex items-center gap-4">
                <code className="w-28 shrink-0 text-xs text-muted-foreground">{s}</code>
                <div
                  className="h-4 rounded-pill bg-accent"
                  style={{ width: `var(--spacing-${s})` }}
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {["rounded-sm", "rounded-md", "rounded-lg", "rounded-pill"].map((r) => (
              <div key={r} className="stack-sm">
                <div className={`h-20 border border-border bg-surface-muted ${r}`} />
                <code className="text-xs text-muted-foreground">{r}</code>
              </div>
            ))}
          </div>
          <div className="grid gap-8 sm:grid-cols-2">
            <div className="card card-offset">
              <code className="text-xs text-muted-foreground">card card-offset</code>
            </div>
            <div className="card shadow-float">
              <code className="text-xs text-muted-foreground">card shadow-float</code>
            </div>
          </div>
        </SpecimenSection>

        <SpecimenSection id="buttons" eyebrow="Primitives" title="Buttons and links">
          {buttonVariants.map((variant) => (
            <div key={variant} className="stack-sm">
              <code className="text-xs text-muted-foreground">{variant}</code>
              <div className="flex flex-wrap items-center gap-3">
                {buttonSizes.map((size) => (
                  <button
                    key={size.label}
                    type="button"
                    className={`btn ${variant} ${size.className}`}
                  >
                    {size.label}
                  </button>
                ))}
                <button type="button" className={`btn ${variant}`} disabled>
                  Disabled
                </button>
              </div>
            </div>
          ))}
          <div className="stack-sm">
            <code className="text-xs text-muted-foreground">btn-block (full width below md)</code>
            <button type="button" className="btn btn-primary btn-block">
              Block button
            </button>
          </div>
          <div className="flex flex-wrap gap-8">
            <a className="link" href="#buttons">
              Inline link
            </a>
            <a className="link-arrow" href="#layout">
              Arrow link
            </a>
          </div>
        </SpecimenSection>

        <SpecimenSection id="layout" eyebrow="Primitives" title="Layout">
          <div className="stack-sm">
            <code className="text-xs text-muted-foreground">split</code>
            <div className="split">
              <div
                className="media-frame media-frame-offset aspect-[4/3]"
                role="img"
                aria-label="Screenshot placeholder"
              />
              <div className="stack-sm">
                <p className="eyebrow">Eyebrow</p>
                <h3>Media and text, side by side</h3>
                <p className="text-muted-foreground">
                  Stacks into one column below 768px.
                </p>
                <a className="link-arrow" href="#layout">
                  Text CTA
                </a>
              </div>
            </div>
          </div>
          <div className="stack-sm">
            <code className="text-xs text-muted-foreground">split split-reverse</code>
            <div className="split split-reverse">
              <div
                className="media-frame aspect-[4/3]"
                role="img"
                aria-label="Screenshot placeholder"
              />
              <div className="stack-sm">
                <h3>Reversed from md upward</h3>
                <p className="text-muted-foreground">
                  On mobile the media still comes first.
                </p>
              </div>
            </div>
          </div>
          <div className="stack-sm">
            <code className="text-xs text-muted-foreground">grid-auto-fit</code>
            <div className="grid-auto-fit">
              {["01", "02", "03", "04"].map((n) => (
                <div key={n} className="card stack-sm">
                  <span className="text-display-md font-bold text-muted-foreground">{n}</span>
                  <h4>Card title</h4>
                  <p className="text-sm text-muted-foreground">Reflows without breakpoints.</p>
                </div>
              ))}
            </div>
          </div>
        </SpecimenSection>

        {sectionTints.map((tint) => (
          <section key={tint} className={`${tint} section-sm`}>
            <div className="container-page split">
              <div className="stack-sm">
                <code className="text-xs">{tint}</code>
                <h3>
                  Section <span className="accent-word">tint</span>
                </h3>
                <p className="text-muted-foreground">Tokens are pinned locally so contrast holds.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn btn-primary">
                  Primary
                </button>
                <button type="button" className="btn btn-secondary">
                  Secondary
                </button>
                <div className="card card-offset w-full">
                  <code className="text-xs text-muted-foreground">card card-offset</code>
                </div>
              </div>
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
