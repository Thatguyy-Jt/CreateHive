"use client";

import { useActionState, useState } from "react";
import { createBreakdownAction, type BreakdownFormState } from "@/app/app/breakdown/actions";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { TextAreaField, TextField } from "@/components/onboarding/fields";
import {
  COMMENTS_HINT,
  COUNT_FIELDS,
  fieldLabel,
  PLATFORM_GUIDES,
  TRANSCRIPT_HINT,
  VIEWS_REQUIRED,
  YOUTUBE_TRANSCRIPT_HINT,
  type ManualPlatform,
} from "@/lib/breakdown/platform-guides";
import { parseVideoUrl, URL_MESSAGES } from "@/lib/breakdown/url";
import { PLATFORM_LABELS, type Platform } from "@/lib/schemas/labels";
import { PlatformGuide } from "./platform-guide";

const EMPTY_VALUES: BreakdownFormState["values"] = {
  url: "",
  views: "",
  likes: "",
  comments: "",
  shares: "",
  saves: "",
  followers: "",
  duration: "",
  posted_on: "",
  caption: "",
  transcript: "",
  top_comments: "",
  note: "",
  target_platform: "",
};

const INITIAL: BreakdownFormState = {
  status: "idle",
  message: null,
  retryable: false,
  fieldErrors: {},
  values: EMPTY_VALUES,
  submission: 0,
};

// Lengths mirror lib/schemas/breakdown.ts (which imports Zod, so it stays server-side).
const CAPTION_MAX = 3_000;
const TRANSCRIPT_MAX = 8_000;
const NOTE_MAX = 500;

function chipText(platform: Platform, youtubeConfigured: boolean): string {
  if (platform === "youtube") {
    return youtubeConfigured
      ? "YouTube: we'll fetch the numbers for you."
      : "YouTube: we can't fetch numbers right now. Try again later.";
  }
  if (platform === "other") return "Another site: add the numbers you can see.";
  return `${PLATFORM_LABELS[platform]}: add the numbers you can see.`;
}

function ManualFields({
  platform,
  values,
  errors,
}: {
  platform: ManualPlatform;
  values: BreakdownFormState["values"];
  errors: BreakdownFormState["fieldErrors"];
}) {
  const guide = PLATFORM_GUIDES[platform];
  return (
    <fieldset className="stack-md">
      <legend className="field-label mb-2">The video&apos;s numbers</legend>
      <PlatformGuide platform={platform} />
      <div className="grid gap-4 min-[480px]:grid-cols-2">
        {COUNT_FIELDS.map((field) => (
          <TextField
            key={field}
            name={field}
            // Views are required where shown publicly; elsewhere the label already says "(if shown)".
            label={field === "views" ? fieldLabel(platform, field) : `${fieldLabel(platform, field)} (optional)`}
            help={guide.fields[field]}
            error={errors[field]}
            defaultValue={values[field]}
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 1.2K"
            required={field === "views" && VIEWS_REQUIRED.has(platform)}
          />
        ))}
        <TextField
          name="duration"
          label={`${fieldLabel(platform, "duration")} (optional)`}
          help={guide.fields.duration}
          error={errors.duration}
          defaultValue={values.duration}
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 0:45"
        />
        <TextField
          name="posted_on"
          label="Posted on (optional)"
          help="The day it was posted, if the platform shows it."
          error={errors.posted_on}
          defaultValue={values.posted_on}
          type="date"
        />
      </div>
    </fieldset>
  );
}

