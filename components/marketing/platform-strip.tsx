import { platforms } from "@/lib/marketing/sample-data";

export function PlatformStrip() {
  return (
    <section aria-label="Platforms" className="border-y border-border py-6">
      <div className="container-page flex flex-col items-center gap-3 md:flex-row md:justify-between">
        <p className="eyebrow">Plan content for</p>
        <ul className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-lg font-bold text-muted-foreground">
          {platforms.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
