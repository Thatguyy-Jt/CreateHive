import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { PostContent } from "@/components/analytics/post-content";
import { SectionSkeleton } from "@/components/settings/section-skeleton";

export const metadata: Metadata = { title: "Post results" };

function PostSkeleton() {
  return (
    <div className="stack-lg" aria-hidden="true">
      {[3, 4, 4].map((lines, index) => (
        <div key={index} className="card">
          <SectionSkeleton lines={lines} />
        </div>
      ))}
    </div>
  );
}

// The heading is static; `params` and the session are read behind Suspense,
// where the content calls `auth.protect()` itself.
export default function PostResultsPage({ params }: PageProps<"/app/analytics/[id]">) {
  return (
    <div className="stack-lg max-w-3xl">
      <PageHeader icon="analytics" title="Post results" back={{ href: "/app/analytics", label: "All posts" }} />
      <Suspense fallback={<PostSkeleton />}>
        <PostContent params={params} />
      </Suspense>
    </div>
  );
}
