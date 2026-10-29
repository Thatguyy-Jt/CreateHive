import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { BreakdownView } from "@/components/breakdown/breakdown-view";
import { SectionSkeleton } from "@/components/settings/section-skeleton";

export const metadata: Metadata = { title: "Video breakdown" };

function ViewSkeleton() {
  return (
    <div className="stack-md" aria-hidden="true">
      {[3, 4, 5].map((lines, index) => (
        <div key={index} className="card">
          <SectionSkeleton lines={lines} />
        </div>
      ))}
    </div>
  );
}

// The heading is static; `params` and the session are read behind Suspense,
// where the content calls `auth.protect()` itself.
export default function BreakdownDetailPage({ params }: PageProps<"/app/breakdown/[id]">) {
  return (
    <div className="stack-lg max-w-3xl">
      <PageHeader icon="breakdown" title="Video breakdown" back={{ href: "/app/breakdown", label: "All breakdowns" }} />
      <Suspense fallback={<ViewSkeleton />}>
        <BreakdownView params={params} />
      </Suspense>
    </div>
  );
}
