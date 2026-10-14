import Link from "next/link";
import type { RankedIdea } from "@/lib/services/daily-recommendation";
import { IdeaSummary } from "./idea-summary";

/** The best idea to act on next, when today's action isn't already about an idea. */
export function NextIdeaCard({ idea }: { idea: RankedIdea }) {
  const saved = idea.status === "saved";
  return (
    <section className="card stack-sm" aria-labelledby="dashboard-next-idea">
      <h2 id="dashboard-next-idea" className="text-heading">
        Next idea worth making
      </h2>
      <IdeaSummary idea={idea} />
      <div>
        <Link
          href={saved ? "/app/calendar" : "/app/opportunities"}
          className="btn btn-secondary w-full min-[480px]:w-auto"
        >
          {saved ? "Schedule it" : "Review it"}
        </Link>
      </div>
    </section>
  );
}
