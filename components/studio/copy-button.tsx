"use client";

import { useState } from "react";
import { toast } from "sonner";

/** Copies one section as plain text. Success toasts; a blocked clipboard says so inline. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      toast.success(`Copied ${label}`);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {failed ? (
        <p role="alert" className="field-help">
          Couldn&apos;t copy. Select the text and copy it instead.
        </p>
      ) : null}
      <button type="button" className="btn btn-secondary btn-sm" onClick={copy} aria-label={`Copy ${label}`}>
        Copy
      </button>
    </div>
  );
}
