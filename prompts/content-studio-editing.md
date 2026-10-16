# Content Studio: editing, versions and section regeneration (Phase 4, part 2)

Second and last slice of Phase 4 (Content Studio) in `PHASES.md`. Part 1 (`prompts/content-studio-package.md`, shipped as `237afd0`) turns a saved idea into a stored AI package. This part lets the creator **make the package theirs**: edit it, keep and restore versions, regenerate one section at a time, copy or download the whole thing, and discard a draft they don't want.

Loop step served: *Creation* (finishing the piece before it is published).

| Part | Scope |
|---|---|
| 1 (done) | Studio routes; whole-package generation; scheduling a draft |
| **2 (this)** | Section editing saved as creator versions; version history, preview and restore; section-level regeneration; copy all and download; discard a draft |

Phase 4 becomes `✅ DONE` when this part ships.

## Goal

- **Edit** any section of the latest package. Each save is a new, append-only version (`source = 'user'`), so nothing the creator wrote or the AI wrote is ever overwritten.
- **History:** list recent versions, preview a past one read-only, and **restore** it (restoring writes a new version; it never rewrites history).
- **Regenerate one section** (titles, hooks, script, shot list, caption and hashtags, CTA, thumbnail, repurposing) without touching the rest. Optionally tell the AI what to change ("shorter", "more playful").
- **Copy all** and **Download** the full package as plain text.
- **Discard** a draft the creator no longer wants: the item and its versions are deleted and the idea goes back to Saved.

## Skills Read

Same as Part 1: `ai-sdk` (strict structured output through `runStructured`), `supabase` and `supabase-postgres-best-practices` (the new function: `security invoker`, owner from the JWT, row lock), `clerk-nextjs-patterns` (`auth.protect()` in every action), and the Next.js docs for server actions, `redirect` and Cache Components (request data and `searchParams` stay behind `Suspense`).

## Existing Code Inspected

- **Part 1 code (just shipped):**
  - `lib/schemas/studio.ts`: `studioPackage` (bounds), `contentPackageOutputFor` (bounds plus platform, video and thumbnail rules), `parseStoredPackage`, `STUDIO_ERRORS`.
  - `lib/services/studio.ts`: `generateContentPackage`, `getStudioItem` (latest version only), `renderCappedContext`, the in-flight guard and per-item cap.
  - `app/app/studio/actions.ts`; `components/studio/*` (`package-sections.tsx` is a server component whose Copy buttons are client).
- **AI layer:** `lib/ai/prompts/registry.ts`, `models.ts`, `run-structured.ts`; `content_package/v1.ts` is the prompt style to follow.
- **Schema:**
  - `content_versions`: append-only (select and insert only for creators), `unique (content_item_id, version_no)`, `source` is `user` or `ai`, `note`, and Part 1's `ai_generation_id`.
  - `content_items`: owner delete policy exists; `content_versions` rows cascade on delete.
  - `ai_generations.content_item_id` exists but `runStructured` doesn't set it.
- **Calendar functions** (`unschedule_content_item` keeps a packaged item as a draft; the idea stays `planned`).
- **Tests:** `tests/services/fake-supabase.ts`, `tests/services/studio.test.ts`, `tests/db/studio.test.ts`, `tests/schemas/studio*.ts`.
- **Not present:** any edit, history, restore, section regeneration, export or discard code; any way to delete a Studio item.

## Decisions / Assumptions