function FormBody({
  state,
  platforms,
  youtubeConfigured,
}: {
  state: BreakdownFormState;
  platforms: readonly Platform[];
  youtubeConfigured: boolean;
}) {
  const { values, fieldErrors } = state;
  const [url, setUrl] = useState(values.url);

  const parsed = parseVideoUrl(url);
  const platform = parsed.ok ? parsed.platform : null;
  const extraErrors = Boolean(fieldErrors.caption || fieldErrors.transcript || fieldErrors.note);
  const extraOpen = extraErrors || Boolean(values.caption || values.transcript || values.top_comments || values.note);

  return (
    <>
      <div className="stack-sm">
        <TextField
          name="url"
          label="Link to the video"
          help="Paste the full link from your browser or the app's Share → Copy link."
          error={fieldErrors.url}
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.youtube.com/watch?v=…"
          required
        />
        {platform ? (
          <p className="text-sm" aria-live="polite">
            <span className="rounded-pill border border-border px-3 py-0.5 font-semibold">{PLATFORM_LABELS[platform]}</span>{" "}
            <span className="text-muted-foreground">{chipText(platform, youtubeConfigured)}</span>
          </p>
        ) : null}
        {!parsed.ok && parsed.code === "short_link" && !fieldErrors.url ? (
          <p role="status" className="alert text-sm font-semibold">
            {URL_MESSAGES.short_link}
          </p>
        ) : null}
      </div>

      {platform && platform !== "youtube" ? <ManualFields platform={platform} values={values} errors={fieldErrors} /> : null}

      <details className="stack-sm" open={extraOpen}>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Add more for a better breakdown</summary>
        <div className="stack-md pt-2">
          <TextAreaField
            name="caption"
            label="Caption or description (optional)"
            help="Copy it from under the video."
            error={fieldErrors.caption}
            defaultValue={values.caption}
            rows={4}
            maxLength={CAPTION_MAX}
          />
          <TextAreaField
            name="transcript"
            label="What's said in the video (optional)"
            help={platform === "youtube" ? YOUTUBE_TRANSCRIPT_HINT : TRANSCRIPT_HINT}
            error={fieldErrors.transcript}
            defaultValue={values.transcript}
            rows={5}
            maxLength={TRANSCRIPT_MAX}
          />
          <TextAreaField
            name="top_comments"
            label="Top comments (optional)"
            help={
              platform === "youtube"
                ? `We read YouTube's top comments for you. To pick your own: ${COMMENTS_HINT.toLowerCase()}`
                : COMMENTS_HINT
            }
            error={fieldErrors.top_comments}
            defaultValue={values.top_comments}
            rows={5}
          />
          <TextAreaField
            name="note"
            label="What caught your eye? (optional)"
            help="For example: “the first 3 seconds” or “how they ended it”."
            error={fieldErrors.note}
            defaultValue={values.note}
            rows={2}
            maxLength={NOTE_MAX}
          />
        </div>
      </details>

      <div className="field">
        <label htmlFor="target_platform" className="field-label">
          Make my version for
        </label>
        <select
          id="target_platform"
          name="target_platform"
          className="select"
          defaultValue={values.target_platform}
          aria-invalid={fieldErrors.target_platform ? true : undefined}
          aria-describedby={fieldErrors.target_platform ? "target_platform-error" : undefined}
        >
          <option value="">The video&apos;s platform, if I post there ({PLATFORM_LABELS[platforms[0]]} otherwise)</option>
          {platforms.map((value) => (
            <option key={value} value={value}>
              {PLATFORM_LABELS[value]}
            </option>
          ))}
        </select>
        {fieldErrors.target_platform ? (
          <p id="target_platform-error" className="field-error">
            {fieldErrors.target_platform}
          </p>
        ) : null}
      </div>
    </>
  );
}

/** Paste a link, add what we can't fetch, get a breakdown. Success opens it; errors keep the creator's text. */
export function BreakdownForm({
  platforms,
  used,
  limit,
  youtubeConfigured,
}: {
  platforms: readonly Platform[];
  used: number;
  limit: number;
  youtubeConfigured: boolean;
}) {
  const [state, action, pending] = useActionState(createBreakdownAction, INITIAL);
  const left = Math.max(0, limit - used);

  return (
    <section className="card stack-md" aria-labelledby="breakdown-new">
      <div className="stack-sm">
        <h2 id="breakdown-new" className="text-heading">
          Break down a video
        </h2>
        <p className="text-muted-foreground">
          Paste a link to any public video. We&apos;ll show why it likely worked and how to make your own version.
        </p>
      </div>
      <form key={state.submission} action={action} className="stack-md" aria-busy={pending} noValidate>
        <FormBody state={state} platforms={platforms} youtubeConfigured={youtubeConfigured} />
        {state.status === "error" && state.message ? (
          <div role="alert" className="alert stack-sm text-sm">
            <p className="font-semibold">{state.message}</p>
            {state.upgrade ? <UpgradeButton /> : null}
          </div>
        ) : null}
        <div className="stack-sm">
          <div>
            <button type="submit" className="btn btn-primary w-full min-[480px]:w-auto" disabled={pending || left === 0}>
              {pending ? "Breaking it down…" : state.status === "error" && state.retryable ? "Try again" : "Break it down"}
            </button>
          </div>
          <p className="field-help" aria-live="polite">
            {pending
              ? "This can take up to a minute."
              : left === 0
                ? "You've used this month's breakdowns. They free up as older ones pass 30 days."
                : `${left} of ${limit} breakdowns left this month.`}
          </p>
        </div>
      </form>
    </section>
  );
}
