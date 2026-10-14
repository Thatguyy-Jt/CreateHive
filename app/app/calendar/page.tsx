import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarContent } from "@/components/calendar/calendar-content";
import { SectionSkeleton } from "@/components/settings/section-skeleton";

export const metadata: Metadata = { title: "Calendar" };

function WeekSkeleton() {
  return (
    <div className="stack-md" aria-hidden="true">
      <div className="h-11 w-80 max-w-full rounded-pill bg-surface-muted" />
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
      <div className="stack-sm max-w-3xl">
        <h1>Calendar</h1>
        <p className="lead">Plan when you&apos;ll make each idea.</p>
        <p className="field-help">This plans your week. It doesn&apos;t post for you.</p>
      </div>
      <Suspense fallback={<WeekSkeleton />}>
        <CalendarContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
