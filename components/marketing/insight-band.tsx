import { LearnedCard } from "./mockups";

export function InsightBand() {
  return (
    <section className="section section-dark">
      <div className="container-page split">
        <div className="stack-md">
          <p className="eyebrow">Learning</p>
          <h2>
            It learns what works for <span className="accent-word">you</span>
          </h2>
          <p className="lead">
            CreateHive spots patterns across your topics, hooks, formats and lengths, and feeds
            them back into your next recommendations.
          </p>
          <p className="text-muted-foreground">
            One lucky post isn&apos;t treated as a rule. Each pattern shows how many posts support
            it, so you can see how confident the insight is.
          </p>
        </div>
        <LearnedCard className="card-offset" />
      </div>
    </section>
  );
}
