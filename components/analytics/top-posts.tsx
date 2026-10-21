import Link from "next/link";
import { formatCount, formatPercent } from "@/lib/analytics/format";
import type { TopPost } from "@/lib/analytics/overview";

/** "+48% vs usual" / "−12% vs usual"; null without a baseline. */
function vsUsualText(vsUsual: number | null): string | null {
  if (vsUsual === null) return null;
  const sign = vsUsual > 0 ? "+" : vsUsual < 0 ? "−" : "";
  return `${sign}${formatPercent(Math.abs(vsUsual))} vs usual`;
}

/** The creator's best settled posts by views, ranked. Real data only. */
export function TopPosts({ posts, dayOf }: { posts: TopPost[]; dayOf: Record<string, string | null> }) {
  return (
    <section className="card stack-md" aria-labelledby="analytics-top-posts">
      <div>
        <h2 id="analytics-top-posts" className="text-heading">
          Top posts
        </h2>
        <p className="field-help">By views, settled posts only</p>
      </div>
      {posts.length ? (
        <ol className="grid gap-3">
          {posts.map((post, index) => {
            const meta = [post.format, dayOf[post.id]].filter(Boolean).join(" · ");
            const vs = vsUsualText(post.vsUsual);
            return (
              <li key={post.id} className="flex items-start gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                <span className="rank" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/app/analytics/${post.id}`} className="link line-clamp-2 break-words">
                    {post.title}
                  </Link>
                  {meta ? <p className="field-help">{meta}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold tabular-nums">
                    {formatCount(post.views, true)}
                    <span className="sr-only"> views</span>
                  </p>
                  {vs ? <p className="field-help tabular-nums">{vs}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground">Top posts appear once posts have week-old results.</p>
      )}
    </section>
  );
}
