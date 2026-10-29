import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { BreakdownContent } from "@/components/breakdown/breakdown-content";
import { SectionSkeleton } from "@/components/settings/section-skeleton";

export const metadata: Metadata = { title: "Video Breakdown" };

function ContentSkeleton() {
  return (
    <div className="stack-md max-w-3xl" aria-hidden="true">
      {[4, 3].map((lines, index) => (
        <div key={index} className="card">
          <SectionSkeleton lines={lines} />
        </div>
      ))}
    </div>
  );
}

// The heading is static; the session-bound content sits behind Suspense and
// calls `auth.protect()` itself.
export default function BreakdownPage({ searchParams }: PageProps<"/app/breakdown">) {
  return (
    <div className="stack-lg">
      <PageHeader
        icon="breakdown"
        title="Video Breakdown"
        description="See why a video worked and how to make your own version."
        note="We use official data where it exists and your numbers where it doesn't. We never copy or download videos."
      />
      <Suspense fallback={<ContentSkeleton />}>
        <BreakdownContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
