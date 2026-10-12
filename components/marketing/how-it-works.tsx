import { steps } from "@/lib/marketing/sample-data";

export function HowItWorks() {
  return (
    <section id="how-it-works" className="section scroll-mt-20">
      <div className="container-page stack-lg">
        <div className="stack-sm max-w-2xl">
          <p className="eyebrow">How it works</p>
          <h2>
            One loop that gets <span className="accent-word">smarter</span> every post
          </h2>
          <p className="lead">
            CreateHive isn&apos;t a one-off idea generator. Each post you log feeds the next
            recommendation.
          </p>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((step) => (
            <li key={step.n} className="card stack-sm md:p-6">
              <span className="font-mono text-sm font-bold text-success">{step.n}</span>
              <h3 className="text-xl">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
