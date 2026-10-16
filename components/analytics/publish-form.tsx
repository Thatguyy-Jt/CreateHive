"use client";

import { publishStudioItemAction } from "@/app/app/analytics/actions";
import { FormAlert, PostDateFields, PostDetailFields } from "./fields";
import { useAnalyticsForm } from "./use-analytics-form";

/** Marks a Studio item as published. Success goes to its post page; errors stay inline with what was typed. */
export function PublishForm({
  itemId,
  defaultDate,
  defaultTime,
  defaultHook,
  min,
  max,
  video,
}: {
  itemId: string;
  defaultDate: string;
  defaultTime: string;
  defaultHook: string | null;
  min: string;
  max: string;
  video: boolean;
}) {
  const [state, action, pending] = useAnalyticsForm(publishStudioItemAction);
  const values = state.status === "error" ? state.values : { hook_used: defaultHook ?? "" };
  const prefix = `publish-${itemId}`;

  return (
    // Remounts after each failed submit, so the fields show what was sent.
    <form key={state.submission} action={action} className="stack-sm" aria-busy={pending}>
      <input type="hidden" name="item_id" value={itemId} />
      <PostDateFields
        prefix={prefix}
        defaultDate={values.date ?? defaultDate}
        defaultTime={values.time ?? defaultTime}
        min={min}
        max={max}
        errors={state.fieldErrors}
      />
      <PostDetailFields prefix={prefix} video={video} values={values} errors={state.fieldErrors} />
      <FormAlert message={state.status === "error" ? state.message : null} />
      <div>
        <button type="submit" className="btn btn-primary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
          {pending ? "Saving…" : "Mark as published"}
        </button>
      </div>
    </form>
  );
}
