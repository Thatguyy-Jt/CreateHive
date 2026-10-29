import type { InputHTMLAttributes, ReactNode } from "react";
import { PLATFORM_LABELS, PLATFORMS } from "@/lib/schemas/labels";

// Labelled controls for the analytics forms. Ids are prefixed so two forms can
// share a page; help and error text are linked with aria-describedby.

interface FieldProps {
  /** Unique per page: the control's id is `${prefix}-${name}`. */
  prefix: string;
  name: string;
  label: string;
  help?: string;
  error?: string;
}

function describedBy(id: string, help?: string, error?: string) {
  const ids = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

function Wrapper({ id, label, help, error, children }: { id: string; label: string; help?: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id} className="field-label text-sm">
        {label}
      </label>
      {help ? (
        <p id={`${id}-help`} className="field-help">
          {help}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Field({ prefix, name, label, help, error, ...input }: FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "id">) {
  const id = `${prefix}-${name}`;
  return (
    <Wrapper id={id} label={label} help={help} error={error}>
      <input
        id={id}
        name={name}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, help, error)}
        {...input}
      />
    </Wrapper>
  );
}

export function PlatformField({ prefix, error, defaultValue }: { prefix: string; error?: string; defaultValue?: string }) {
  const id = `${prefix}-platform`;
  return (
    <Wrapper id={id} label="Platform" error={error}>
      <select
        id={id}
        name="platform"
        className="input"
        defaultValue={defaultValue ?? ""}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, undefined, error)}
      >
        <option value="" disabled>
          Choose a platform
        </option>
        {PLATFORMS.map((option) => (
          <option key={option} value={option}>
            {PLATFORM_LABELS[option]}
          </option>
        ))}
      </select>
    </Wrapper>
  );
}

/** Date and time of a post, with field errors. Native inputs: accessible and mobile-friendly. */
export function PostDateFields({
  prefix,
  defaultDate,
  defaultTime,
  min,
  max,
  errors,
}: {
  prefix: string;
  defaultDate: string;
  defaultTime: string;
  min: string;
  max: string;
  errors: Record<string, string>;
}) {
  return (
    <div className="grid gap-3 min-[480px]:grid-cols-2">
      <Field prefix={prefix} name="date" label="Date posted" type="date" defaultValue={defaultDate} min={min} max={max} required error={errors.date} />
      <Field prefix={prefix} name="time" label="Time" type="time" defaultValue={defaultTime} required error={errors.time} />
    </div>
  );
}

/** Link, hook used and (for video) length: shared by publish, past post and edit. */
export function PostDetailFields({
  prefix,
  video,
  values,
  errors,
}: {
  prefix: string;
  /** Show the length field. */
  video: boolean;
  values: Record<string, string>;
  errors: Record<string, string>;
}) {
  return (
    <>
      <Field
        prefix={prefix}
        name="published_url"
        label="Link to the post (optional)"
        type="url"
        inputMode="url"
        placeholder="https://"
        maxLength={500}
        defaultValue={values.published_url ?? ""}
        error={errors.published_url}
      />
      <Field
        prefix={prefix}
        name="hook_used"
        label="Hook you used (optional)"
        help="The opening line as you actually said or wrote it."
        maxLength={300}
        defaultValue={values.hook_used ?? ""}
        error={errors.hook_used}
      />
      {video ? (
        <Field
          prefix={prefix}
          name="duration_seconds"
          label="Length (optional)"
          help="In seconds, or as m:ss, for example 0:45."
          inputMode="numeric"
          className="input max-w-40"
          defaultValue={values.duration_seconds ?? ""}
          error={errors.duration_seconds}
        />
      ) : null}
    </>
  );
}

export function FormAlert({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="alert text-sm font-semibold">
      {message}
    </p>
  ) : null;
}
