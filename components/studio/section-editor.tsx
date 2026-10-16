"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { savePackageSectionAction } from "@/app/app/studio/actions";
import { PLATFORM_LABELS, type Platform } from "@/lib/schemas/creator";
import type { SectionKey, SectionValue, StudioPackage } from "@/lib/schemas/studio";

// Limits mirror `studioPackage`; the server validates again.
const MAX_BEATS = 12;
const MIN_BEATS = 3;
const MAX_SHOTS = 15;
const MAX_REPURPOSING = 3;

let nextKey = 0;
const withKey = <T,>(item: T) => ({ ...item, key: ++nextKey });

interface EditorProps {
  section: SectionKey;
  title: string;
  value: SectionValue;
  itemId: string;
  baseVersion: number;
  platforms: Platform[];
  /** Leaves edit mode (after Save or Cancel). */
  onDone: () => void;
}

/** The editor for one section. Saves through the server, which merges and validates it as a new version. */
export function SectionEditor(props: EditorProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pkg = props.value;

  function save(value: SectionValue) {
    setError(null);
    startTransition(async () => {
      const result = await savePackageSectionAction(props.itemId, {
        baseVersion: props.baseVersion,
        section: props.section,
        value,
      });
      if (!result.ok) {
        // The creator's text stays in the form.
        setError(result.message);
        return;
      }
      toast.success(`${props.title} saved`);
      props.onDone();
    });
  }

  const shared = { id: props.section, pending, error, onSave: save, onCancel: props.onDone };
  switch (props.section) {
    case "titles":
      return <ChoicesEditor {...shared} field="titles" noun="Title" textMax={100} items={pkg.titles ?? []} />;
    case "hooks":
      return <ChoicesEditor {...shared} field="hooks" noun="Hook" textMax={200} items={pkg.hooks ?? []} />;
    case "script":
      return <ScriptEditor {...shared} beats={pkg.script?.beats ?? []} />;
    case "shot_list":
      return <ShotsEditor {...shared} shots={pkg.shot_list ?? []} />;
    case "caption":
      return <CaptionEditor {...shared} caption={pkg.caption ?? ""} hashtags={pkg.hashtags ?? []} />;
    case "cta":
      return <CtaEditor {...shared} cta={pkg.cta ?? ""} />;
    case "thumbnail":
      return <ThumbnailEditor {...shared} thumbnail={pkg.thumbnail ?? null} />;
    case "repurposing":
      return <RepurposingEditor {...shared} items={pkg.repurposing ?? []} platforms={props.platforms} />;
  }
}

interface Shared {
  id: string;
  pending: boolean;
  error: string | null;
  onSave: (value: SectionValue) => void;
  onCancel: () => void;
}

