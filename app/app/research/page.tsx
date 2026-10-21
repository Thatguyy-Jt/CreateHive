import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { ResearchContent } from "@/components/research/research-content";
import { SectionSkeleton } from "@/components/settings/section-skeleton";

export const metadata: Metadata = { title: "Research" };

function ListSkeleton() {
  return (
    <div className="stack-md max-w-3xl" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="card">
          <SectionSkeleton lines={3} />
        </div>
      ))}
    </div>
  );
}

// The heading is static; the session-bound content sits behind Suspense and
// calls `auth.protect()` itself.
export default function ResearchPage() {
  return (
    <div className="stack-lg">
      <PageHeader
        icon="research"
        title="Research"
        description="Real signals your ideas can be based on."
        note="Signals are inputs, not facts. We show where each one came from."
      />
      <Suspense fallback={<ListSkeleton />}>
        <ResearchContent />
      </Suspense>
    </div>
  );
}
