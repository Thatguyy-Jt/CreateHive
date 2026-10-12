import Image from "next/image";
import { photos } from "@/lib/marketing/sample-data";
import { AuthActions } from "./auth-actions";
import { OpportunityCard, TodaysPlanCard } from "./mockups";

export function Hero() {
  return (
    <section className="hero-backdrop section overflow-x-clip">
      <div className="container-page grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div className="stack-md">
          <p className="eyebrow">AI strategist for creators</p>
          <h1 className="text-display-xl">
            Know what to post <span className="accent-word">next</span>, and why it works
          </h1>
          <p className="lead max-w-xl">
            CreateHive learns your niche, your audience and your results, then tells you what to
            make, how to make it and what to try next.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <AuthActions size="lg" />
            <a href="#how-it-works" className="btn btn-secondary btn-lg">
              See how it works
            </a>
          </div>
          <p className="text-sm text-muted-foreground">
            In early development. Product previews below use sample data.
          </p>
        </div>

        <div className="relative lg:pb-10 lg:pl-10">
          <div className="media-frame media-frame-offset aspect-[4/3] lg:aspect-[4/5]">
            <Image
              src={photos.hero.src}
              alt={photos.hero.alt}
              fill
              priority
              sizes="(min-width: 1024px) 34rem, 100vw"
              className="object-cover"
            />
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:mt-0 lg:block">
            <TodaysPlanCard className="shadow-float lg:absolute lg:bottom-0 lg:left-0 lg:w-64" />
            <OpportunityCard
              compact
              className="shadow-float lg:absolute lg:top-8 lg:-right-4 lg:w-72"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
