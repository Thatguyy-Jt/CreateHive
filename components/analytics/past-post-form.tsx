"use client";

import { logPastPostAction } from "@/app/app/analytics/actions";
import { FORMAT_MAX, TITLE_MAX } from "@/lib/schemas/limits";
import { Field, FormAlert, PlatformField, PostDateFields, PostDetailFields } from "./fields";
import { useAnalyticsForm } from "./use-analytics-form";

/** Logs a post made outside the app. Success goes to its post page. */
export function PastPostForm({
  defaultDate,
  defaultPlatform,
  min,
  max,
}: {
  defaultDate: string;
  defaultPlatform: string | null;
  min: string;
  max: string;
}) {
  const [state, action, pending] = useAnalyticsForm(logPastPostAction);
  const values = state.status === "error" ? state.values : {};
  const errors = state.fieldErrors;
  const prefix = "past-post";

  return (
    <form key={state.submission} action={action} className="stack-sm" aria-busy={pending}>
      <Field
        prefix={prefix}
        name="title"
        label="Title"
        help="What the post was called, or what it was about."
        required
        minLength={2}
        maxLength={TITLE_MAX}
        defaultValue={values.title ?? ""}
        error={errors.title}
      />
      <div className="grid gap-3 min-[480px]:grid-cols-2">
        <PlatformField prefix={prefix} defaultValue={values.platform ?? defaultPlatform ?? undefined} error={errors.platform} />
        <Field
          prefix={prefix}
          name="format"
          label="Format (optional)"
          placeholder="Short, carousel, long-form…"
          maxLength={FORMAT_MAX}
          defaultValue={values.format ?? ""}
          error={errors.format}
        />
      </div>
      <PostDateFields
        prefix={prefix}
        defaultDate={values.date ?? defaultDate}
        defaultTime={values.time ?? "12:00"}
        min={min}
        max={max}
        errors={errors}
      />
      {/* The length is kept only for video formats; the server drops it otherwise. */}
      <PostDetailFields prefix={prefix} video values={values} errors={errors} />
      <FormAlert message={state.status === "error" ? state.message : null} />
      <div>
        <button type="submit" className="btn btn-primary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
          {pending ? "Saving…" : "Log post"}
        </button>
      </div>
    </form>
  );
}
