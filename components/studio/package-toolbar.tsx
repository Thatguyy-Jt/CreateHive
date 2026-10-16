"use client";

import { useState } from "react";
import { toast } from "sonner";

/** Copy all and Download for the whole package, as plain text. No server call. */
export function PackageToolbar({ text, fileName }: { text: string; fileName: string }) {
  const [failed, setFailed] = useState(false);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      toast.success("Copied the whole package");
    } catch {
      setFailed(true);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-secondary btn-sm" onClick={copyAll}>
        Copy all
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={download}>
        Download
      </button>
      {failed ? (
        <p role="alert" className="field-help">
          Couldn&apos;t copy. Use Download instead.
        </p>
      ) : null}
    </div>
  );
}
