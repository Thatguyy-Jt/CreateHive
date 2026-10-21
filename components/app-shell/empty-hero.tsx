import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

// Decorative tiles around the edge. Positions are percentages of the panel;
// only the first two show on small screens.
const TILES: { icon: IconName; pos: string }[] = [
  { icon: "search", pos: "left-[8%] top-[10%]" },
  { icon: "target", pos: "right-[8%] bottom-[14%]" },
  { icon: "chart", pos: "right-[14%] top-[16%]" },
  { icon: "sparkle", pos: "left-[12%] bottom-[12%]" },
  { icon: "lightbulb", pos: "left-[26%] top-[62%]" },
];

/** A top-level "nothing here yet" panel: soft prism wash, decorative tiles, one message and one action. */
export function EmptyHero({
  title,
  titleId,
  children,
  action,
}: {
  title: string;
  titleId: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel-hero" aria-labelledby={titleId}>
      {TILES.map((tile, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`hero-tile ${tile.pos} ${index > 1 ? "hidden sm:grid" : "grid"}`}
          style={{ transitionDelay: `${index * 50}ms` }}
        >
          <Icon name={tile.icon} size={20} />
        </span>
      ))}
      <div className="relative mx-auto flex max-w-md flex-col items-center gap-3 text-center">
        <h2 id={titleId} className="panel-hero-title">
          {title}
        </h2>
        <div className="text-muted-foreground">{children}</div>
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </section>
  );
}
