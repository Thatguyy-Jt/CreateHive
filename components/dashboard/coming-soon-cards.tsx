// Placeholders for Phase 5. They say plainly that the feature isn't available:
// no numbers, no sample charts, no controls.

const CARDS = [
  {
    id: "dashboard-performance",
    title: "Performance",
    body: "See how each post does against your own usual numbers, once you add your results.",
  },
  {
    id: "dashboard-learned",
    title: "What AI learned",
    body: "Patterns from your results, like which hooks and formats work for you.",
  },
] as const;

export function ComingSoonCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {CARDS.map((card) => (
        <section key={card.id} className="card stack-sm" aria-labelledby={card.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={card.id} className="text-heading">
              {card.title}
            </h2>
            <span className="rounded-pill border border-border px-3 py-1 text-sm font-semibold">Coming soon</span>
          </div>
          <p className="text-muted-foreground">{card.body}</p>
        </section>
      ))}
    </div>
  );
}
