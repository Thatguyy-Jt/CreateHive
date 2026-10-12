# CreateHive Homepage

## Goal

Replace the placeholder `/` page with a premium, responsive marketing homepage for the product under its new name, **CreateHive**. The page explains the core loop (understand the creator → find opportunities → create → measure → learn) and shows what the product does through realistic product mockups built from simple sample data. Real photography comes from Unsplash.

It must be built entirely from the existing design system in `app/globals.css`. It must also stay honest. The app has no sign-up, auth or features yet, so no button may pretend otherwise (AGENTS.md §14, §25).

## Skills Read

None apply. The approved project skills are Clerk and Supabase, and this page uses neither.

## Existing Code Inspected

- `app/globals.css`: the full design system. It defines tokens (ink / signal / tints / neutrals plus semantic shadcn-style names with dark mode), a fluid display type scale, `.eyebrow`, `.lead` and `.accent-word`, containers (`container-page/narrow/wide`), `.section*` and `.section-tint-*` / `.section-dark`, buttons (`btn-primary/secondary/ghost/accent`, sizes, `btn-block`), `.link` and `.link-arrow`, `.card`, `.card-offset`, `.media-frame(-offset)`, `grid-auto-fit`, `split(-reverse)`, `stack-*`, `.site-header*`, `.announcement-bar` and `.skip-link`.
- `app/design-system/page.tsx`: the specimen page, which shows the intended usage of the header, split, grid and tint primitives.
- `app/page.tsx`: the placeholder with an "AI Creator Strategist" headline.
- `app/layout.tsx`: Manrope, Instrument Serif and Geist Mono through `next/font`. Metadata title is "AI Creator Strategist".
- `next.config.ts`: `cacheComponents: true`, the Tailwind turbopack loader rule, and no `images` config.
- `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md` (Next 16.4): external `next/image` sources must be allowed through `images.remotePatterns`. The default `qualities` is `[75]`.
- `tsconfig.json`: the `@/*` path alias points to the repo root.
- `prompts/global-design-system.md`: design principles (dark ink, mint signal accent, pastel tints, hard offset shadows, serif-italic accent word, chunky inverting buttons).
- No `components/` or `lib/` directories, no tests, no Playwright and no shadcn yet.

## Decisions / Assumptions

1. **Brand name.** "CreateHive" is used on the homepage and as the root default `<title>` / metadata. AGENTS.md still says "AI Creator Strategist" as the internal product description, and that file is left untouched.
2. **Inspiration, not copying.** The page follows patterns common to premium creator and content-optimization sites (a large hero with a floating product UI, a platform strip, a numbered workflow, alternating feature splits with UI mockups, a dark "insights" section, an FAQ and a strong closing CTA). No copy, logos or layouts are taken from a specific site.
3. **Product mockups are built in HTML/CSS, not screenshots.** Cards such as "Today's plan", "Opportunity with evidence", "Content package" and "Performance vs. your baseline" are rendered from a typed sample-data file. They are visibly labelled as an example (for example a small "Sample data" tag), so they never read as real user metrics.
4. **No fabricated social proof.** The page has no fake testimonials, invented user counts, ratings or "trusted by" brand logos (AGENTS.md §25: do not fabricate analytics). A "Built for" section shows creator *types* (for example aspiring YouTuber, UGC creator, personal-brand builder) with Unsplash portraits. These are framed as audiences, not endorsements.
5. **Honest CTAs.** Because sign-up does not exist yet:
   - Primary CTAs are labelled **"Early access — coming soon"**. They render as `aria-disabled` buttons with the existing disabled style plus a visible "Coming soon" note, and they do not link anywhere.
   - Secondary CTAs ("See how it works", "Explore features") are real in-page anchor links.
   - Header nav links are in-page anchors (`#how-it-works`, `#features`, `#creators`, `#faq`).
6. **Platform strip.** Platform names (YouTube, TikTok, Instagram, LinkedIn, X) appear as plain text under "Plan content for", with no brand logos, and the strip makes no integration claim.
7. **Images.** Unsplash photos come from `images.unsplash.com` through `next/image`, with `remotePatterns` restricted to that host. Every image URL is checked to return HTTP 200 during implementation, and any that fail are swapped. Each `<Image>` gets descriptive `alt`, explicit `sizes`, and `priority` on the hero image only. A short attribution line ("Photos: Unsplash") goes in the footer.
8. **Mobile nav without JavaScript.** A native `<details>`/`<summary>` disclosure shows the menu below `lg`, so the whole page stays a Server Component with no client JS.
9. **FAQ** uses native `<details>` as well.
10. **Minimal CSS additions.** I'll only add what the page needs and cannot express with existing tokens: hiding the `<details>` marker, an FAQ +/− indicator, and a subtle hero background pattern. These go in `globals.css` under a clearly commented "Marketing" section and reuse the existing tokens. The page introduces no new colours.

