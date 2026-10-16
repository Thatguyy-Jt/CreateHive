# Analytics charts (Phase 5, part 1 follow-up)

A visual upgrade to the analytics shipped in `prompts/analytics-results.md`. The creator asked for **charts showing the metrics instead of cards**, so the analytics feel premium. Data, rules and baselines don't change. This changes only how they're shown.

## Goal

Replace the text-only summaries with charts that answer, at a glance:

1. **Analytics page:** "How are my posts doing against my usual on each platform?" → a views-per-post column chart for each platform, with the creator's usual drawn as a reference line, above a row of stat tiles.
2. **Post page:** "How did this post do?" → one compact bar per metric: this post's value, with a marker for the creator's usual. Plus "How did it grow?" → a line of views across check-ins.
3. **Dashboard:** a sparkline of recent posts' views against the usual, inside the Performance card.

Every chart keeps a text or table equivalent, so no value is only reachable by looking at a chart or hovering.

## Skills Read

- `dataviz`: form choice (stat tiles for headline numbers; columns for magnitude per post; lines for change over time; **emphasis**, one hue plus gray, because there's one series per chart), mark specs, hover layer, table view, anti-patterns, and the palette validator (run; results below).
- Next.js Cache Components rule (unchanged): data stays in the Suspense-bound server components; charts are client components that receive plain props.

## Existing Code Inspected

- `components/analytics/analytics-content.tsx`: `PlatformCard` (text facts), `NeedsResults`, `PostRow`, the past-post form.
- `components/analytics/post-content.tsx` and `comparison.tsx`: `ComparisonCard` with `ComparisonTable` (a table on wide screens, stacked rows below 480px), and `History` (a text list of check-ins).
- `components/dashboard/performance-card.tsx`: the latest settled post's text summary.
- `lib/services/analytics.ts`: `readPostSummaries` (up to 200 posts, latest check-in each), `getAnalyticsOverview`, `getPost` (all check-ins), `getPerformanceSummary`.
- `lib/analytics/baseline.ts`: `isSettled`, `baselineFor`, `platformSummaries`, `median`.
- `app/globals.css`: semantic tokens (`--surface`, `--border`, `--muted-foreground`, `--foreground`), the signal ramp, and dark mode via `prefers-color-scheme` only (there's no `data-theme` toggle in this app).
- `package.json`: **no charting library is installed.**

## Decisions / Assumptions

1. **No new dependency.** Charts are small hand-written inline SVG components (`components/charts/*`). A handful of single-series charts doesn't justify Recharts or D3 in the bundle, and inline SVG renders on first paint and themes with CSS variables.
2. **Charts are client components** (`"use client"`) for hover and focus tooltips and to measure their width (`ResizeObserver`). They take plain serialisable props built on the server. Before measuring, they render at a default width, so there's no layout jump beyond a resize. They read no creator data themselves.
3. **Colour (validated with the dataviz script, light surface `#ffffff`, dark surface `#13211e`):**
   - **Accent mark** (the series): `--chart-accent: #149e66` (signal-600) in **both** modes. It passes the lightness band, chroma floor and ≥ 3:1 contrast in light and dark. Signal-500 failed the dark lightness band; signal-400 is too light.
   - **De-emphasis** (early posts, posts without results, the context bars on the post chart): light `#a3a39d` (neutral-400), dark `#5d706b`. It's gray by design: it fails the categorical chroma floor, which is expected for the de-emphasis role, and sits at 2.54:1 in light mode, so the **relief rule** applies. Every gray mark also has a text label or tooltip, plus a table view.
   - **Reference line** ("Your usual"): `--foreground` at 1.5px, solid, with a direct text label. Not dashed: dashing reads as a projection.
   - **Grid and axes:** `--border` hairlines, solid.
   - Text never uses the accent colour: labels and values use `--foreground` and `--muted-foreground`.
   - Above/below is shown by **position against the usual line plus the existing text pill**, never by red/green colour. Status colours stay reserved.
   - Tokens are added to `globals.css` as `--chart-accent`, `--chart-muted`, under `:root` and the existing dark `@media` block.
4. **Analytics page:**
   - **Stat tiles** replace the facts line in `PlatformCard`, one row per platform: Posts · Usual views · Usual engagement. A missing median shows "—" with "Needs 3 settled posts" under it. The values use proportional figures (no `tabular-nums` at tile size).
   - **"Views per post" column chart** under the tiles, per platform:
     - the platform's **last 20 posts with views** in publish order, oldest to newest left to right;
     - columns ≤ 24px wide, with 4px rounded tops, square at the baseline and a 2px gap;
     - settled posts in the accent; early posts in gray;
     - the **usual line** across the plot with the label "Your usual · 1.1K" at its right end; it's left out when there's no baseline;
     - y-axis with 3–4 clean compact ticks (0 / 1K / 2K) and hairline gridlines;
     - x-axis: the first and last post dates only;
     - direct label: only the **highest** column's value;
     - legend: two swatches, "Settled" and "Early (first week)", shown only when both kinds are present (a single series needs no legend);
     - hover/focus tooltip per column: value first ("2,000 views"), then title, date and the comparison text ("Above your usual" / "Early results").
     - Columns are focusable buttons that open the post page.
     - Fewer than 2 posts with views: no chart, just the line "Add results to 2 or more posts to see a chart."
   - A **"Show as table"** `details` under each chart: post, date, views, compared.
   - The Posts list stays as it is (it's the navigable list, and it has posts without views).
5. **Post page:**
   - **"Compared with your usual"** becomes one small horizontal bar per metric (views, engagement rate, follower change, average % viewed for video):
     - the metric name and value text on the left;
     - an accent bar for this post (gray when the post is early);
     - a **vertical tick** for the usual with the label "usual 1,000";
     - each metric scales on its own (0 to max(value, usual) × 1.15), because metrics of different scale never share an axis;
     - follower change can be negative, so its scale is centred on 0 with a zero hairline;
     - the existing pill sits on the right.
   - The **existing `ComparisonTable`** moves into a "Show as table" `details` (it's the table view).
   - Metrics with neither a value nor a usual are left out, as today.
   - **"Views over time"** line chart in the Results history card, shown when ≥ 2 check-ins have views:
     - x = day since posting, y = views;
     - a 2px accent line with ≥ 8px dots and a 2px surface ring;
     - a 10% area wash;
     - the usual line when it exists;
     - an end label with the latest value;
     - a crosshair tooltip that snaps to the nearest check-in ("1,200 views · day 3"), also reachable by keyboard (arrow keys move between points).
     - The existing history list stays under it as the table view.
6. **Dashboard Performance card:**
   - a stat tile: latest settled post's views, a "vs your usual 1.1K" line and the pill;
   - a **sparkline** of the last 12 posts with views:
     - accent line, gray dots for early posts, and the usual as a hairline;
     - no axes; `aria-hidden`, with a visually hidden sentence summarising it ("Views of your last 12 posts, from 300 to 2,000; your usual is 1,100.").
   - The text fallbacks (no posts, needs results) are unchanged.
7. **Service changes (read-only, no new queries):**
   - `getAnalyticsOverview` adds `charts: { platform, points: ChartPoint[] }[]`, built from the 200 summaries it already reads. A `ChartPoint` is `{ id, title, published_at, views, settled, label }`.
   - `getPerformanceSummary` adds `spark: { points, usualViews }` from the latest platform used.
   - Pure helpers in `lib/analytics/chart-data.ts`: `chartPointsFor(posts, platform, limit)`, `niceTicks(max, count)`, `extent`.
8. **Respects `prefers-reduced-motion`:** no animation at all (the charts are static; tooltips appear without transition).
9. **Visual check:** `pnpm dev` and a look at light and dark mode at 375px and desktop, checking for label collisions and overflow, before reporting. If a browser can't be driven from here, this is listed as a manual step, not claimed.

## Files Likely to Change

| File | Change |
|---|---|
| `app/globals.css` | `--chart-accent`, `--chart-muted` (light and dark) |
| `lib/analytics/chart-data.ts` (new) | Chart points, nice ticks, extents (pure) |
| `lib/services/analytics.ts` | `charts` on the overview, `spark` on the summary |
| `components/charts/use-width.ts` (new) | `ResizeObserver` width hook |
| `components/charts/chart-tooltip.tsx` (new) | Shared tooltip (value first, line key, text only) |
| `components/charts/column-chart.tsx` (new) | Views per post with reference line, focusable columns |
| `components/charts/line-chart.tsx` (new) | Views over time with crosshair and keyboard |
| `components/charts/metric-bars.tsx` (new) | Per-metric bar with usual tick (signed scale for followers) |
| `components/charts/sparkline.tsx` (new) | Dashboard sparkline |
| `components/charts/stat-tile.tsx` (new) | Stat tile |
| `components/analytics/analytics-content.tsx` | Tiles + chart + table view per platform |
| `components/analytics/post-content.tsx`, `comparison.tsx` | Metric bars, table in `details`, line chart in History |
| `components/dashboard/performance-card.tsx` | Tile + sparkline |
| `tests/analytics/chart-data.test.ts` (new), `tests/services/analytics.test.ts` | Helpers and new service fields |

## Database Changes

None.

## Implementation Requirements

1. SVG is built with React elements only: no `dangerouslySetInnerHTML`. Post titles appear in tooltips as React text, so they're escaped.
2. Each chart:
   - is a `figure` with a visible `figcaption` title, or an `aria-labelledby` heading;
   - has an `svg` with `role="img"` and an `aria-label` summary sentence;
   - has interactive marks with an accessible name ("Squats in 10 minutes, Oct 2: 2,000 views, above your usual").
3. Hit targets are ≥ 24px wide: a column's hit area spans its full band, and line points use the crosshair band.
4. Container height includes the x-axis band (no nested scroll). Charts never overflow at 320px.
5. Numbers come from the existing `formatCount` / `formatMetric`.
6. Nothing in the charts implies a prediction or a score.

## AI Behavior

None.

## Security Requirements

No new data leaves the server beyond what the pages already render (titles, dates and numbers of the creator's own posts). No new routes or actions. All creator text renders as React text.

## Acceptance Criteria

1. The analytics page shows stat tiles and a views-per-post chart for each platform with ≥ 2 posts with views, with the usual line when a baseline exists, early posts in gray, and a table view.
2. The post page shows per-metric bars with the usual tick (followers on a signed scale), the table in "Show as table", and a views-over-time line when there are ≥ 2 check-ins with views.
3. The dashboard Performance card shows a tile and a sparkline when there's data, with a hidden text summary.
4. Every value shown in a chart is also available as text or in a table. Tooltips work on hover and keyboard focus.
5. Light and dark mode both use the validated colours. Nothing scrolls horizontally at 375px.
6. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

- `tests/analytics/chart-data.test.ts`: point selection (platform, views present, last 20 in publish order, settled flag), `niceTicks` (clean steps, covers the max, handles 0), signed extents.
- `tests/services/analytics.test.ts`: `charts` and `spark` on the existing fixtures.

## Manual Test Procedure

1. `pnpm dev` with a creator who has ≥ 4 YouTube posts with results (log past posts dated over a week ago) and one early post.
2. `/app/analytics`: tiles show posts, usual views and engagement. The chart shows the columns oldest to newest, the early one in gray, the "Your usual" line with its label, and only the highest column labelled. Hover a column: the tooltip leads with the views. Tab to a column: the same tooltip shows; Enter opens the post. "Show as table" lists the same numbers.
3. A post page: each metric has a bar and an "usual" tick, and follower change with a loss draws left of zero. Add two more check-ins: "Views over time" appears; arrow keys move the tooltip between points.
4. Dashboard: the Performance card shows the tile and sparkline.
5. Toggle OS dark mode: the marks stay readable, the gridlines stay recessive and the text uses text colours.
6. 375px width: no horizontal scroll; axis labels aren't clipped. Keyboard only: every chart point is reachable, with visible focus.

## UI

- **Visual interpretation:** calm, editorial charts in the app's ink-and-mint style. Thin mint marks on white (or deep green-black in dark mode), hairline gray structure, and one bold reference line for "your usual". The data is the only loud thing.
- **Layout:**
  - analytics page: per platform, a `card` with the platform `h3`, then the tile row (3 tiles, wrapping to 1 column below 480px), then the chart (height 220px plus the axis band) and "Show as table";
  - post page: metric bars inside the comparison card (one row each, 44px tall);
  - line chart: 200px in the history card;
  - sparkline: 48px tall, full card width.
- **Typography:**
  - tile values `text-3xl font-semibold`, proportional figures;
  - tile labels `field-help`;
  - axis ticks `text-xs`, `tabular-nums`, `--muted-foreground`;
  - tooltip value `font-semibold`, label `text-sm` muted.
- **Spacing:** `stack-md` inside platform cards; 16px plot padding; tooltips offset 12px from the pointer and kept inside the card.
- **States:**
  - loading: the existing skeletons;
  - empty: the existing empty states, plus the "Add results to 2 or more posts to see a chart" line;
  - error: the existing `LoadError`.
- **Mobile:** charts fill the card width; at < 480px the x-axis shows only the first and last labels, which it already does, and tiles stack. The tooltip is pinned above the touched mark on touch (tap shows, tap elsewhere hides).
- **Accessibility:** as in Implementation Requirements, plus focus rings on columns and points using `--ring`, and nothing conveyed by colour alone (early vs settled is also in the legend, the tooltip and the table).

## Known Limitations

- Views is the only metric charted per post on the overview. Engagement and other metrics are in the tiles and on each post page (one axis per chart, by rule).
- No date-range filter: the chart shows the last 20 posts per platform.
- Hand-written charts cover these four forms only. If later phases need many more chart types, adopting a library is a separate decision.
