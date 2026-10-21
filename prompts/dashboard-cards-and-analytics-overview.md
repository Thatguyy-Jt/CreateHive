# Dashboard Cards Relayout + Analytics Overview

## Goal

Two owner requests, both presentation-only (no new tables, no AI, no new external data):

1. **Dashboard: relayout the Positioning / Performance / What AI learned cards.** On the 3-up grid, the positioning statement is rendered as a 21px bold `h2` in a one-third-width column. A long positioning (often 30+ words) becomes a tall, ragged tower of bold text that "looks jumbled". The Performance card nests a bordered tile inside the card and draws a sparkline even with only 2 points, which shows up as a stray diagonal line. The three cards also end up with very different heights.
2. **Analytics: adopt the layout of the reference "Reports › Overview" screen** the owner shared (a support-chat analytics dashboard, studied as a virtual reference, not copied):
   - a row of KPI tabs, each with a value and a small delta, where the selected tab drives one large column chart below
   - a row of three supporting panels under the chart: a ranked list, a distribution chart and a part-to-whole donut

Everything stays grounded in the creator's **real logged results**, compared against their **own usual** (AGENTS.md §8 Analytics, §25 "do not fabricate analytics").

## Skills Read

- `dataviz`:
  - Form choice: KPI row for headline numbers, a column chart for per-post magnitude, a donut only for part-to-whole with ≤ 6 segments, a meter for a single ratio against a limit.
  - Mark specs: 4px rounded data ends, a 2px gap between donut segments, a reference line for "your usual".
  - A hover/focus readout on every mark. A legend whenever there are ≥ 2 series, so identity is never shown by colour alone. A table view.
  - Anti-patterns avoided: dual axes, a 2-point "trend", a one-bar chart (falls back to a stat tile).
  - **Validator run** (`scripts/validate_palette.js --mode light`):
    - Above / around / below as `#1f7a3d` / `#8a9393` / `#c2410c` passes lightness, CVD separation (worst ΔE 14.3), the normal-vision floor (18.7) and ≥ 3:1 contrast. The only flag is the chroma floor on the grey, which is the intended neutral midpoint of a diverging scale.
    - The old `#a4adad` grey failed 3:1 (2.23), so `--chart-muted` moves to `#8a9393`.
