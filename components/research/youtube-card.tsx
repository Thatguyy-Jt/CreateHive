import Link from "next/link";
import type { YouTubeStatus } from "@/lib/services/youtube-refresh";
import { RefreshYouTubeControl } from "./refresh-youtube-control";

const DATE_TIME = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const when = (value: string) => `${DATE_TIME.format(new Date(value))} UTC`;

/** YouTube research: the refresh button only when it can actually run; otherwise why not. */
export function YouTubeCard({ status }: { status: YouTubeStatus }) {
  const last = "lastRefreshedAt" in status && status.lastRefreshedAt ? `Last refreshed ${when(status.lastRefreshedAt)}.` : null;

  let body;
  switch (status.state) {
    case "available":
      body = null;
      break;
    case "cached":
      body = <p>Available once a day. You can refresh again after {when(status.nextRefreshAt)}.</p>;
      break;
    case "too_many_attempts":
      body = <p>We couldn&apos;t reach YouTube after a few tries. You can try again after {when(status.nextRefreshAt)}.</p>;
      break;
    case "budget_exhausted":
      body = <p>YouTube research has reached today&apos;s limit for everyone. Please try again tomorrow.</p>;
      break;
    case "not_on_youtube":
      body = (
        <p>
          Add YouTube as a platform in your{" "}
          <Link href="/onboarding" className="link">
            profile
          </Link>{" "}
          to use this.
        </p>
      );
      break;
    case "no_strategy":
      body = (
        <p>
          <Link href="/app/strategy" className="link">
            Build your strategy
          </Link>{" "}
          first, so we know which topics to look up.
        </p>
      );
      break;
    case "not_configured":
      body = <p>YouTube research isn&apos;t set up yet.</p>;
      break;
    default:
      body = <p>We couldn&apos;t check YouTube research right now. Refresh the page to try again.</p>;
  }

  return (
    <section className="card stack-sm" aria-labelledby="research-youtube">
      <h2 id="research-youtube" className="text-heading">
        YouTube research
      </h2>
      <p className="text-muted-foreground">
        Fetches recent popular videos in your niche. Uses no AI generations. Available once a day; videos are kept for
        7 days.
      </p>
      <RefreshYouTubeControl canRefresh={status.state === "available"}>{body}</RefreshYouTubeControl>
      {last ? <p className="field-help">{last}</p> : null}
    </section>
  );
}
