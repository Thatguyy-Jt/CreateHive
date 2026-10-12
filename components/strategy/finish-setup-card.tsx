import Link from "next/link";

/** Shown on /app and /app/strategy until onboarding is complete. */
export function FinishSetupCard({ headingId }: { headingId: string }) {
  return (
    <section className="card card-offset max-w-2xl stack-sm" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-heading">
        Finish setting up
      </h2>
      <p className="text-muted-foreground">
        Tell us about your content and how you sound. It takes about three minutes, and we&apos;ll use it to build
        your positioning, content pillars and a 30-day plan.
      </p>
      <div>
        <Link href="/onboarding" className="btn btn-primary w-full sm:w-auto">
          Set up my profile
        </Link>
      </div>
    </section>
  );
}
