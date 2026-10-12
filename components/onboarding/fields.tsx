import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

// Labelled form controls built on the `.field` primitives. Help and error text
// are linked with aria-describedby; errored controls get aria-invalid so the
// form can move focus to the first one.

interface FieldText {
  name: string;
  label: string;
  help?: string;
  error?: string;
}

function describedBy(name: string, help?: string, error?: string) {
  const ids = [help ? `${name}-help` : null, error ? `${name}-error` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

function FieldMessages({ name, error }: { name: string; error?: string }) {
  return error ? (
    <p id={`${name}-error`} className="field-error">
      {error}
    </p>
  ) : null;
}

export function TextField({
  name,
  label,
  help,
  error,
  ...input
}: FieldText & Omit<InputHTMLAttributes<HTMLInputElement>, "name">) {
  return (
    <div className="field">
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      {help ? (
        <p id={`${name}-help`} className="field-help">
          {help}
        </p>
      ) : null}
      <input
        id={name}
        name={name}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, help, error)}
        {...input}
      />
      <FieldMessages name={name} error={error} />
    </div>
  );
}

export function TextAreaField({
  name,
  label,
  help,
  error,
  ...textarea
}: FieldText & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "name">) {
  return (
    <div className="field">
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      {help ? (
        <p id={`${name}-help`} className="field-help">
          {help}
        </p>
      ) : null}
      <textarea
        id={name}
        name={name}
        className="textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, help, error)}
        {...textarea}
      />
      <FieldMessages name={name} error={error} />
    </div>
  );
}

export function SelectField({
  name,
  label,
  help,
  error,
  options,
  defaultValue,
  placeholder,
}: FieldText & { options: { value: string; label: string }[]; defaultValue?: string; placeholder: string }) {
  return (
    <div className="field">
      <label htmlFor={name} className="field-label">
        {label}
      </label>
      {help ? (
        <p id={`${name}-help`} className="field-help">
          {help}
        </p>
      ) : null}
      <select
        id={name}
        name={name}
        className="select"
        defaultValue={defaultValue ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, help, error)}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldMessages name={name} error={error} />
    </div>
  );
}

/** Multi-select as toggle chips backed by real checkboxes in a fieldset. */
export function ChipGroup({
  name,
  label,
  help,
  error,
  options,
  defaultValues = [],
}: FieldText & { options: { value: string; label: string }[]; defaultValues?: readonly string[] }) {
  return (
    <fieldset className="field" aria-describedby={describedBy(name, help, error)}>
      <legend className="field-label mb-1.5">{label}</legend>
      {help ? (
        <p id={`${name}-help`} className="field-help">
          {help}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="chip">
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={defaultValues.includes(option.value)}
              aria-invalid={error ? true : undefined}
            />
            {option.label}
          </label>
        ))}
      </div>
      <FieldMessages name={name} error={error} />
    </fieldset>
  );
}
