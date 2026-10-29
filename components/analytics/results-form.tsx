"use client";

import { addResultsAction } from "@/app/app/analytics/actions";
import { RESULT_FIELD_LABELS, type ResultField } from "@/lib/schemas/labels";
import { Field, FormAlert } from "./fields";
import { useAnalyticsForm } from "./use-analytics-form";

const COUNT_FIELDS: readonly ResultField[] = ["views", "likes", "comments", "shares", "saves"];

const HELP: Partial<Record<ResultField, string>> = {
  follower_delta: "Followers gained since posting. Use - for a loss.",
  avg_view_duration_seconds: "In seconds, or as m:ss.",
  avg_percent_viewed: "0 to 100.",
};

/** One results check-in. Every field is optional, but at least one is needed. Resets after saving. */
export function ResultsForm({ itemId, video }: { itemId: string; video: boolean }) {
  const [state, action, pending] = useAnalyticsForm(addResultsAction, "Results saved");
  const values = state.status === "error" ? state.values : {};
  const prefix = `results-${itemId}`;
  const input = (name: ResultField, inputMode: "numeric" | "decimal" | "text") => (
    <Field
      key={name}
      prefix={prefix}
      name={name}
      label={RESULT_FIELD_LABELS[name]}
      help={HELP[name]}
      inputMode={inputMode}
      autoComplete="off"
      className="input tabular-nums"
      defaultValue={values[name] ?? ""}
      error={state.fieldErrors[name]}
    />
  );

  return (
    <form key={state.submission} action={action} className="stack-sm" aria-busy={pending}>
      <input type="hidden" name="item_id" value={itemId} />
      <div className="grid gap-3 min-[480px]:grid-cols-2">
        {COUNT_FIELDS.map((name) => input(name, "numeric"))}
        {input("follower_delta", "text")}
        {video ? (
          <>
            {input("avg_view_duration_seconds", "text")}
            {input("avg_percent_viewed", "decimal")}
          </>
        ) : null}
      </div>
      <FormAlert message={state.status === "error" ? state.message : null} />
      <div>
        <button type="submit" className="btn btn-primary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
          {pending ? "Saving…" : "Save results"}
        </button>
      </div>
    </form>
  );
}
