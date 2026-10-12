import Image from "next/image";
import { features, photos } from "@/lib/marketing/sample-data";
import { BaselineCard, ContentPackageCard, OpportunityCard, PillarsCard } from "./mockups";

const sectionTone = ["", "section-tint-sky", "", "section-tint-lilac"];

// Photo with a mockup card overlapping it. The card overlaps the photo on
// mobile/tablet and slides into the column gap from lg up, never toward the page edge.
function PhotoWithCard({
  photo,
  card,
}: {
  photo: { src: string; alt: string };
  card: React.ReactNode;
}) {
  return (
    <div className="relative lg:mb-16">
      <div className="media-frame aspect-[4/3]">
        <Image src={photo.src} alt={photo.alt} fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
      </div>
      <div className="relative mx-4 -mt-16 sm:mx-10 md:mx-4 lg:absolute lg:-bottom-16 lg:-left-8 lg:mx-0 lg:mt-0 lg:w-[min(22rem,90%)]">
        {card}
      </div>
    </div>
  );
}

const media: Record<(typeof features)[number]["id"], React.ReactNode> = {
  strategy: <PhotoWithCard photo={photos.strategy} card={<PillarsCard className="shadow-float" />} />,
  opportunities: <OpportunityCard className="card-offset" />,
  studio: <PhotoWithCard photo={photos.studio} card={<ContentPackageCard className="shadow-float" />} />,
  analytics: <BaselineCard className="card-offset" />,
};

export function FeatureSplits() {
  return (
    <div id="features" className="scroll-mt-20">
      {features.map((f, i) => (
        <section
          key={f.id}
          aria-labelledby={`feature-${f.id}`}
          className={`section ${sectionTone[i]}`}
        >
          <div className={`container-page split ${i % 2 === 1 ? "split-reverse" : ""}`}>
            <div className="stack-md">
              <p className="eyebrow">{f.eyebrow}</p>
              <h2 id={`feature-${f.id}`}>
                {f.title[0]} <span className="accent-word">{f.title[1]}</span>
                {f.title[2] ? ` ${f.title[2]}` : ""}
              </h2>
              <p className="lead">{f.lead}</p>
              <ul className="grid gap-3">
                {f.points.map((point) => (
                  <li key={point} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground"
                    >
                      ✓
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div>{media[f.id]}</div>
          </div>
        </section>
      ))}
    </div>
  );
}
