import { formatCount } from "@/lib/analytics/format";
import type { FormatViews } from "@/lib/analytics/overview";

/**
 * Median views per format as horizontal bars, largest scale first. Each bar
 * carries its value and post count as text, so nothing relies on length alone.
 */
export function FormatBars({ formats }: { formats: FormatViews[] }) {
  const max = Math.max(1, ...formats.map((f) => f.medianViews));
  return (
    <figure className="stack-sm">
      <ul className="grid gap-3" aria-hidden="true">
        {formats.map((item) => (
          <li key={item.format} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-bold" title={item.format}>
                {item.format}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-bold">{formatCount(Math.round(item.medianViews), true)}</span>{" "}
                <span className="text-muted-foreground">
                  · {item.posts} {item.posts === 1 ? "post, early signal" : "posts"}
                </span>
              </span>
            </div>
            <div className="format-bar-track">
              <div className="format-bar" style={{ width: `${Math.max(2, (item.medianViews / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>Median views of settled posts by format</caption>
        <thead>
          <tr>
            <th scope="col">Format</th>
            <th scope="col">Median views</th>
            <th scope="col">Posts</th>
          </tr>
        </thead>
        <tbody>
          {formats.map((item) => (
            <tr key={item.format}>
              <th scope="row">{item.format}</th>
              <td>{formatCount(Math.round(item.medianViews))}</td>
              <td>{item.posts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
