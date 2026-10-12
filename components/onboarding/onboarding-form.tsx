"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { saveProfileAction, saveVoiceAction, type OnboardingFormState } from "@/app/onboarding/actions";
import {
  EXPERIENCE_LABELS,
  GOAL_LABELS,
  PLATFORM_LABELS,
  creatorGoal,
  platform,
} from "@/lib/schemas/creator";
import { experienceLevel } from "@/lib/schemas/enums";
import type { BrandProfileRow, CreatorProfileRow } from "@/lib/services/creator-profile";
import { ChipGroup, SelectField, TextAreaField, TextField } from "./fields";

const IDLE: OnboardingFormState = { status: "idle", fieldErrors: {}, message: null };

const TRAIT_SUGGESTIONS = ["Friendly", "Direct", "Funny", "Calm", "Bold", "Nerdy", "Encouraging", "Honest"];

const toOptions = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }));

const STEPS = { 1: "About you", 2: "Your voice" } as const;

interface OnboardingFormProps {
  profile: CreatorProfileRow | null;
  brand: BrandProfileRow | null;
  startStep: 1 | 2;
  /** Editing an existing profile: step 2 saves without rebuilding the strategy. */
  hasStrategy: boolean;
}

/**
 * Two steps, both kept mounted (the inactive one is `hidden`) so going back
 * never loses what the creator typed. Submissions call the server actions
 * directly instead of through `<form action>`, which would reset the fields.
 */
