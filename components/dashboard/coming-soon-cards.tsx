// Placeholder for Phase 5, part 3. It says plainly that the feature isn't
// available: no numbers, no sample charts, no controls.

export function ComingSoonCards() {
  return (
    <section className="card stack-sm" aria-labelledby="dashboard-learned">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dashboard-learned" className="text-heading">
          What AI learned
        </h2>
        <span className="rounded-pill border border-border px-3 py-1 text-sm font-semibold">Coming soon</span>
      </div>
      <p className="text-muted-foreground">Patterns from your results, like which hooks and formats work for you.</p>
    </section>
  );
}
