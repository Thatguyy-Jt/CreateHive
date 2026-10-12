# Strategy UX Fixes: Toasts and Edit-Without-Regenerate

Follow-up to `prompts/creator-intelligence.md` (Phase 2), from manual testing feedback.

## Goal

1. **Confirm generation with a floating toast.** After a strategy is created or regenerated, show a floating, auto-dismissing toast ("Your strategy has been regenerated · Version 3"). Today the only confirmation is the version line at the bottom of the page, which is easy to miss.
2. **Editing the profile must not regenerate the strategy.** Today, finishing step 2 of `/onboarding` always generates a new strategy: it uses one AI generation and replaces the current strategy, even when the creator only fixed a typo. When a strategy already exists, step 2 should **save only**, then tell the creator their strategy still reflects their previous answers and offer to regenerate.

## Skills Read

- `clerk-nextjs-patterns` (server actions authenticate themselves; unchanged pattern).
- Next.js docs `01-app/01-getting-started/07-mutating-data.md` (`redirect` after mutation, `revalidatePath` first) and `05-server-and-client-components.md` (client component boundaries). `useSearchParams` must sit behind `Suspense` under Cache Components.
- `ai-sdk`, `supabase`: not applicable (no AI or schema changes).

## Existing Code Inspected

- `app/onboarding/actions.ts`: `saveVoiceAndBuildAction` always calls `generateCreatorStrategy`, then redirects to `/app/strategy` (with `?error=` on failure).
- `app/app/strategy/actions.ts`: `generateStrategyAction` returns `{ status: "done" }`; the page re-renders through `revalidatePath`. `GenerateStrategyControl` is keyed by `strategy.version`, so its state resets on success, which is why there is no visible confirmation.
- `components/onboarding/onboarding-form.tsx`: step 2 button "Save and build my strategy"; `app/onboarding/page.tsx` loads `getOnboardingState` only.
- `components/strategy/strategy-content.tsx`, `strategy-view.tsx`, `generate-strategy-control.tsx`; `app/app/layout.tsx` (shell, where a global toaster belongs).
- `lib/services/creator-strategy.ts` (`getCreatorStrategy`), `lib/services/creator-profile.ts` (`saveBrandProfile`).
- `package.json`: no toast library. AGENTS.md §5 lists shadcn/ui, whose toast component is **Sonner**.

## Decisions / Assumptions