- `emil-design-eng`: tab switching is instant (no animated chart morph; it's a high-frequency control), press feedback on tabs, hover only on fine pointers.

## Reference Analysis → What We Adopt

| Reference element | What it does | Our version (real data only) |
|---|---|---|
| Sub-nav "Reports" list (Overview, Tickets…) | Report sections | **Not adopted.** We have one analytics page, and the sidebar already does this job. |
| "Last 7 days" dropdown | Time range | **Platform switcher** instead. Baselines are per platform, and results are entered per post, not per day, so a date range would mislead. Shown only when the creator has posts on ≥ 2 platforms. |
| "Download" button | Export | **Not adopted** (not built; AGENTS.md §14 forbids fake buttons). |
| **KPI tabs**: label, big value, small delta; the active tab has a top accent bar and joins the chart panel | Pick the metric for the chart | Four tabs: **Views · Engagement rate · Follower change · Avg % viewed**. Value = the creator's **usual** (median of settled posts on that platform). Delta = **latest settled post vs usual** (e.g. "▲ 32% latest"). Active tab: white, 3px ink top bar, bottom edge merges into the chart panel. Inactive tabs: fog fill. |
| **Grouped column chart** by day (served/missed) | Volume over time | **Column chart per post** (oldest → newest, last 20) for the selected metric. Settled posts in ink, early (first-week) posts in grey, a dashed "your usual" line, a hover/focus readout, columns link to the post, and "Show as table". It's one series with a status split, not two groups: we have no second measure that shares a scale. |
| **Top performance agents** (ranked, avatar, rating %) | Who's best | **Top posts**: the 5 best settled posts by views. Rank number, title (link), format · date, views, and "+48% vs usual". |
| **First reply time** (histogram with an average badge) | Distribution | **Views by format**: the median views per format (top 5 formats by post count), as horizontal bars with the post count. Each badge shows "n posts". A format with 1 post is labelled "1 post, early signal". |
| **Satisfaction rating** donut (Good/Bad) | Part-to-whole | **How your posts compare**: a donut of settled, compared posts **Above / Around / Below** your usual (views), with a legend showing counts and %. The total sits in the centre. |

**Visual system:** the monochrome signage system from `prompts/app-ui-monochrome-signage.md` stays. Bars are ink/grey, not the reference's green/yellow, because green is rationed to actions. *(If the owner wants green bars, only `--chart-accent` changes.)*

## Existing Code Inspected

- **Dashboard**
  - `app/app/page.tsx`: Today (full width), then a `md:2 / lg:3` grid of `DashboardStrategyCard`, `PerformanceCard` and `LearnedCard`, each in its own Suspense.
  - `components/strategy/dashboard-strategy-card.tsx`: states for finish setup, build strategy, positioning (`h2.text-heading` = positioning text) with this week's focus, and unavailable.
  - `components/dashboard/performance-card.tsx`: states for error, no posts, and latest settled (a nested `stat-tile`, 4xl views, a pill, "vs your usual"), plus a sparkline (≥ 2 points) and the needs-results action.
  - `components/dashboard/learned-card.tsx`: states for error, top 2 insights, "x of 5 settled" progress text, and ready.
- **Analytics**
  - `app/app/analytics/page.tsx` (header, Suspense) and `components/analytics/analytics-content.tsx`.
  - Per-platform `PlatformCard`: 3 `StatTile`s and a `ColumnChart` (views only) with a table.
  - Then `NeedsResults`, the `PostRow` list and the `Log a past post` disclosure.
- **Data**
  - `lib/services/analytics.ts`: `getAnalyticsOverview` returns `posts` (≤ 50 with `comparison`), `needsResults`, `platforms` (`PlatformSummary`: posts, settled, `usualViews`, `usualEngagementRate`) and `charts` (views `ChartPoint[]` per platform).
  - `lib/analytics/baseline.ts`: `METRICS` = views, engagement_rate, follower_delta, retention_rate. `baselineFor(post, posts)` gives per-metric value / median / label. Also `isSettled`, `median`, `metricValue`, `MIN_BASELINE_POSTS = 3`.
  - `lib/analytics/chart-data.ts`: `chartPointsFor` (views only), `niceTicks`, `signedDomain`.
  - `lib/analytics/format.ts`: `formatCount`, `formatSigned`, `formatPercent`, `formatMetric(metric, value)`.
  - `format` is free text (≤ `FORMAT_MAX`).
- **Charts**
  - `components/charts/column-chart.tsx`: a client component, views-specific (`point.views`), with usual line, tooltip, links and touch-first readout.
  - `sparkline.tsx`, `metric-bars.tsx`, `chart-tooltip.tsx`, `use-width.ts`.
- **Tests:** `tests/analytics/baseline.test.ts` and `chart-data.test.ts`.

## Decisions / Assumptions

1. **No schema, migration, RLS or AI changes.** All new numbers are derived in pure functions from the posts `readPostSummaries` already reads (≤ `BASELINE_POST_LIMIT` = 200).
2. **"Usual" per metric per platform** = the median of that metric over the platform's settled posts that have it. It needs ≥ `MIN_BASELINE_POSTS` (3) values; otherwise the tab shows "—" and the note "Needs 3 settled posts".
3. **KPI delta** = the latest settled post's value vs that usual: `(value / usual − 1)` for views, engagement and retention, and the signed difference for follower change. It's labelled "latest" so it's never mistaken for a period-over-period change. Arrow plus text, never colour alone. No delta without both numbers.
4. **Platform selection** uses a `?platform=` search param, validated against the creator's platforms that have posts. The default is the platform with the most posts. The switcher is a row of pill links (`aria-current`), using the selected-tab style already in the app. With 1 platform there's no switcher. Posts with no platform form their own "No platform" option only if they exist.
5. **Metric tabs are client-side** (`role="tablist"`, roving focus, arrow keys). All four series (≤ 20 points each) are sent once, and switching doesn't refetch.
6. **`ColumnChart` is generalised** from views to any metric. Points carry `value`, and the client formats by `metric` (functions can't cross the server/client boundary). Follower change uses `signedDomain` with a zero baseline. Retention and engagement are percentages. The post detail page doesn't use `ColumnChart`, so nothing else changes.
7. **The Posts list, Needs results and Log a past post stay** below the new overview, unchanged. The old per-platform `PlatformCard` is removed (its content moves into the overview).
8. **Dashboard sparkline needs ≥ 3 points** (was 2). Two points can't show a pattern (dataviz anti-pattern).
9. **Positioning is body text, not a heading.** The card's heading becomes "Your strategy", and the positioning is a paragraph.

## Files Likely to Change

| File | Change |
|---|---|
| `app/app/page.tsx` | New row layout (see §1) |
| `components/strategy/dashboard-strategy-card.tsx` | Positioning layout (§1.2) |
| `components/dashboard/performance-card.tsx` | KPI layout, no nested tile, sparkline ≥ 3 (§1.3) |
| `components/dashboard/learned-card.tsx` | Progress meter for "x of 5" (§1.4) |
| `lib/analytics/chart-data.ts` | `metricPointsFor(posts, platform, metric)`, generalising `chartPointsFor` (views keeps working through it) |
| `lib/analytics/overview.ts` (new) | Pure: `platformOverview(posts, platform)` → `{ kpis, series, topPosts, formats, mix }` |
| `lib/services/analytics.ts` | `getAnalyticsOverview` also returns `overviews: PlatformOverview[]` (same order as `platforms`). `charts` is removed if nothing else reads it |
| `components/analytics/analytics-content.tsx` | New overview layout, platform switcher, `searchParams` platform |
| `app/app/analytics/page.tsx` | Pass `searchParams` through to `AnalyticsContent` |
| `components/analytics/metric-overview.tsx` (new, client) | KPI tabs + chart panel |
| `components/charts/column-chart.tsx` | Generalised to `metric` + `value` |
| `components/charts/format-bars.tsx` (new) | Horizontal median bars |
| `components/charts/comparison-donut.tsx` (new) | SVG donut + legend |
| `components/analytics/top-posts.tsx` (new) | Ranked list |
| `app/globals.css` | `.kpi-tabs`, `.kpi-tab`, `.chart-panel`, donut/legend and meter styles. `--chart-muted: #8a9393`, plus `--compare-above/around/below` |
| `tests/analytics/overview.test.ts` (new), `chart-data.test.ts` | Tests for the new pure functions |

## Database Changes

None.

## Implementation Requirements

### 1. Dashboard

**1.1 Layout** (`app/app/page.tsx`)

```
[ PageHeader ]
[ Today ............................................. full width ]
[ Your strategy ..................................... full width ]
[ Performance ................ ] [ What AI learned ............. ]   md: 2 cols, mobile: 1
AI usage line
```

`gap-6`. Row-3 cards stretch to equal height, and their actions sit at the bottom (`mt-auto`). Suspense boundaries and skeletons stay as they are (the strategy skeleton becomes full width).

**1.2 Strategy card** (positioning state)

- Header: `h2.text-heading` "Your strategy" with the strategy icon badge.
- Body on `lg` is a two-column grid (`lg:grid-cols-[3fr_2fr]`, 32px gap). Below `lg` the columns stack.
  - **Left**: eyebrow "Your positioning", then the positioning as a `<p>` at 18px/400, line-height 1.55, ink, `max-w-[65ch]`, `text-wrap: pretty`. Not bold, not a heading.
  - **Right**: eyebrow "Week {n} of 4", the week theme at 18px/700, then the focus text at 16px in pewter. On `lg` it has a 1px Ash left border with 32px padding; when stacked it has a top border. The "plan finished" message goes in this column instead.
- Footer: the `link-arrow` "See your full strategy" / "Rebuild your strategy".
- The other states (finish setup, build strategy, unavailable) keep their content and render full width.

**1.3 Performance card**

- Latest settled post:
  - eyebrow "Latest settled post"
  - views at 32px/800 with a "views" unit at 16px pewter
  - the comparison pill and "vs your usual X" on one row
  - the post title as a `.link` (16px/400, wraps)
  - no nested bordered tile
- Sparkline only with **≥ 3 points**, captioned "Your last N posts · line shows your usual". With fewer points, show nothing.
- Needs-results line and action as today. Other states are unchanged.

**1.4 What AI learned card**

- When `settled < needed`: a **meter**. The label is "{settled} of {needed} posts with week-old results", and below it an 8px bar (ink fill on a fog track, pill radius) with `role="meter"`, `aria-valuenow/min/max` and the label linked through `aria-labelledby`. Then the existing explanation (shortened to "Patterns appear once {needed} posts have week-old results.") and the action.
- The insights list and the other states are unchanged.

### 2. Analytics page

**2.1 Order**

```
[ PageHeader ]                                     [ platform pills ]
[ Overview panel: KPI tabs + chart ............................... ]
[ Top posts ] [ Views by format ] [ How your posts compare ]   lg: 3 cols, md: 2 (+1 full), mobile: 1
[ Needs results ]  (unchanged, when present)
[ Posts ]          (unchanged)
[ Log a past post ] (unchanged)
```

- When the creator has no posts, show the existing `EmptyHero` plus the form, as today.
- The platform pills render inside `AnalyticsContent` (they need data), right-aligned above the panel. They wrap on mobile.

**2.2 Platform overview data** (`lib/analytics/overview.ts`, pure, tested)

```ts
interface MetricKpi {
  metric: Metric;
  usual: number | null;        // median of settled values, null if < MIN_BASELINE_POSTS
  sample: number;              // settled posts with this metric
  latest: { id: string; title: string; value: number } | null; // latest settled post with the metric
  delta: number | null;        // ratio − 1 (views/engagement/retention) or signed difference (follower_delta); null without both
}
interface MetricPoint { id; title; published_at; value: number; settled: boolean; label: ComparisonLabel | null }
interface PlatformOverview {
  platform: Platform | null;
  posts: number; settled: number;
  kpis: MetricKpi[];                         // METRICS order
  series: Record<Metric, MetricPoint[]>;     // newest CHART_POST_LIMIT posts that have the metric, oldest first
  topPosts: { id; title; format: string | null; published_at; views: number; vsUsual: number | null }[]; // ≤ 5 settled, by views desc
  formats: { format: string; posts: number; medianViews: number }[];  // settled posts with views, grouped by trimmed, case-insensitive format (display: most common original spelling), top 5 by posts then median; posts with no format → "No format"
  mix: { above: number; around: number; below: number };            // settled posts with a views label
}
```

`label` per point comes from `baselineFor(post, posts).metrics[metric].label`, exactly as the post list labels it.

**2.3 KPI tabs + chart** (`metric-overview.tsx`, client)

- `div.chart-panel`: a white card containing a `div.kpi-tabs[role=tablist]` on top and the chart `tabpanel` below.
- The tab grid is 2 columns on mobile and 4 from `md`.
- Each tab is a `button[role=tab]` with `aria-selected`, `aria-controls`, roving `tabIndex` and ←/→/Home/End keys. It shows:
  - the label (13px/400 pewter)
  - the usual value (28px/800, formatted with `formatMetric`), or "—"
  - a delta line (13px): "▲ 32% latest" / "▼ 12% latest" / "+40 latest" for follower change, plus `sr-only` "latest post vs your usual". When there's no usual, it shows "Needs 3 settled posts" instead.
- **Active tab**: white background, a 3px ink inset top bar, and no bottom border, so it joins the panel. **Inactive**: fog background, 1px Ash bottom border. Hover (fine pointers): white. Press scale is not used on tabs (they're large surfaces).
- **Chart**: the generalised `ColumnChart` for the selected metric's series.
  - Settled posts in `--chart-accent` (ink), early posts in `--chart-muted` (`#8a9393`).
  - A dashed usual line with the "Your usual" key.
  - The legend (Settled / Early) when both are present.
  - The tooltip shows the title, date, the formatted value and the comparison text.
  - Columns link to the post.
  - Follower change: zero baseline, negative bars hang below it.
- "Show as table" disclosure (as today) for the selected metric.
- The caption reads "{Metric} per post (last 20)".
- With fewer than 2 points for the metric: "Add results to 2 or more posts to see this chart." Avg % viewed with no video posts: "Only video posts record % viewed."

**2.4 Top posts** (card)

- Title "Top posts". An `ol` of ≤ 5 rows, each with:
  - the rank (24px circle, 1px Ash, 13px/700)
  - the title `.link` (truncated to 2 lines) and a meta line (format · date, 13px pewter)
  - on the right: views (16px/700, tabular) and "+48% vs usual" (13px)
- Empty: "Top posts appear once posts have week-old results."

**2.5 Views by format** (card)

- Title "Views by format", subtitle "Median views of settled posts".
- Horizontal bars: label above, an 8px-tall ink bar scaled to the max (4px rounded end), the value at the right (tabular), and "n posts" in pewter. A 1-post format adds "early signal".
- `figure` with an `sr-only` table of the same values.
- Empty: "Add a format when you log posts to compare them."
- If only one format exists, show a single stat tile instead of a one-bar chart (dataviz anti-pattern).

**2.6 How your posts compare** (card)

- Title "How your posts compare", subtitle "Settled posts, views vs your usual".
- An SVG donut (160px, 22px stroke, 2px surface gaps between segments, starting at 12 o'clock):
  - Above `#1f7a3d`, Around `#8a9393`, Below `#c2410c` (validated, see Skills Read)
  - centre text: total (28px/800) and "posts" (13px)
- Legend beside it (stacked on mobile): swatch, label, and "n · xx%". Text stays in text colours. Hovering or focusing a legend row emphasises its segment.
- A segment `<title>` provides the readout for pointer users. `role="img"` with a full `aria-label` sentence.
- With fewer than 3 compared posts, show the text "Not enough compared posts yet (n of 3)" instead of the donut.

### 3. Styles (`globals.css`, section 11 additions)

- `--chart-muted: #8a9393`
- `--compare-above: #1f7a3d`, `--compare-around: #8a9393`, `--compare-below: #c2410c`
- `.chart-panel`, `.kpi-tabs`, `.kpi-tab` (+ `[aria-selected="true"]`)
- `.meter`, `.meter-fill`
- `.rank`
- `.donut-legend`

All on the 6px/16px radius system, borders not shadows, hover gated to fine pointers, no `transition: all`.

## AI Behavior

None. No model calls are added. The dashboard and analytics read stored data only.

## Security Requirements

- The `platform` search param is validated against the platform enum and the creator's own platforms. Invalid values fall back to the default; the param is never used in a query.
- All reads go through the existing `getAnalyticsOverview` with the user client (RLS) after `auth.protect()`.
- No new client-side data access. Client components receive only serialisable, already-authorised data for the signed-in creator.

## Acceptance Criteria

1. **Dashboard.** The strategy card spans the full width, shows the positioning as readable 18px regular text and the week focus beside it on `lg` (stacked below), and is no longer a tall bold column. Performance and What AI learned sit side by side from `md`, with equal heights.
2. The Performance card has no nested bordered tile, and shows no sparkline with fewer than 3 points.
3. What AI learned shows an accessible meter when fewer than 5 posts are settled.
4. **Analytics.** KPI tabs show the usual + latest delta for each of the 4 metrics. Selecting a tab (click, or the arrow keys) swaps the chart without a reload. Every number traces to logged results.
5. The platform pills appear only with ≥ 2 platforms, switch via `?platform=`, and an invalid value falls back safely.
6. Top posts, Views by format and How your posts compare render from real data, with the empty states above. The donut has a legend with counts and %, and a text/aria equivalent.
7. Every chart has a hover/focus readout, a legend where there's more than one series, and a table or sr-only equivalent.
8. Needs results, the Posts list and Log a past post work as before. The post detail page is unchanged.
9. 1440 / 1024 / 768 / 375 widths: no horizontal scroll. The tabs are 2×2 on mobile.
10. No schema changes, no new dependencies, no AI calls.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test        # incl. new tests/analytics/overview.test.ts and updated chart-data tests
pnpm build
```

New unit tests (pure functions):

- usual needs ≥ 3 settled values
- delta maths for ratio metrics and signed follower change; null without both numbers
- series order, limit and settled flags
- topPosts ranking and the cap at 5
- format grouping (case/trim, "No format", top 5)
- mix counts only settled, labelled posts
- platform-param validation

## Manual Test Procedure

1. `pnpm dev` and sign in with an account that has a strategy and ≥ 5 logged posts (some settled, some early, at least one video).
2. **Dashboard at 1440px**: the strategy is full width, the positioning reads as a paragraph and the week focus sits on the right. Performance and AI learned are side by side with equal heights. At 375px everything stacks and reads cleanly.
3. On an account with < 3 posts with views, there's no sparkline. On an account with < 5 settled posts, the AI learned meter shows "n of 5".
4. **`/app/analytics`**:
   - Click each KPI tab and use ←/→: the chart swaps and its caption and table follow.
   - Hover and focus columns: the readout shows the title, date, value and comparison.
   - Click a column: it opens the post.
5. Check the delta on Views by hand: latest settled views ÷ median of settled views − 1.
6. With 2 platforms, switch with the pills (the URL changes). Try `?platform=nonsense`: it falls back to the default.
7. Check that Top posts matches the post list sorted by views (settled only), that Views by format medians are right for a format with 3 posts, and that the donut counts match the above/around/below pills in the Posts list.
8. An account with no posts shows the EmptyHero and the form only.
9. DevTools reduced motion: nothing animates. Keyboard only: tabs, legend rows, columns and links are all reachable, with visible ink focus rings.

## Out of Scope

- Date ranges, period-over-period deltas and the export/download button.
- Connecting platform APIs, and any new metrics.
- The post detail page (`/app/analytics/[id]`), Insights and other pages.
- Changing the colour system (green bars) unless the owner asks.

## Revision 1

The owner asked for the bar charts to use the same colours as the Today card and the Insights empty-state panel, to keep things consistent. The settled columns (`ColumnChart`) and the Views-by-format bars now use the **prism-wash hues at full strength** as a gradient (`--wash-1/2/3`: green → teal → periwinkle), with a 1px `--bar-edge` ink hairline so their edges stay defined on white. Early posts stay grey (`--chart-muted`), and the legend swatch matches. Lines (the sparkline, the post-detail line chart) and the donut are unchanged.

Accessibility note: the wash hues are under 3:1 against white on their own. Values stay available through the hairline edge, the hover/focus readout, the direct label and the table view.