function EditorForm({ id, pending, error, onCancel, onSubmit, children }: Omit<Shared, "onSave"> & {
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <form
      className="stack-sm"
      aria-busy={pending}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
      {error ? (
        <p role="alert" id={`${id}-error`} className="alert text-sm font-semibold">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 min-[480px]:flex-row">
        <button type="submit" className="btn btn-primary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm w-full min-[480px]:w-auto" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
      <p className="field-help">Saving keeps your previous version in History.</p>
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  max,
  required = true,
  multiline = false,
  rows = 3,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
}) {
  const near = value.length > max * 0.85;
  const counterId = `${id}-count`;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label text-sm">
        {label}
        {required ? null : <span className="font-normal text-muted-foreground"> (optional)</span>}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="textarea"
          rows={rows}
          value={value}
          maxLength={max}
          required={required}
          aria-describedby={near ? counterId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          className="input"
          value={value}
          maxLength={max}
          required={required}
          aria-describedby={near ? counterId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {near ? (
        <p id={counterId} className="field-help">
          {value.length} / {max} characters
        </p>
      ) : null}
    </div>
  );
}

/** Move up / Move down / Remove for one row of a list editor. */
function RowControls({
  noun,
  index,
  count,
  canRemove,
  onMove,
  onRemove,
}: {
  noun: string;
  index: number;
  count: number;
  canRemove: boolean;
  onMove?: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const position = `${noun.toLowerCase()} ${index + 1}`;
  return (
    <div className="flex flex-wrap gap-2">
      {onMove ? (
        <>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            aria-label={`Move ${position} up`}
          >
            Move up
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
            aria-label={`Move ${position} down`}
          >
            Move down
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={!canRemove}
        onClick={() => onRemove(index)}
        aria-label={`Remove ${position}`}
      >
        Remove
      </button>
    </div>
  );
}

const move = <T,>(items: T[], from: number, to: number) => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};
const update = <T,>(items: T[], index: number, patch: Partial<T>) =>
  items.map((item, i) => (i === index ? { ...item, ...patch } : item));

function ChoicesEditor({
  field,
  noun,
  textMax,
  items: initial,
  ...shared
}: Shared & { field: "titles" | "hooks"; noun: string; textMax: number; items: StudioPackage["titles"] }) {
  const [items, setItems] = useState(initial);
  return (
    <EditorForm {...shared} onSubmit={() => shared.onSave(field === "titles" ? { titles: items } : { hooks: items })}>
      <ol className="stack-md">
        {items.map((item, index) => (
          <li key={index} className="stack-sm">
            <TextField
              id={`${shared.id}-${index}-text`}
              label={`${noun} ${index + 1}`}
              value={item.text}
              max={textMax}
              onChange={(text) => setItems(update(items, index, { text }))}
            />
            <TextField
              id={`${shared.id}-${index}-why`}
              label={`Why ${noun.toLowerCase()} ${index + 1} works`}
              value={item.why}
              max={160}
              onChange={(why) => setItems(update(items, index, { why }))}
            />
          </li>
        ))}
      </ol>
    </EditorForm>
  );
}

function ScriptEditor({ beats: initial, ...shared }: Shared & { beats: StudioPackage["script"]["beats"] }) {
  const [beats, setBeats] = useState(() => initial.map((beat) => withKey({ ...beat, show: beat.show ?? "" })));
  const value = () =>
    ({ script: { beats: beats.map(({ label, say, show }) => ({ label, say, show: show || null })) } }) as SectionValue;
  return (
    <EditorForm {...shared} onSubmit={() => shared.onSave(value())}>
      <ol className="stack-md">
        {beats.map((beat, index) => (
          <li key={beat.key} className="stack-sm rounded-md border border-border p-3">
            <TextField
              id={`${shared.id}-${beat.key}-label`}
              label={`Beat ${index + 1} label`}
              value={beat.label}
              max={60}
              onChange={(label) => setBeats(update(beats, index, { label }))}
            />
            <TextField
              id={`${shared.id}-${beat.key}-say`}
              label="What to say"
              value={beat.say}
              max={1200}
              multiline
              rows={4}
              onChange={(say) => setBeats(update(beats, index, { say }))}
            />
            <TextField
              id={`${shared.id}-${beat.key}-show`}
              label="What to show"
              value={beat.show}
              max={300}
              required={false}
              multiline
              rows={2}
              onChange={(show) => setBeats(update(beats, index, { show }))}
            />
            <RowControls
              noun="Beat"
              index={index}
              count={beats.length}
              canRemove={beats.length > MIN_BEATS}
              onMove={(from, to) => setBeats(move(beats, from, to))}
              onRemove={(i) => setBeats(beats.filter((_, j) => j !== i))}
            />
          </li>
        ))}
      </ol>
      <div>
        <button
          type="button"
          className="btn btn-secondary btn-sm w-full min-[480px]:w-auto"
          disabled={beats.length >= MAX_BEATS}
          onClick={() => setBeats([...beats, withKey({ label: "", say: "", show: "" })])}
        >
          Add beat
        </button>
      </div>
      <p className="field-help">
        {MIN_BEATS} to {MAX_BEATS} beats.
      </p>
    </EditorForm>
  );
}

function ShotsEditor({ shots: initial, ...shared }: Shared & { shots: StudioPackage["shot_list"] }) {
  const [shots, setShots] = useState(() => initial.map((shot) => withKey({ ...shot, notes: shot.notes ?? "" })));
  const value = () => ({ shot_list: shots.map(({ shot, notes }) => ({ shot, notes: notes || null })) }) as SectionValue;
  return (
    <EditorForm {...shared} onSubmit={() => shared.onSave(value())}>
      {shots.length === 0 ? <p className="text-muted-foreground">No shots. Add one, or save an empty list.</p> : null}
      <ol className="stack-md">
        {shots.map((shot, index) => (
          <li key={shot.key} className="stack-sm rounded-md border border-border p-3">
            <TextField
              id={`${shared.id}-${shot.key}-shot`}
              label={`Shot ${index + 1}`}
              value={shot.shot}
              max={200}
              onChange={(text) => setShots(update(shots, index, { shot: text }))}
            />
            <TextField
              id={`${shared.id}-${shot.key}-notes`}
              label="Notes"
              value={shot.notes}
              max={200}
              required={false}
              onChange={(notes) => setShots(update(shots, index, { notes }))}
            />
            <RowControls
              noun="Shot"
              index={index}
              count={shots.length}
              canRemove
              onMove={(from, to) => setShots(move(shots, from, to))}
              onRemove={(i) => setShots(shots.filter((_, j) => j !== i))}
            />
          </li>
        ))}
      </ol>
      <div>
        <button
          type="button"
          className="btn btn-secondary btn-sm w-full min-[480px]:w-auto"
          disabled={shots.length >= MAX_SHOTS}
          onClick={() => setShots([...shots, withKey({ shot: "", notes: "" })])}
        >
          Add shot
        </button>
      </div>
    </EditorForm>
  );
}

function CaptionEditor({ caption: initialCaption, hashtags: initialTags, ...shared }: Shared & { caption: string; hashtags: string[] }) {
  const [caption, setCaption] = useState(initialCaption);
  const [hashtags, setHashtags] = useState(initialTags.map((tag) => `#${tag}`).join(" "));
  const value = () =>
    ({ caption, hashtags: hashtags.split(/[\s,]+/).filter(Boolean) }) as SectionValue;
  return (
    <EditorForm {...shared} onSubmit={() => shared.onSave(value())}>
      <TextField
        id={`${shared.id}-caption`}
        label="Caption"
        value={caption}
        max={2200}
        multiline
        rows={6}
        onChange={setCaption}
      />
      <div className="field">
        <label htmlFor={`${shared.id}-hashtags`} className="field-label text-sm">
          Hashtags <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id={`${shared.id}-hashtags`}
          className="input"
          value={hashtags}
          aria-describedby={`${shared.id}-hashtags-help`}
          onChange={(event) => setHashtags(event.target.value)}
        />
        <p id={`${shared.id}-hashtags-help`} className="field-help">
          Up to 8, separated by spaces or commas.
        </p>
      </div>
    </EditorForm>
  );
}

function CtaEditor({ cta: initial, ...shared }: Shared & { cta: string }) {
  const [cta, setCta] = useState(initial);
  return (
    <EditorForm {...shared} onSubmit={() => shared.onSave({ cta } as SectionValue)}>
      <TextField id={`${shared.id}-cta`} label="Call to action" value={cta} max={200} onChange={setCta} />
    </EditorForm>
  );
}

function ThumbnailEditor({ thumbnail, ...shared }: Shared & { thumbnail: StudioPackage["thumbnail"] }) {
  const [concept, setConcept] = useState(thumbnail?.concept ?? "");
  const [overlay, setOverlay] = useState(thumbnail?.overlay_text ?? "");
  // Clearing the concept removes the thumbnail.
  const value = () =>
    ({ thumbnail: concept.trim() ? { concept, overlay_text: overlay || null } : null }) as SectionValue;
  return (
    <EditorForm {...shared} onSubmit={() => shared.onSave(value())}>
      <TextField
        id={`${shared.id}-concept`}
        label="Concept"
        value={concept}
        max={300}
        required={false}
        multiline
        onChange={setConcept}
      />
      <TextField
        id={`${shared.id}-overlay`}
        label="Text on image"
        value={overlay}
        max={40}
        required={false}
        onChange={setOverlay}
      />
      <p className="field-help">Leave the concept empty to remove the thumbnail.</p>
    </EditorForm>
  );
}

function RepurposingEditor({
  items: initial,
  platforms,
  ...shared
}: Shared & { items: StudioPackage["repurposing"]; platforms: Platform[] }) {
  const [items, setItems] = useState(() => initial.map((item) => withKey(item)));
  const value = () =>
    ({ repurposing: items.map(({ platform, format, adaptation }) => ({ platform, format, adaptation })) }) as SectionValue;
  return (
    <EditorForm {...shared} onSubmit={() => shared.onSave(value())}>
      {items.length === 0 ? <p className="text-muted-foreground">No repurposing ideas.</p> : null}
      <ol className="stack-md">
        {items.map((item, index) => (
          <li key={item.key} className="stack-sm rounded-md border border-border p-3">
            <div className="field">
              <label htmlFor={`${shared.id}-${item.key}-platform`} className="field-label text-sm">
                Idea {index + 1} platform
              </label>
              <select
                id={`${shared.id}-${item.key}-platform`}
                className="select"
                value={item.platform}
                onChange={(event) => setItems(update(items, index, { platform: event.target.value as Platform }))}
              >
                {/* A platform the creator no longer uses stays visible so it can be changed. */}
                {(platforms.includes(item.platform) ? platforms : [item.platform, ...platforms]).map((option) => (
                  <option key={option} value={option}>
                    {PLATFORM_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            <TextField
              id={`${shared.id}-${item.key}-format`}
              label="Format"
              value={item.format}
              max={60}
              onChange={(format) => setItems(update(items, index, { format }))}
            />
            <TextField
              id={`${shared.id}-${item.key}-adaptation`}
              label="How to adapt it"
              value={item.adaptation}
              max={300}
              multiline
              rows={2}
              onChange={(adaptation) => setItems(update(items, index, { adaptation }))}
            />
            <RowControls
              noun="Idea"
              index={index}
              count={items.length}
              canRemove
              onRemove={(i) => setItems(items.filter((_, j) => j !== i))}
            />
          </li>
        ))}
      </ol>
      <div>
        <button
          type="button"
          className="btn btn-secondary btn-sm w-full min-[480px]:w-auto"
          disabled={items.length >= MAX_REPURPOSING || platforms.length === 0}
          onClick={() => setItems([...items, withKey({ platform: platforms[0], format: "", adaptation: "" })])}
        >
          Add idea
        </button>
      </div>
    </EditorForm>
  );
}
