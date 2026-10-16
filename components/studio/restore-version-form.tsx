"use client";

import { useActionState } from "react";
import { restoreVersionAction, type VersionActionState } from "@/app/app/studio/actions";

const IDLE: VersionActionState = { status: "idle", message: null };

/** Restores the previewed version as the newest one. Success goes back to the latest; errors stay inline. */
export function RestoreVersionForm({
  itemId,
  versionNo,
  baseVersion,
}: {
  itemId: string;
  versionNo: number;
  baseVersion: number;
}) {
  const [state, action, pending] = useActionState(restoreVersionAction, IDLE);
  return (
    <form action={action} className="stack-sm" aria-busy={pending}>
      <input type="hidden" name="item_id" value={itemId} />
      <input type="hidden" name="version_no" value={versionNo} />
      <input type="hidden" name="base_version" value={baseVersion} />
      <div>
        <button type="submit" className="btn btn-primary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
          {pending ? "Restoring…" : "Restore this version"}
        </button>
      </div>
      {state.status === "error" && state.message ? (
        <p role="alert" className="alert text-sm font-semibold">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