## Files Likely to Change

| File | Change |
|---|---|
| `app/page.tsx` | Compose the homepage from section components and set page metadata |
| `app/layout.tsx` | Default metadata becomes CreateHive (title template `%s · CreateHive`, description) |
| `next.config.ts` | Add `images.remotePatterns` for `https://images.unsplash.com/**` |
| `components/marketing/site-header.tsx` (new) | Logo, anchor nav, mobile `<details>` menu, disabled early-access CTA |
| `components/marketing/hero.tsx` (new) | Headline, lead, CTAs, hero photo with floating "Today's plan" and "Top opportunity" mockup cards |
| `components/marketing/platform-strip.tsx` (new) | "Plan content for" plus the platform names |
| `components/marketing/how-it-works.tsx` (new) | Numbered 01–05 core-loop steps |
| `components/marketing/feature-splits.tsx` (new) | 4 alternating splits: Strategy, Opportunities, Content Studio, Analytics & diagnosis, each with a mockup card and/or photo |
| `components/marketing/insight-band.tsx` (new) | Dark section on "Learns from your own baseline, not generic benchmarks" with a sample insight card |
| `components/marketing/creators.tsx` (new) | "Built for" creator-type cards with Unsplash portraits |
| `components/marketing/faq.tsx` (new) | 5–6 honest FAQ items, including "Is it available yet?" and "Does it post for me?" (answer: no publishing integrations yet) |
| `components/marketing/final-cta.tsx` (new) | Tinted closing section with the early-access (coming soon) CTA |
| `components/marketing/site-footer.tsx` (new) | Logo, anchor links, Unsplash credit, © year |
| `components/marketing/logo.tsx` (new) | Inline SVG hexagon mark plus the "CreateHive" wordmark |
| `lib/marketing/sample-data.ts` (new) | Typed sample data for the mockups, features, steps, creator types, FAQ and image URLs/alt text |
| `app/globals.css` | Small "Marketing" section (see decision 10) |

No new dependencies.

## Database Changes

None.

## Implementation Requirements

### Page structure (top to bottom)

1. **Skip link** and an **announcement bar**: "CreateHive is in early development — follow along as we build."
2. **Header**: the logo, the nav (How it works, Features, Creators, FAQ), a `btn-primary btn-sm` "Early access" button (disabled, with a "Soon" tag), and a `<details>` menu below `lg`.
3. **Hero** (`section`, a subtle tint background): the eyebrow "AI strategist for creators", then an `h1` in `text-display-xl` reading "Know what to post *next*", with the `.accent-word` on one word. A lead sentence follows. Then the CTA pair: the disabled early-access button and a `btn-secondary` "See how it works" link. On the right sits a hero photo in `media-frame media-frame-offset`. Two floating mockup cards overlap it on `md` and above (shadow-float). Below `md` they stack under the photo.
4. **Platform strip**: the platform names in muted text.
5. **How it works** (`#how-it-works`): five numbered cards in `grid-auto-fit`: Profile → Opportunities → Create → Measure → Learn.
6. **Features** (`#features`): four `split` blocks that alternate with `split-reverse`. Each has an eyebrow, an `h2` with an accent word, a lead, 3 bullet points and a mockup:
   - *Strategy*: a pillars card (3–4 pillars with a share bar).
   - *Opportunities*: an opportunity card with topic, audience need, angle, hook, format, an evidence list and fit signals (audience fit, evidence strength, content gap shown as labelled meters). There is **no virality score**.
   - *Content Studio*: a content-package card with tabs-as-labels (Hooks / Script / Shot list / Caption) and a sample hook list. It is static and non-interactive.
   - *Analytics & diagnosis*: a "vs. your baseline" card with 3 metrics shown as +/- percent against the creator's own median, a plain-language diagnosis and a "Next experiment" line.
   Sections alternate backgrounds (white / `section-tint-sky` / white / `section-tint-lilac`).
