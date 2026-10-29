import { DEFAULT_TIME } from "@/lib/schemas/limits";

/** Native, labelled date and time inputs: accessible and mobile-friendly. Ids are prefixed to stay unique. */
export function DateTimeFields({
  id,
  defaultDate,
  defaultTime = DEFAULT_TIME,
  min,
  max,
}: {
  id: string;
  defaultDate: string;
  defaultTime?: string;
  min: string;
  max: string;
}) {
  return (
    <div className="grid gap-3 min-[480px]:grid-cols-2">
      <div className="field">
        <label htmlFor={`${id}-date`} className="field-label text-sm">
          Date
        </label>
        <input
          id={`${id}-date`}
          name="date"
          type="date"
          className="input"
          defaultValue={defaultDate}
          min={min}
          max={max}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-time`} className="field-label text-sm">
          Time
        </label>
        <input id={`${id}-time`} name="time" type="time" className="input" defaultValue={defaultTime} required />
      </div>
    </div>
  );
}