1. **Toast library: `sonner`** (shadcn/ui's toast). It provides an accessible live region, pause-on-hover, swipe-to-dismiss, a close button, stacking, and reduced-motion support; hand-rolling those well is not worth it. It's added with `pnpm add sonner` at a pinned exact version. No other new dependencies.
2. **Toasts are triggered by a URL notice, not client state.** Successful actions `redirect` to `/app/strategy?notice=<code>` (plus `&v=<version>` where relevant). A small client component reads the notice once, shows the toast, then removes the parameters with `router.replace` so a refresh or the back button doesn't show it again. This survives the server re-render and also works for the onboarding → strategy redirect. Redirecting to the page also scrolls to the top, so after regenerating from the bottom of the page the creator sees the new strategy from the start.
3. **Only known notice codes are accepted** (`strategy_created`, `strategy_regenerated`, `profile_saved`); unknown values are ignored. All toast text comes from our own table, never from the URL. `v` must be a positive integer, otherwise it's left out.
4. **Errors stay inline, not in toasts.** Failures need reading and a next action ("Try again", or why not), so the existing inline `role="alert"` banners remain. Toasts are for confirmations only.
5. **Edit vs first setup is decided on the server.** `saveVoiceAndBuildAction` (renamed `saveVoiceAction`) checks `getCreatorStrategy` after saving the voice. If a strategy exists, it does **not** generate and redirects with `notice=profile_saved`. If none exists, it generates as today and redirects with `notice=strategy_created` (or `?error=` on failure). The button label is cosmetic; a forged request can't trigger a generation the creator couldn't trigger anyway.
6. **The onboarding page tells the form whether a strategy exists** (`hasStrategy` prop, read on the server with `getCreatorStrategy`) only to choose the button label and helper text.
7. **The `profile_saved` toast offers "Regenerate now".** The action scrolls to and focuses the "Regenerate strategy" button at the bottom of the page. It does **not** start a generation or skip the existing confirm step, because regenerating costs a generation and replaces the strategy.
8. **Placement:** a single `<Toaster>` in `app/app/layout.tsx` (all toasts land on `/app/...`). Position `bottom-right` on desktop; Sonner switches to a full-width bottom position on small screens.

## Files Likely to Change

| File | Change |
|---|---|
| `package.json`, `pnpm-lock.yaml` | Add `sonner` (pinned) |
| `components/ui/toaster.tsx` (new) | `"use client"` wrapper around Sonner's `<Toaster>`, themed with our tokens |
| `components/strategy/strategy-notice-toast.tsx` (new) | Reads `?notice`/`?v`, shows the toast once, strips the params |
| `lib/strategy-notices.ts` (new) | Notice codes, parser (pure, unit-tested), toast copy |
| `app/app/layout.tsx` | Mount `<Toaster />` |
| `app/app/strategy/page.tsx` | Mount `<StrategyNoticeToast />` behind `Suspense` |
| `app/app/strategy/actions.ts` | On success, `revalidatePath` then `redirect` with the notice (created vs regenerated) |
| `app/onboarding/actions.ts` | `saveVoiceAction`: save only when a strategy exists; otherwise build; redirect with notice |
| `app/onboarding/page.tsx` | Load `hasStrategy`, pass it to the form |
| `components/onboarding/onboarding-form.tsx` | Button label and helper text by `hasStrategy`; pending text |
| `components/strategy/generate-strategy-control.tsx` | Stable `id` on "Regenerate strategy" for the toast action; drop the now-unused `done` state handling |
| `app/globals.css` | Toast styles mapped to existing tokens |
| `tests/strategy/notices.test.ts` (new) | Notice parsing |
| `tests/services/...` | No change unless touched |

## Database Changes

None.

## Implementation Requirements

1. **Notices (`lib/strategy-notices.ts`)**
   - `parseStrategyNotice(params) → { code, version } | null`. Accepts only the three codes; `version` only if `v` is an integer ≥ 1.
   - Copy:
     - `strategy_created`: title "Your strategy is ready", description "Start with week 1 below."
     - `strategy_regenerated`: title "Your strategy has been regenerated", description "Version N" (or no description without a valid `v`).
     - `profile_saved`: title "Profile saved", description "Your strategy still reflects your previous answers. Regenerate it when you want it updated.", action "Regenerate now".
2. **`StrategyNoticeToast`**: `useSearchParams` behind `Suspense`; when a valid notice is present, calls `toast.success(...)` **once** (guarded against React Strict Mode double effects with a ref keyed by the notice) and then `router.replace("/app/strategy", { scroll: false })`. It renders nothing.
3. **Toaster**: `closeButton`, `duration` 6 s (10 s for `profile_saved`, since it carries an action), pauses on hover/focus, `richColors` off; styled with `--surface`, `--foreground`, `--border`, `--success`, `--radius-md`, and `--shadow-float`. Light and dark follow the existing tokens.
4. **`generateStrategyAction`**: on success, decides `strategy_created` vs `strategy_regenerated` from the returned `version` (1 = created), calls `revalidatePath("/app")` and `revalidatePath("/app/strategy")`, then `redirect("/app/strategy?notice=…&v=…")`. On failure it returns the inline error state exactly as today.
5. **`saveVoiceAction`** (onboarding step 2):
   - Validate and save the voice as today.
   - Read `getCreatorStrategy`. If that read fails, **do not generate** (fail safe: never replace a strategy we couldn't confirm is absent) and redirect with `notice=profile_saved`.
   - Strategy exists: no AI call; `revalidatePath` both paths; redirect `?notice=profile_saved`.
   - No strategy: generate; success → `?notice=strategy_created&v=1`; failure → `?error=<code>` (existing inline handling).
6. **Onboarding form**: with `hasStrategy`, step 2's button reads "Save changes" (pending "Saving…") with helper text "This won't change your current strategy. You can regenerate it afterwards." Without it, the button and copy stay as they are ("Save and build my strategy").
7. **Regenerate button target**: `id="regenerate-strategy"`. The toast action calls `scrollIntoView({ block: "center" })` and `focus()` on it (honouring reduced motion with `behavior: "auto"`).

## AI Behavior

Unchanged prompts and models. Behaviour change: editing a profile no longer triggers a generation when a strategy exists, so it no longer uses one of the creator's AI generations. Generation still only happens on first setup or an explicit, confirmed regenerate.

## Security Requirements

- Actions keep `auth.protect()` and RLS-scoped clients; the strategy-exists check uses the same RLS-scoped read.
- Notice parameters are allow-listed and never rendered raw.
- No secrets reach the client; `sonner` is a client-only UI dependency.

## Acceptance Criteria

1. Regenerating from the bottom of `/app/strategy` lands at the top of the page, showing the new strategy and a floating toast "Your strategy has been regenerated · Version N" that disappears after about 6 seconds and can be closed.
2. The first strategy (from onboarding or "Generate my strategy") shows "Your strategy is ready".
3. Refreshing or pressing Back after a toast does not show it again; the URL has no `notice` parameter.
4. With an existing strategy, editing the profile and pressing "Save changes" saves without any AI call: `creator_strategies.version` and the count in Settings → AI usage are unchanged. You land on `/app/strategy` with the "Profile saved" toast, and "Regenerate now" focuses the Regenerate button without starting a generation.
5. A creator without a strategy still gets one built at the end of onboarding.
6. Generation failures still show the inline error banners, not toasts.
7. Screen readers announce toasts (Sonner's live region); the close button is keyboard-reachable; the layout works at 375px in light and dark themes.
8. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` pass.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build   # actions, layout and a new dependency changed
```

New tests: `tests/strategy/notices.test.ts`, covering valid codes, unknown codes ignored, `v` validation (`"3"` → 3; `"0"`, `"-1"`, `"2.5"`, `"abc"` → no version), and array-valued params.

The edit-vs-first-setup branch lives in a server action (no action test harness in the repo); it's covered by the manual steps below.

## Manual Test Procedure

1. `pnpm install`, `pnpm dev`, sign in with an account that has a strategy.
2. Scroll to the bottom of `/app/strategy` → **Regenerate strategy** → **Regenerate**. You land at the top with the toast "Your strategy has been regenerated · Version N". Hover it: it stays. Leave it: it closes after about 6 s. Refresh: no toast.
3. Note the version and your AI usage count. Click **Edit profile**, change the niche, Continue. Step 2 shows **Save changes** and the "won't change your current strategy" note. Save. You land on `/app/strategy` with the "Profile saved" toast; version and usage are unchanged. Click **Regenerate now**: the page scrolls to and focuses the Regenerate button; nothing is generated until you confirm.
4. Sign up with a fresh account and complete onboarding: you land on the new strategy with "Your strategy is ready".
5. Set `AI_ENABLED=false`, regenerate: the inline paused message shows; no toast. Restore.
6. Phone width (~375px) and dark mode: toast is readable, full-width, and doesn't cover the page's primary button permanently. Tab to the toast's close button with the keyboard.

## UI

- **Visual interpretation:** a quiet confirmation card in the app's flat style: surface background, 1px border, soft floating shadow (`--shadow-float`, the one blurred shadow the design system reserves for floating UI), a success check icon, title in semibold, description muted. No bright fills.
- **Layout:** bottom-right, 16px from the edges on desktop, max width about 360px; full-width with side gutters on mobile. Multiple toasts stack.
- **Typography:** title 0.9375rem semibold; description 0.875rem `text-muted-foreground`; action button styled like `.btn-sm .btn-secondary`.
- **Behaviour:** slides and fades in (no motion with `prefers-reduced-motion`), auto-dismiss, pause on hover/focus, close button, swipe to dismiss on touch.
- **Loading/empty/error states:** unchanged; errors remain inline banners.
- **Accessibility:** polite live region for success; close and action buttons are real buttons with labels; focus isn't stolen when a toast appears.

## Known Limitations / Follow-ups

- Toasts are only used on `/app/strategy` for now; other features can reuse the same `<Toaster>` and notice pattern.
- "Regenerate now" focuses the existing control rather than regenerating directly; a one-click regenerate from the toast would bypass the cost confirmation.
- No "your strategy is out of date" indicator persists after the toast closes; a stale-strategy badge (comparing `creator_profiles.updated_at` with `creator_strategies.updated_at`) could follow.