7. **Insight band** (`section-dark`): "It learns what works for *you*", with a sample "What CreateHive learned" card that shows 2–3 patterns, each with a confidence note (for example "based on 6 posts").
8. **Creators** (`#creators`): 4 cards in `grid-auto-fit`. Each has an Unsplash portrait (`aspect-[4/5]`, rounded), the creator type, and a one-line "CreateHive helps you…".
9. **FAQ** (`#faq`, `container-narrow`): `<details>` items.
10. **Final CTA** (`section-tint-butter`): a headline and the early-access button (coming soon), plus a "See how it works" anchor.
11. **Footer**: the logo, short descriptor, anchor links, "Photos from Unsplash" credit and © {current year}.

### Sample data

All mockup content lives in `lib/marketing/sample-data.ts` as typed `const` objects. Components import it, and no sample strings are hard-coded in the JSX besides headings and copy. Every mockup card shows a small "Sample" label.

### Responsiveness

- Mobile-first, checked at 375px, 768px and 1280px. There must be no horizontal scroll at any width.
- The hero stacks below `md`, with the text first and then the image and cards. Floating cards become static, stacked cards on mobile.
- Splits stack (the media follows the text on mobile). Grids reflow through `grid-auto-fit`.
- The header nav collapses into the `<details>` menu below `lg`. All tap targets are at least 44px.

### Accessibility

- One `h1`. Headings follow a logical order. Landmarks are `header`, `nav` (with labels), `main` and `footer`.
- All images have meaningful `alt` text, and decorative images use `alt=""`.
- Disabled CTAs use `aria-disabled="true"`, are not focusable traps, and their "Coming soon" text is readable by screen readers.
- Contrast relies on the existing AA-checked tokens. Signal mint is never used as text on light backgrounds.
- Light and dark mode both work. Tinted and dark sections already pin their tokens.

## AI Behavior

None. The page is static marketing and makes no AI calls.

## Security Requirements

- There is no user input, auth, data access or secrets.
- `remotePatterns` is limited to `https://images.unsplash.com/**`, so only that host is optimised.
- No third-party scripts.

## Acceptance Criteria

- `/` renders the CreateHive homepage with every section listed above, and the browser title shows CreateHive.
- Every mockup is driven by `lib/marketing/sample-data.ts` and labelled as sample.
- No fake testimonials, user counts or ratings, and no virality score. No button links to a nonexistent route, and the early-access CTAs are visibly "coming soon".
- All Unsplash images load (HTTP 200) through `next/image`.
- There is no horizontal scroll at 375px, 768px or 1280px. The layout matches the responsiveness rules above.
- The page is a Server Component tree and adds no client JS of its own.
- `/design-system` still renders unchanged.
- `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Visual verification: run the production server, capture headless Chrome/Edge screenshots of `/` at 375, 768 and 1280px wide (full page), and review them. Check each Unsplash URL for a 200 status.

## Manual Test Procedure

1. `pnpm dev`, then open `http://localhost:3000/`.
2. Confirm the tab title reads "CreateHive", and the announcement bar and header are visible. Scroll down and check that the header stays sticky.
3. Click each nav link and confirm it scrolls to the right section.
4. Hover and click "Early access". It should do nothing and show "Coming soon". Press Tab through the page and confirm focus rings are visible on the real links.
5. Confirm the photos load and that each mockup card shows a "Sample" label.
6. Use DevTools responsive mode at 375px: the hero and splits stack, the menu opens through the ☰ disclosure, and there is no sideways scroll. Repeat at 768px and 1280px.
7. Open each FAQ item.
8. Switch the OS to dark mode and confirm the text stays readable and the tinted sections stay light.
9. Open `/design-system` and confirm it is unchanged.

### UI notes

- **Visual interpretation:** confident, editorial and premium. The page uses a lot of whitespace, large display type with one serif-italic accent word per headline, dark-ink buttons that invert to mint, pastel tinted bands, and hard offset shadows on hero media and featured cards. Product mockups float over warm lifestyle photography of creators at work.
- **Layout:** `container-page` throughout, with `container-narrow` for the FAQ. Section rhythm comes from `.section` / `.section-lg` for the hero.
- **Typography:** `text-display-xl` for the hero, `h2` (display-md) for section headings, `.eyebrow` above each heading and `.lead` for intros. Mockup cards use `text-sm`/`text-xs` with `font-mono` for numbers.
- **Component behavior:** the existing button and link transitions only. `<details>` for the menu and FAQ. No carousels or autoplay.
- **Loading, empty and error states:** not applicable to a static page. Images get a `surface-muted` background through `media-frame` while they load.
