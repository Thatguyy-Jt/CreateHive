import type { ReactNode } from "react";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import { pickSection, SECTION_LABELS, sectionTexts, type SectionKey, type StudioPackage } from "@/lib/schemas/studio";
import { SectionCard, type EditContext } from "./section-card";

function Choices({ items }: { items: StudioPackage["titles"] }) {
  return (
    <ol className="stack-sm list-decimal pl-5">
      {items.map((item, index) => (
        <li key={index} className="break-words">
          <p className="font-bold">{item.text}</p>
          <p className="field-help">{item.why}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * The package as a production sheet, in the order a creator uses it. With
 * `edit`, each section can be edited and regenerated; without it (an old
 * version, or a read-only item) it only copies. Text only: React escapes everything.
 */
export function PackageSections({ pkg, edit }: { pkg: StudioPackage; edit: EditContext | null }) {
  const text = sectionTexts(pkg);
  const card = (section: SectionKey, children: ReactNode) => (
    <SectionCard
      key={section}
      section={section}
      title={SECTION_LABELS[section]}
      copyText={text[section]}
      value={pickSection(pkg, section)}
      edit={edit}
    >
      {children}
    </SectionCard>
  );

  // A section with nothing in it is shown only when it can be filled in.
  const canFill = (section: SectionKey) => edit !== null && edit.regenerable.includes(section);

  return (
    <div className="stack-lg">
      {card("titles", <Choices items={pkg.titles} />)}

      {card("hooks", <Choices items={pkg.hooks} />)}

      {card(
        "script",
        <ol className="stack-md list-decimal pl-5">
          {pkg.script.beats.map((beat, index) => (
            <li key={index} className="stack-sm break-words">
              <p className="font-bold">{beat.label}</p>
              <p className="whitespace-pre-line">
                <span className="sr-only">Say: </span>
                {beat.say}
              </p>
              {beat.show ? (
                <p className="whitespace-pre-line text-muted-foreground">
                  <span className="font-semibold">Show:</span> {beat.show}
                </p>
              ) : null}
            </li>
          ))}
        </ol>,
      )}

      {pkg.shot_list.length || canFill("shot_list")
        ? card(
            "shot_list",
            pkg.shot_list.length ? (
              <ol className="stack-sm list-decimal pl-5">
                {pkg.shot_list.map((shot, index) => (
                  <li key={index} className="break-words">
                    {shot.shot}
                    {shot.notes ? <span className="block field-help">{shot.notes}</span> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground">No shots yet.</p>
            ),
          )
        : null}

      {card(
        "caption",
        <>
          <p className="whitespace-pre-line break-words">{pkg.caption}</p>
          {pkg.hashtags.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Hashtags">
              {pkg.hashtags.map((tag) => (
                <li key={tag} className="rounded-pill border border-border px-3 py-1 text-sm break-all">
                  #{tag}
                </li>
              ))}
            </ul>
          ) : null}
        </>,
      )}

      {card("cta", <p className="break-words">{pkg.cta}</p>)}

      {pkg.thumbnail || canFill("thumbnail")
        ? card(
            "thumbnail",
            pkg.thumbnail ? (
              <>
                <p className="break-words">{pkg.thumbnail.concept}</p>
                {pkg.thumbnail.overlay_text ? (
                  <p className="break-words">
                    <span className="font-semibold">Text on image:</span> {pkg.thumbnail.overlay_text}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground">No thumbnail yet.</p>
            ),
          )
        : null}

      {pkg.repurposing.length || edit
        ? card(
            "repurposing",
            pkg.repurposing.length ? (
              <ul className="stack-sm">
                {pkg.repurposing.map((item, index) => (
                  <li key={index} className="break-words">
                    <p className="font-bold">
                      {PLATFORM_LABELS[item.platform]} · {item.format}
                    </p>
                    <p className="text-muted-foreground">{item.adaptation}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No repurposing ideas yet.</p>
            ),
          )
        : null}
    </div>
  );
}