export function OnboardingForm({ profile, brand, startStep, hasStrategy }: OnboardingFormProps) {
  const [step, setStep] = useState<1 | 2>(startStep);
  const [profileState, setProfileState] = useState(IDLE);
  const [voiceState, setVoiceState] = useState(IDLE);
  const [profilePending, startProfile] = useTransition();
  const [voicePending, startVoice] = useTransition();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const profileFormRef = useRef<HTMLFormElement>(null);
  const voiceFormRef = useRef<HTMLFormElement>(null);
  const firstRender = useRef(true);

  // Move focus to the new step's heading, but not on first load.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  // After a failed submit, focus the first invalid control, or the alert.
  useEffect(() => focusFirstError(profileFormRef.current, profileState), [profileState]);
  useEffect(() => focusFirstError(voiceFormRef.current, voiceState), [voiceState]);

  function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startProfile(async () => {
      const result = await saveProfileAction(formData);
      setProfileState(result);
      if (result.status === "saved") setStep(2);
    });
  }

  function submitVoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startVoice(async () => {
      // On success the action redirects to /app/strategy and never returns.
      const result = await saveVoiceAction(formData);
      setVoiceState(result);
    });
  }

  const p = profileState.fieldErrors;
  const v = voiceState.fieldErrors;
  const savedTraits = brand?.voice_traits ?? [];
  const customTraits = savedTraits.filter((trait) => !TRAIT_SUGGESTIONS.includes(trait));

  return (
    <div className="stack-md">
      <div className="stack-sm">
        <p className="eyebrow">
          Step {step} of 2 · {STEPS[step]}
        </p>
        <h1 ref={headingRef} tabIndex={-1} className="text-display-md outline-none">
          {step === 1 ? "Tell us about your content" : "How do you sound?"}
        </h1>
        <p className="lead">
          {step === 1
            ? "This shapes your positioning, your content pillars and your first 30-day plan."
            : "We use this so every idea and script sounds like you, not like a template."}
        </p>
      </div>

      <form ref={profileFormRef} hidden={step !== 1} onSubmit={submitProfile} noValidate className="card stack-md">
        <FormAlert state={profileState} />
        <TextField
          name="niche"
          label="Your niche"
          help="A few words, for example “home workouts for busy parents”."
          defaultValue={profile?.niche ?? ""}
          error={p.niche}
          maxLength={120}
          autoComplete="off"
        />
        <TextAreaField
          name="audience_description"
          label="Who you make content for"
          help="Who they are, what they struggle with, and what they want."
          defaultValue={profile?.audience_description ?? ""}
          error={p.audience_description}
          maxLength={600}
          rows={4}
        />
        <ChipGroup
          name="goals"
          label="Your goals"
          help="Pick up to three."
          options={toOptions(creatorGoal.options, GOAL_LABELS)}
          defaultValues={profile?.goals}
          error={p.goals}
        />
        <ChipGroup
          name="platforms"
          label="Where you post"
          options={toOptions(platform.options, PLATFORM_LABELS)}
          defaultValues={profile?.platforms}
          error={p.platforms}
        />
        <TextField
          name="posting_capacity_per_week"
          label="Posts you can make per week"
          help="Be realistic: a plan you can keep beats an ambitious one you can't."
          type="number"
          inputMode="numeric"
          min={1}
          max={30}
          defaultValue={profile?.posting_capacity_per_week ?? ""}
          error={p.posting_capacity_per_week}
          className="input max-w-32"
        />
        <SelectField
          name="experience_level"
          label="Where you are today"
          placeholder="Choose one"
          options={toOptions(experienceLevel.options, EXPERIENCE_LABELS)}
          defaultValue={profile?.experience_level ?? undefined}
          error={p.experience_level}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={profilePending}>
            {profilePending ? "Saving…" : "Continue"}
          </button>
        </div>
      </form>

      <form ref={voiceFormRef} hidden={step !== 2} onSubmit={submitVoice} noValidate className="card stack-md">
        <FormAlert state={voiceState} />
        <TextField
          name="tone"
          label="Your tone"
          help="For example “warm and practical” or “dry humour, no fluff”."
          defaultValue={brand?.tone ?? ""}
          error={v.tone}
          maxLength={200}
          autoComplete="off"
        />
        <ChipGroup
          name="voice_traits"
          label="Voice traits"
          help="Pick any that fit."
          options={TRAIT_SUGGESTIONS.map((trait) => ({ value: trait, label: trait }))}
          defaultValues={savedTraits}
          error={v.voice_traits}
        />
        <TextField
          name="custom_traits"
          label="Other traits (optional)"
          help="Separate with commas. Up to 8 traits in total."
          defaultValue={customTraits.join(", ")}
          error={v.custom_traits}
          autoComplete="off"
        />
        <TextAreaField
          name="do_list"
          label="Always do (optional)"
          help="One per line, for example “use real examples from my clients”."
          defaultValue={(brand?.do_list ?? []).join("\n")}
          error={v.do_list}
          rows={3}
        />
        <TextAreaField
          name="dont_list"
          label="Never do (optional)"
          help="One per line, for example “no clickbait” or “don't swear”."
          defaultValue={(brand?.dont_list ?? []).join("\n")}
          error={v.dont_list}
          rows={3}
        />
        <TextAreaField
          name="sample_text"
          label="A sample of your writing (optional)"
          help="Paste a caption or script you're proud of. It helps match your voice."
          defaultValue={brand?.sample_text ?? ""}
          error={v.sample_text}
          maxLength={2000}
          rows={5}
        />
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button
            type="button"
            className="btn btn-secondary w-full sm:w-auto"
            onClick={() => setStep(1)}
            disabled={voicePending}
          >
            Back
          </button>
          <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={voicePending}>
            {hasStrategy
              ? voicePending
                ? "Saving…"
                : "Save changes"
              : voicePending
                ? "Building your strategy…"
                : "Save and build my strategy"}
          </button>
        </div>
        {hasStrategy ? (
          <p className="field-help sm:text-right">
            This won&apos;t change your current strategy. You can regenerate it afterwards.
          </p>
        ) : null}
        <p aria-live="polite" className="field-help sm:text-right">
          {voicePending && !hasStrategy ? "This can take up to a minute. Please keep this page open." : ""}
        </p>
      </form>
    </div>
  );
}

function FormAlert({ state }: { state: OnboardingFormState }) {
  if (state.status !== "error" || !state.message) return null;
  return (
    <div role="alert" tabIndex={-1} data-form-alert className="alert font-semibold">
      {state.message}
    </div>
  );
}

function focusFirstError(form: HTMLFormElement | null, state: OnboardingFormState) {
  if (!form || state.status !== "error") return;
  const target =
    form.querySelector<HTMLElement>('[aria-invalid="true"]') ?? form.querySelector<HTMLElement>("[data-form-alert]");
  target?.focus();
}
