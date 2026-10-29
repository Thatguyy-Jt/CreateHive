"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { addSignalAction, type AddSignalState } from "@/app/app/research/actions";
import { SelectField, TextAreaField, TextField } from "@/components/onboarding/fields";
import { MANUAL_SIGNAL_TYPES, SIGNAL_TYPE_LABELS } from "@/lib/schemas/labels";
import { MANUAL_TEXT_MAX } from "@/lib/schemas/limits";

const INITIAL: AddSignalState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  values: { type: "", text: "", label: "", source_url: "" },
  submission: 0,
};

const TYPE_OPTIONS = MANUAL_SIGNAL_TYPES.map((value) => ({ value, label: SIGNAL_TYPE_LABELS[value] }));

function TextWithCounter({ defaultValue, error }: { defaultValue: string; error?: string }) {
  const [length, setLength] = useState(defaultValue.length);
  return (
    <div className="stack-sm">
      <TextAreaField
        name="text"
        label="The signal"
        help="Paste a comment, describe what a competitor did, or write your own note. Remove names and handles before you paste."
        error={error}
        defaultValue={defaultValue}
        rows={5}
        maxLength={MANUAL_TEXT_MAX}
        required
        onChange={(event) => setLength(event.currentTarget.value.length)}
      />
      <p className="field-help text-right" aria-live="polite">
        {length.toLocaleString("en-US")} / {MANUAL_TEXT_MAX.toLocaleString("en-US")}
      </p>
    </div>
  );
}

/** Adds a pasted signal. Keeps the creator's text on failure; clears and toasts on success. */
export function AddSignalForm() {
  const [state, action, pending] = useActionState(addSignalAction, INITIAL);
  // Strict Mode runs effects twice in development; toast each result once.
  const toasted = useRef<AddSignalState | null>(null);

  useEffect(() => {
    if (state.status !== "ok" || toasted.current === state) return;
    toasted.current = state;
    toast.success("Signal added");
  }, [state]);

  const { values, fieldErrors } = state;

  return (
    <section className="card stack-sm" aria-labelledby="research-add">
      <h2 id="research-add" className="text-heading">
        Add a signal
      </h2>
      <form key={state.submission} action={action} className="stack-md" noValidate>
        <SelectField
          name="type"
          label="What is it?"
          placeholder="Choose a type"
          options={TYPE_OPTIONS}
          defaultValue={values.type}
          error={fieldErrors.type}
        />
        <TextWithCounter defaultValue={values.text} error={fieldErrors.text} />
        <TextField
          name="label"
          label="Short label (optional)"
          help="So you can recognise it later, e.g. “Comment on my squat video”."
          defaultValue={values.label}
          error={fieldErrors.label}
          maxLength={120}
        />
        <TextField
          name="source_url"
          label="Link to the source (optional)"
          help="A full https:// link. We store and show it; we never visit it."
          type="url"
          inputMode="url"
          defaultValue={values.source_url}
          error={fieldErrors.source_url}
        />
        {state.status === "error" && state.message ? (
          <div role="alert" className="alert">
            <p className="font-semibold">{state.message}</p>
          </div>
        ) : null}
        <div>
          <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
            {pending ? "Adding…" : "Add signal"}
          </button>
        </div>
      </form>
    </section>
  );
}
