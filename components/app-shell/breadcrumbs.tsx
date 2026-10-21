"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, Suspense } from "react";
import { breadcrumbsFor, type Crumb } from "@/lib/app-shell/breadcrumbs";
import { Icon } from "./icons";

/** The pathname is request data under dynamic routes, so it sits behind Suspense like the nav. */
export function Breadcrumbs() {
  return (
    <Suspense fallback={<Trail crumbs={[{ label: "Dashboard" }]} />}>
      <ActiveTrail />
    </Suspense>
  );
}

function ActiveTrail() {
  return <Trail crumbs={breadcrumbsFor(usePathname())} />;
}

function Trail({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        {crumbs.map((crumb, index) => {
          const first = index === 0;
          const content = crumb.label;
          return (
            <Fragment key={crumb.label}>
              {first ? null : (
                <li aria-hidden="true" className="breadcrumbs-sep hidden md:flex">
                  <Icon name="chevron-right" size={12} />
                </li>
              )}
              {/* Ancestors stay visible from md; below it, only the current page shows. */}
              <li className={crumb.href ? "hidden md:flex" : "flex"}>
                {crumb.href ? (
                  <Link href={crumb.href} className="breadcrumbs-link">
                    {content}
                  </Link>
                ) : (
                  <span aria-current="page" className="breadcrumbs-current">
                    {content}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
