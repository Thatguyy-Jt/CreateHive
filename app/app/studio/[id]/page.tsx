import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { SectionSkeleton } from "@/components/settings/section-skeleton";
import { StudioItemContent } from "@/components/studio/studio-item-content";

export const metadata: Metadata = { title: "Content package" };

function ItemSkeleton() {
  return (
    <div className="stack-lg" aria-hidden="true">
      <div className="card">
        <SectionSkeleton lines={3} />
      </div>
      {[0, 1].map((index) => (
        <div key={index} className="card">
          <SectionSkeleton lines={4} />
        </div>
      ))}
    </div>
  );
}

// The heading is static; `params` and the session are read behind Suspense,
// where the content calls `auth.protect()` itself.
export default function StudioItemPage({ params, searchParams }: PageProps<"/app/studio/[id]">) {
  return (
    <div className="stack-lg max-w-3xl">
      <PageHeader icon="studio" title="Content package" back={{ href: "/app/studio", label: "All Studio items" }} />
      <Suspense fallback={<ItemSkeleton />}>
        <StudioItemContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
