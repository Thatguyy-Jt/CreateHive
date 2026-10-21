import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

interface PageHeaderProps {
  icon: IconName;
  title: string;
  /** Lead text under the title. A node so a Suspense-bound greeting can sit here. */
  description?: ReactNode;
  /** Smaller supporting line under the description. */
  note?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}

/** Icon tile, title and description. Static: no data, so page shells still prerender. */
export function PageHeader({ icon, title, description, note, back, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      {back ? (
        <Link href={back.href} className="page-header-back">
          <Icon name="arrow-left" size={14} />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="icon-tile">
            <Icon name={icon} size={20} />
          </span>
          <div className="grid min-w-0 gap-1">
            <h1 className="break-words">{title}</h1>
            {description ? <div className="lead">{description}</div> : null}
            {note ? <p className="field-help max-w-3xl">{note}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
