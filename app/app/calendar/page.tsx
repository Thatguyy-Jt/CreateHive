import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { CalendarContent } from "@/components/calendar/calendar-content";
import { SectionSkeleton } from "@/components/settings/section-skeleton";

export const metadata: Metadata = { title: "Calendar" };

function WeekSkeleton() {
  return (
    <div className="stack-md" aria-hidden="true">
      <div className="skeleton h-11 w-80 max-w-full rounded-pill" />
      {[0, 1, 2].map((index) => (
        <div key={index} className="card">
          <SectionSkeleton lines={2} />
        </div>
      ))}
    </div>
  );
}

// The heading is static; the session-bound week sits behind Suspense and
// calls `auth.protect()` itself.
export default function CalendarPage({ searchParams }: PageProps<"/app/calendar">) {
  return (
    <div className="stack-lg">
      <PageHeader
        icon="calendar"
        title="Calendar"
        description="Plan when you’ll make each idea."
        note="This plans your week. It doesn’t post for you."
      />
      <Suspense fallback={<WeekSkeleton />}>
        <CalendarContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
