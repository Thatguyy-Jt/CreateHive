"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Platform } from "@/lib/schemas/creator";
import type { SectionKey, SectionValue } from "@/lib/schemas/studio";
import { CopyButton } from "./copy-button";
import { RegenerateSectionForm } from "./regenerate-section-form";
import { SectionEditor } from "./section-editor";

/** What a section needs to be edited or regenerated. Absent when previewing an old version or read-only. */
export interface EditContext {
  itemId: string;
  /** The version being edited; a save against a newer one is a conflict. */
  baseVersion: number;
  platforms: Platform[];
  regenerable: SectionKey[];
}

/**
 * One package section: heading row with Copy, Edit and Regenerate, and the
 * server-rendered view (`children`) or its editor. Text only.
 */
export function SectionCard({
  section,
  title,
  copyText,
  value,
  edit,
  children,
}: {
  section: SectionKey;
  title: string;
  copyText: string;
  value: SectionValue;
  edit: EditContext | null;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const headingId = `package-${section}`;
  const label = title.toLowerCase();

  // After Save or Cancel, focus goes back to the Edit button.
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  return (
    <section className="card stack-sm" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id={headingId} className="text-heading">
          {title}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={copyText} label={label} />
          {edit && !editing ? (
            <button
              ref={editButton}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setEditing(true)}
              aria-label={`Edit ${label}`}
            >
              Edit
            </button>
          ) : null}
        </div>
      </div>

      {edit && editing ? (
        <SectionEditor
          section={section}
          title={title}
          value={value}
          itemId={edit.itemId}
          baseVersion={edit.baseVersion}
          platforms={edit.platforms}
          onDone={() => setEditing(false)}
        />
      ) : (
        children
      )}

      {edit && !editing && edit.regenerable.includes(section) ? (
        <RegenerateSectionForm itemId={edit.itemId} section={section} title={title} baseVersion={edit.baseVersion} />
      ) : null}
    </section>
  );
}
