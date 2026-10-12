import Image from "next/image";
import { creatorTypes } from "@/lib/marketing/sample-data";

export function Creators() {
  return (
    <section id="creators" className="section scroll-mt-20">
      <div className="container-page stack-lg">
        <div className="stack-sm max-w-2xl">
          <p className="eyebrow">Built for</p>
          <h2>
            Creators who are just <span className="accent-word">getting started</span>
          </h2>
          <p className="lead">
            You don&apos;t need a big audience or a team. CreateHive is designed for people
            building from zero.
          </p>
        </div>
        <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {creatorTypes.map((c) => (
            <li key={c.title} className="stack-sm">
              <div className="media-frame aspect-[4/5]">
                <Image
                  src={c.photo.src}
                  alt={c.photo.alt}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
              <h3 className="pt-2 text-xl">{c.title}</h3>
              <p className="text-muted-foreground">{c.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
