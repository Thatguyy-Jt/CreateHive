import type { Metadata } from "next";
import { Suspense } from "react";
import { SectionSkeleton } from "@/components/settings/section-skeleton";
import { StudioListContent } from "@/components/studio/studio-list-content";

export const metadata: Metadata = { title: "Studio" };

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

// The heading is static; the session-bound list sits behind Suspense and
// calls `auth.protect()` itself.
export default function StudioPage() {
  return (
    <div className="stack-lg">
      <div className="stack-sm max-w-3xl">
        <h1>Studio</h1>
        <p className="lead">Turn the ideas you chose into scripts, shot lists and captions in your voice.</p>
        <p className="field-help">Studio prepares your content. It doesn&apos;t post for you.</p>
      </div>
      <Suspense fallback={<ListSkeleton />}>
        <StudioListContent />
      </Suspense>
    </div>
  );
}
