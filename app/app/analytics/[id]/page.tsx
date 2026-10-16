import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
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
      <div className="stack-sm">
        <p>
          <Link href="/app/analytics" className="link">
            <span aria-hidden="true">←</span> All posts
          </Link>
        </p>
        <h1>Post results</h1>
      </div>
      <Suspense fallback={<PostSkeleton />}>
        <PostContent params={params} />
      </Suspense>
    </div>
  );
}
