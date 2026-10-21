import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
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
      <PageHeader
        icon="studio"
        title="Studio"
        description="Turn the ideas you chose into scripts, shot lists and captions in your voice."
        note="Studio prepares your content. It doesn’t post for you."
      />
      <Suspense fallback={<ListSkeleton />}>
        <StudioListContent />
      </Suspense>
    </div>
  );
}
