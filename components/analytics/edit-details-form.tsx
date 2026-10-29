"use client";

import { updatePostDetailsAction } from "@/app/app/analytics/actions";
import { FORMAT_MAX, TITLE_MAX } from "@/lib/schemas/limits";
import { Field, FormAlert, PlatformField, PostDateFields, PostDetailFields } from "./fields";
import { useAnalyticsForm } from "./use-analytics-form";

/**
 * A post's details, collapsed until opened. Posts logged outside Studio
 * (`identity`) can also change title, platform and format.
 */
export function EditDetailsForm({
  itemId,
  identity,
  video,
  defaults,
  min,
  max,
}: {
  itemId: string;
  identity: boolean;
  video: boolean;
  defaults: Record<string, string>;
  min: string;
  max: string;
}) {
  const [state, action, pending] = useAnalyticsForm(updatePostDetailsAction, "Details saved");
  const values = state.status === "error" ? state.values : defaults;
  const errors = state.fieldErrors;
  const prefix = `edit-${itemId}`;

  return (
    <details className="card stack-sm" open={state.status === "error" ? true : undefined}>
      <summary className="min-h-11 cursor-pointer content-center text-heading">Edit details</summary>
      <form key={state.submission} action={action} className="stack-sm pt-2" aria-busy={pending}>
        <input type="hidden" name="item_id" value={itemId} />
        {identity ? (
          <>
            <Field
              prefix={prefix}
              name="title"
              label="Title"
              required
              minLength={2}
              maxLength={TITLE_MAX}
              defaultValue={values.title ?? ""}
              error={errors.title}
            />
            <div className="grid gap-3 min-[480px]:grid-cols-2">
              <PlatformField prefix={prefix} defaultValue={values.platform} error={errors.platform} />
              <Field
                prefix={prefix}
                name="format"
                label="Format (optional)"
                maxLength={FORMAT_MAX}
                defaultValue={values.format ?? ""}
                error={errors.format}
              />
            </div>
          </>
        ) : null}
        <PostDateFields
          prefix={prefix}
          defaultDate={values.date ?? ""}
          defaultTime={values.time ?? ""}
          min={min}
          max={max}
          errors={errors}
        />
        <PostDetailFields prefix={prefix} video={identity || video} values={values} errors={errors} />
        <FormAlert message={state.status === "error" ? state.message : null} />
        <div>
          <button type="submit" className="btn btn-secondary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
            {pending ? "Saving…" : "Save details"}
          </button>
        </div>
      </form>
    </details>
  );
}
