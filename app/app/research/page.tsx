import type { Metadata } from "next";
import { Suspense } from "react";
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
      <div className="stack-sm max-w-3xl">
        <h1>Research</h1>
        <p className="lead">Real signals your ideas can be based on.</p>
        <p className="field-help">Signals are inputs, not facts. We show where each one came from.</p>
      </div>
      <Suspense fallback={<ListSkeleton />}>
        <ResearchContent />
      </Suspense>
    </div>
  );
}
