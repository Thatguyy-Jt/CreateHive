import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { logEvent } from "@/lib/observability/log";
import { listSignals } from "@/lib/services/research-signals";
import { getYouTubeStatus, type YouTubeStatus } from "@/lib/services/youtube-refresh";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";
import { AddSignalForm } from "./add-signal-form";
import { SignalCard } from "./signal-card";
import { YouTubeCard } from "./youtube-card";

function LoadError() {
  return (
    <div role="alert" className="card max-w-3xl stack-sm">
      <h2 className="text-heading">We couldn&apos;t load your research</h2>
      <p className="text-muted-foreground">Something went wrong on our side. Refresh the page to try again.</p>
    </div>
  );
}

async function youtubeStatus(client: ReturnType<typeof createUserClient>, userId: string): Promise<YouTubeStatus> {
  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    logEvent("error", "youtube_refresh_failed", { stage: "admin_client", name: error instanceof Error ? error.name : typeof error });
    return { state: "error" };
  }
  return getYouTubeStatus(client, admin, userId);
}

/** Session-bound part of /app/research: add form, YouTube research and the creator's signals. */
export async function ResearchContent() {
  const { userId } = await auth.protect();

  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "signal_read_failed", { stage: "client", name: error instanceof Error ? error.name : typeof error });
    return <LoadError />;
  }

  const [listed, youtube] = await Promise.all([listSignals(client, userId), youtubeStatus(client, userId)]);
  if (!listed.ok) return <LoadError />;
  const { signals } = listed;

  return (
    <div className="stack-md max-w-3xl">
      <AddSignalForm />
      <YouTubeCard status={youtube} />

      <section className="stack-md" aria-labelledby="research-signals">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 id="research-signals" className="text-heading">
            Your signals
          </h2>
          <Link href="/app/opportunities" className="link">
            Generate ideas from these
          </Link>
        </div>
        {signals.length === 0 ? (
          <div className="card">
            <p>No signals yet. Paste a comment, a competitor observation or a note, and your ideas can cite it.</p>
          </div>
        ) : (
          <ul className="stack-md" aria-label="Signals">
            {signals.map((signal) => (
              <li key={signal.id}>
                <SignalCard signal={signal} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
