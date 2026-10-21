import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { OpportunitiesContent } from "@/components/opportunities/opportunities-content";
import { SectionSkeleton } from "@/components/settings/section-skeleton";

export const metadata: Metadata = { title: "Opportunities" };

function ListSkeleton() {
  return (
    <div className="stack-md max-w-3xl" aria-hidden="true">
      <div className="skeleton h-11 w-64 max-w-full rounded-pill" />
      {[0, 1, 2].map((index) => (
        <div key={index} className="card">
          <SectionSkeleton lines={3} />
        </div>
      ))}
    </div>
  );
}

// The heading is static; the session-bound list sits behind Suspense and
// calls `auth.protect()` itself.
export default function OpportunitiesPage({ searchParams }: PageProps<"/app/opportunities">) {
  return (
    <div className="stack-lg">
      <PageHeader
        icon="opportunities"
        title="Opportunities"
        description="Ideas that fit your strategy. Save the ones you’ll make."
        note={
          <>
            Ideas are based on your profile, your strategy, the{" "}
            <Link href="/app/research" className="link">
              research signals
            </Link>{" "}
            you add and (once connected) your performance. Signals are inputs, not facts: each idea shows what it
            cites.
          </>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <OpportunitiesContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