1. **A version is a full snapshot.** Every version stores the whole package (`{ schema_version: 1, package }`), whoever wrote it. No diffs, no schema change to `content_versions`.
2. **Edits go through the server and are merged there.** The browser sends the section name, its new value and the version number it was editing (`base_version`). The server re-reads the latest version, checks it is still `base_version`, replaces only that section, validates the merged package, and inserts `base_version + 1`. A mismatch or a unique-violation race returns `version_conflict` ("This package changed in another tab. Refresh to see the latest."). The browser never sends a whole package.
3. **Validation for creator edits is bounds plus platform only.** A creator may save a 2-shot list or drop the thumbnail; the video and thumbnail rules in Part 1 exist to check *AI* output. Repurposing must still target one of the creator's platforms. (New `userPackageFor({ platforms })`.)
4. **Notes are server constants,** never creator text: `Generated package` (Part 1), `Edited <section>`, `Restored version <n>`, `Regenerated <section>`. They also tell the UI how to label a version.
5. **Section keys:** `titles`, `hooks`, `script`, `shot_list`, `caption` (caption plus hashtags), `cta`, `thumbnail`, `repurposing`. Each key maps to the package fields it owns.
6. **Edit form fields.** Titles and hooks edit both the text and its "why" (a stale "why" would mislead); script beats can be added, removed and moved up or down (3 to 12); shots add/remove (0 to 15); caption is a textarea plus a space- or comma-separated hashtag field; thumbnail has concept and overlay text (clearing the concept removes it); repurposing has up to 3 rows with a platform select limited to the creator's platforms.
7. **Section regeneration is its own AI task:** `content_section` v1, `quality` tier, `maxOutputTokens: 4_000`. Its input is the creator context (same 5,000-character cap), the idea, and the *current* package, so the new section stays consistent with the rest. It returns only that section.
8. **Optional instruction.** Each section's Regenerate has an optional "What should change?" field (max 200 characters). It is sent to OpenAI inside a `<creator_input>` block as data, never as an instruction to override the rules. Leaving it empty is allowed.
9. **Section output rules:** same bounds as the package; `shot_list` needs at least 3 shots for video formats (at least 1 otherwise); `thumbnail` must be non-null (regenerating can't silently delete it); repurposing only the creator's platforms. Regenerate is offered for `shot_list` only when the item is a video format or already has shots, and for `thumbnail` only when the format needs one or the package already has one.
10. **Usage controls** (on top of the daily cap and metering in `runStructured`):
    - The in-flight guard now covers both kinds (`content_package` and `content_section`): one pending generation per creator in 2 minutes.
    - Whole-package cap stays **5 per item per 24 hours**, counted from AI versions whose note is `Generated package`.
    - New section cap: **10 per item per 24 hours**, counted from AI versions whose note starts with `Regenerated `. (Counting by the server-written note avoids a migration.)
    - New total cap: **100 versions per item**, so edits can't grow without limit (`version_limit`).
11. **Failed or conflicting saves store nothing** and show the error inline; the creator's unsaved text stays in the editor.
12. **History** lists the latest **20** versions (number, source label, note, time in the creator's timezone). Preview is `?version=N` on the item page: read-only, with a banner "Viewing version N" and buttons **Restore this version** and **Back to latest**. An unreadable old version shows "This version couldn't be shown" and can't be restored.
13. **Restore** copies the chosen version's package into a new latest version (`source = 'user'`, `Restored version N`). Restoring the latest version is blocked ("This is already your latest version").
14. **Editing, restoring and regenerating are allowed for `draft`, `ready` and `scheduled` items** (the same statuses as generation). They are never available while previewing an old version.
15. **Copy all / Download:** pure client features. Copy all copies the whole package as plain text with section headings; Download saves the same text as `<title>.txt` (title slugified, 60 characters max). No server call.
16. **Discard is a hard delete,** limited to `draft` items. In one transaction (`discard_studio_item`) the item is deleted (its versions cascade), and its idea goes from `in_production` or `planned` back to `saved`. It needs a two-step confirm in the UI. A scheduled item must be removed from the calendar first (that keeps it as a draft, which can then be discarded).
17. **Status `ready` stays unused** (no "mark as ready" yet) and publishing stays a Phase 5 concern.
18. **PHASES.md:** tick "Section-level regeneration" and "Save / edit / version"; Phase 4 header becomes `✅ DONE`.

## Files Likely to Change

| File | Change |
|---|---|
| `supabase/migrations/20261016000100_studio_discard.sql` (new) | `discard_studio_item(p_item_id)`, grants |
| `lib/supabase/database.types.ts` | New function |
| `lib/schemas/studio.ts` | Section keys and fields, per-section model and output schemas, `userPackageFor`, new error codes, `packageToText` for copy/download |
| `lib/ai/prompts/content_section/v1.ts` (new), `registry.ts`, `models.ts` | Prompt, registry entry, route |
| `lib/services/studio.ts` | `savePackageSection`, `restoreVersion`, `regenerateSection`, `discardStudioItem`, `listVersions`; `getStudioItem` takes a version; in-flight guard covers both kinds |
| `app/app/studio/actions.ts` | `savePackageSectionAction`, `restoreVersionAction`, `regenerateSectionAction`, `discardStudioItemAction` |
| `app/app/studio/[id]/page.tsx` | Pass `searchParams` (for `?version=`) behind `Suspense` |
| `components/studio/*` | Section wrapper with Edit / Regenerate / Copy, per-section editors, version history, preview banner, copy-all and download, discard control |
| `components/studio/package-sections.tsx`, `studio-item-content.tsx` | Use the new section wrapper; history and preview |
| `components/settings/privacy-section.tsx` | What section regeneration sends; versions and discard |
| `PHASES.md` | As in Decision 18 |
| `tests/**` | See Checks |

## Database Changes

One function, no table or column changes, no RLS or grant changes on tables.

```sql
-- discard_studio_item(p_item_id uuid) returns void        (security invoker)
```

- Owner from `auth.jwt() ->> 'sub'`; `set search_path = ''`; the item row is locked `for update`.
- Raises stable tokens: `item_not_found` (missing or another creator's), `item_not_draft` (any status other than `draft`).
- Deletes the item (versions cascade; `ai_generations.content_item_id` is set to null by its existing FK). If the item has an idea, sets that idea to `saved` when it is `in_production` or `planned`.
- `execute` revoked from `public, anon`; granted to `authenticated, service_role`.
- Creators still can't update or delete `content_versions` directly: history stays append-only. The cascade is the only way versions go away.

## Implementation Requirements

1. **`lib/schemas/studio.ts`**
   - `SECTION_KEYS`, `SECTION_FIELDS` (key → package fields) and a type guard.
   - `userPackageFor({ platforms })`: `studioPackage` plus the repurposing-platform check only.
   - `sectionModelSchemaFor(section, platforms)` (strict: every key present, `nullable()` for optional) and `sectionOutputFor(section, { platforms, video, thumbnailRequired })` for validation (Decision 9).
   - `sectionInputFor(section)`: validates a browser-sent section value against that section's part of `studioPackage` (unknown keys stripped, strings trimmed).
   - New codes in `STUDIO_ERRORS`: `version_conflict`, `version_limit`, `section_limit`, `invalid_input`, `version_not_found`, `already_latest`, `unreadable_version`.
   - `packageToText(pkg)`: the plain text used by Copy all and Download (reuses Part 1's per-section text so both stay identical).
2. **`content_section` v1 prompt**
   - Role: same production assistant; rewrites exactly one section.
   - User message blocks: `<creator_input>` (capped context and the creator's optional instruction), `<idea>`, `<package>` (the other current sections, plus the current section to replace). All data, same injection guard as Part 1.
   - Rules: keep the angle and voice; stay consistent with the other sections; follow the instruction only where it doesn't break the rules; no invented statistics, testimonials or claims; no engagement bait, deception, impersonation or "viral" language; `why` lines explain craft, not predicted performance.
3. **Services (all never throw; all use the creator's RLS client; all re-check `user_id`)**
   - `savePackageSection(client, userId, itemId, { baseVersion, section, value })`: validate ids, section and value → read the item (status must be editable) → read the latest version → `baseVersion` must equal it → merge, validate with `userPackageFor` → total-version cap → insert `source: 'user'`, note `Edited <section>`.
   - `restoreVersion(client, userId, itemId, { versionNo, baseVersion })`: same guards; reads the target version, requires it to be readable and not the latest, inserts it as the new latest.
   - `regenerateSection(client, userId, itemId, { section, baseVersion, instruction }, deps)`: same steps as `generateContentPackage` (item, context, caps, in-flight guard, run, validate), then merges only that section into the latest package and inserts `source: 'ai'`, note `Regenerated <section>`, with `ai_generation_id`. Needs an existing readable package. An unreadable latest version returns `unreadable_version` ("Regenerate the whole package first").
   - `discardStudioItem(client, userId, itemId)`: calls `discard_studio_item`, maps the tokens.
   - `listVersions(client, userId, itemId, tz)`: latest 20 versions, metadata only (no content).
   - `getStudioItem(..., version?)`: loads the requested version (or the latest) and also returns the total version count and the latest version number.
4. **Server actions** (`app/app/studio/actions.ts`): each runs `auth.protect()`, validates ids and shape with Zod, calls the service, revalidates `/app/studio/[id]` (plus `/app/studio`, `/app`, `/app/opportunities` and `/app/calendar` for discard), and returns a controlled state. `discardStudioItemAction` redirects to `/app/studio` on success, outside any try.
5. **Pages**
   - `/app/studio/[id]` reads `searchParams` inside the existing `Suspense` and passes `?version=` to the service. An invalid `version` value is ignored (shows the latest); a version that doesn't exist for this item shows the "version not found" state with a link back to the latest.
   - Opening, previewing and listing versions never calls AI.
6. **Privacy copy** updated (see Security).

## AI Behavior

- **Input:** capped creator context, the idea (evidence summaries only, no URLs), the current package text, the section name, and the optional instruction. No names or emails, nothing from other creators.
- **Output (strict):** only the requested section's fields (same shapes as Part 1; `show`, `notes`, `overlay_text` nullable).
- **Validation:** the section's model schema in strict mode, then `sectionOutputFor`. A failure is `invalid_output` (counts against the daily cap, as today). Nothing is stored on failure.
- **Persistence:** one `content_versions` row per successful regeneration; `ai_generations` and `usage_events` are written by `runStructured`.
- **Errors** map to `STUDIO_ERRORS` and show inline with Try again when retryable.
- **Usage controls:** Decision 10. Regeneration uses 1 AI generation, and the UI says so.

## Security Requirements

- Identity only from Clerk (`auth.protect()`). The browser sends ids, a section name, a section value and a version number; none are trusted. Every query is scoped by `user_id` on top of RLS, and the functions take the owner from the JWT.
- Section values are validated server-side with Zod and merged on the server. Whole packages are never accepted from the browser. All text renders as text (no `dangerouslySetInnerHTML`); Download builds a `text/plain` blob from the validated package.
- `discard_studio_item` is `security invoker`, locks the row, and is not executable by `anon`. Deleting is limited to drafts, so a scheduled or published item can't be removed by this path.
- Versions stay append-only for creators; no update or delete grant is added.
- The optional instruction is creator text sent to OpenAI as data. The privacy copy says what section regeneration sends (context, idea, current package, instruction) and that versions are stored until the item is discarded or deleted.

## Acceptance Criteria

1. Saving an edited section creates version N+1 (`source = 'user'`, note `Edited <section>`) containing all other sections unchanged, and the page shows it.
2. Saving with a stale `base_version` (for example from a second tab) stores nothing and shows the conflict message; the editor keeps the creator's text.
3. Invalid edits (over a bound, blank required field, a repurposing platform the creator doesn't use) are rejected inline. A creator may save fewer than 3 shots or no thumbnail.
4. Regenerating a section creates an AI version that changes only that section, using the current package as context; a failed or invalid generation stores nothing.
5. The section cap (10 per item in 24 hours), the existing package cap (5), the 100-version total cap, the in-flight guard and the daily cap each block with their own message and no AI call.
6. History lists the latest 20 versions with source and note; `?version=N` previews read-only with no edit or regenerate controls; Restore creates a new latest version and the old versions remain.
7. Copy all and Download produce the same plain text as the sections' Copy buttons joined together.
8. Discarding a draft deletes the item and its versions and returns its idea to Saved; it is refused for scheduled items, and another creator's item returns not found (DB test).
9. Opening Studio pages never calls AI. Another creator's item or version is a 404 or "not found".
10. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

New and changed tests:

- `tests/schemas/studio.test.ts`: section schemas and `sectionOutputFor` (bounds, video shots, non-null thumbnail, platform list), `sectionInputFor` (trimming, unknown keys, bad shapes), `userPackageFor` (relaxed rules, platform check), `packageToText`.
- `tests/ai/prompts.test.ts` and `models.test.ts`: `content_section` registered and routed; blocks are escaped and stripped; the instruction can't close its block.
- `tests/services/studio.test.ts`:
  - save: merge of only the edited section, conflict, race (unique violation), version cap, non-editable item, invalid value, unreadable latest;
  - restore: new version written, latest blocked, unreadable target;
  - regenerate: only that section changes, both caps, the guard (no AI call when blocked), nothing stored on failure, instruction passed through;
  - discard token mapping; version listing; preview of a given version; the in-flight guard now filters both kinds (update the Part 1 assertion).
- `tests/db/studio.test.ts`: `discard_studio_item` deletes item and versions, returns the idea to `saved` from `in_production` and `planned`, refuses scheduled items, refuses other creators' items, is `security invoker` with a pinned search path, can't be run by `anon`; creators still can't update or delete `content_versions` directly.
- `tests/db/schema-parity.test.ts` still green (no new check constraints).

## Manual Test Procedure

1. Apply the migration (`supabase db push` or the SQL editor), then `pnpm dev` and open an item that has a package.
2. **Edit:** click **Edit** on Titles, change one title and its "why", **Save**. The section updates and History shows a new "Edited" version. Open the page in a second tab, save a different edit in the first tab, then save in the second: it shows the conflict message and keeps your text.
3. **Edit rules:** in Script, add and remove beats and move one up; try 2 beats (rejected) and 13 beats (rejected). In Repurposing, only your platforms are in the select. Remove all but 1 shot: it saves.
4. **Regenerate a section:** click **Regenerate** on Hooks with "make them punchier". Only the hooks change; History shows "Regenerated hooks". In `ai_generations`, a `content_section` row exists and Settings → AI usage went up by 1.
5. **Caps:** regenerate sections until 10 in 24 hours, and the next attempt shows the section limit message with no usage increase. (Full-package regeneration still stops at 5.)
6. **History:** click a past version: read-only preview with the banner. **Restore this version**: it becomes the newest version, and the older ones are still listed. Restoring the latest is not offered.
7. **Copy all / Download:** paste the copy into a text editor and compare with the downloaded `.txt`: identical.
8. **Discard:** on a draft, click **Discard draft**, then confirm. You land on `/app/studio`, the item is gone, and its idea is back under Saved. Try a scheduled item: no Discard button; remove it from the calendar first, then discard.
9. Visit `/app/studio/<id>?version=999` (not found state), `?version=abc` (shows the latest).
10. With `AI_ENABLED=false`, Regenerate shows "AI features are paused"; editing and restoring still work.
11. 375px width, dark mode, keyboard only: every editor field is labelled and reachable, buttons are at least 44px, focus is visible, no horizontal scroll, long text wraps.

## UI

- **Visual interpretation:** the same production sheet, now editable. Each section's heading row holds its actions (**Copy**, **Edit**, **Regenerate**), and the version in view is always labelled.
- **Layout (`max-w-3xl`, single column):**
  1. Header card and next-action row as in Part 1, plus a small line under the title: "Version 4 · Edited · Oct 15, 9:12 AM".
  2. Toolbar above the sections: **Copy all** and **Download** (secondary, small), and **History** (a `details` listing the latest 20 versions, each with a **Preview** link).
  3. Sections as in Part 1. **Edit** swaps the section body for its form with **Save** and **Cancel**. **Regenerate** opens a small `details` with the optional "What should change?" field and a **Regenerate this section** button ("Uses 1 AI generation").
  4. Bottom: Regenerate package (unchanged), then a separated **Discard draft** area for drafts only.
- **Preview mode:** a bordered banner at the top, "Viewing version 3 (AI, Oct 14, 6:01 PM). This is a read-only copy." with **Restore this version** and **Back to latest**. Edit, Regenerate, Regenerate package and Discard are hidden.
- **Editors:** native inputs and textareas with visible labels; list editors (beats, shots, repurposing) have **Add**, **Remove** and **Move up/down** buttons with accessible names ("Remove beat 2"); counters only near limits (`field-help`); validation messages in `field-error` tied with `aria-describedby`.
- **Discard confirm:** the first click shows "Delete this draft and all its versions? This can't be undone." with **Yes, delete** and **Keep it** (focus moves to **Keep it**).
- **Typography and spacing:** as Part 1 (`text-heading` card headings, `break-words` everywhere creator text appears, `stack-lg` between cards, `stack-sm` inside).
- **Loading:** buttons disable with `aria-busy`; regenerating shows "Regenerating… This can take up to a minute." in an `aria-live` region; saving shows "Saving…".
- **Empty states:** History with a single version: "Only one version so far."
- **Errors:** inline `alert` with the service message and Try again when retryable; "This version couldn't be shown" for an unreadable old version; "We couldn't find that version" for a missing one.
- **Responsive and mobile:** single column; action buttons wrap under the heading on narrow screens; buttons full-width below 480px; controls at least 44px.
- **Accessibility:** each section stays a `section` labelled by its heading; Edit and Regenerate buttons have accessible names that include the section ("Edit titles"); toasts (Sonner) announce saves and regenerations; focus returns to the section's Edit button after Save or Cancel.

## Known Limitations / Follow-ups

- No diff view between versions and no version naming or notes written by the creator.
- No "mark as ready" and no publishing: `ready` and `published` stay unused until Phase 5.
- History shows the latest 20 versions; older ones are kept but not listed.
- A discarded draft can't be recovered.
- Section regeneration doesn't use performance data beyond what the context already includes; Phase 5 learning should feed it.
