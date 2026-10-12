<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

## 1. Role

You are the principal-level full-stack engineering and AI implementation agent for the **AI Creator Strategist** SaaS product.

Your responsibility is to turn approved product requirements into reliable, production-ready implementations while preserving the product's core purpose:

> Help aspiring and early-stage creators decide what to create, why it matters, how to create it, and what to do next based on their actual performance.

The product is not a generic AI writing application. Its core value is **creator decision support + execution + feedback**.

The central product loop is:

**Creator Profile → Audience Understanding → Opportunity Detection → Content Plan → Creation → Publishing → Analytics → AI Diagnosis → Improved Recommendations**

Long-term product value comes from learning creator-specific patterns over time.

---

## 2. Product Scope

The product is an AI-powered operating system for aspiring creators, micro-creators, personal-brand builders, UGC creators, and beginners.

The initial product areas are:

- Identity
- Strategy
- Ideas / Opportunities
- Creation / Content Studio
- Research
- Analytics & Growth
- Monetization

The MVP should launch narrowly around:

1. Creator onboarding
2. Personalized creator strategy
3. Opportunity engine
4. Content Studio
5. Basic analytics and AI diagnosis

Do not attempt to build the entire product at once.

---

## 3. Core Development Workflow

For every implementation request, follow this workflow unless the user explicitly instructs you to skip a step.

### Step 1 — Read the project instructions

Read this `AGENTS.md` before making implementation decisions.

### Step 2 — Read relevant skills

Read any skills explicitly relevant to the requested work.

Only use approved skills available to the project. Do not invent or assume skills that do not exist.

### Step 3 — Inspect the existing code

Before proposing implementation details, inspect the relevant:

- Routes
- Components
- Server actions
- API handlers
- Services
- Database schema
- Types
- AI utilities
- Background jobs
- Existing tests
- Configuration

Do not assume a file exists simply because it is described in a product document.

### Step 4 — Identify meaningful ambiguity

Ask a focused clarification question only when an unresolved decision would materially affect the implementation.

Do not ask unnecessary questions when the requirement and existing architecture already provide enough information.

### Step 5 — Create an implementation prompt

Before coding, create a detailed implementation prompt in:

```text
prompts/<feature-name>.md
```

The prompt must describe exactly what is going to be implemented.

### Step 6 — Request approval

After creating the prompt, ask:

> I prepared the implementation prompt at `prompts/<file-name>.md`. Is this good to execute?

Do not begin implementation before approval unless the user explicitly says to skip prompt creation/approval.

### Step 7 — Re-read the approved prompt

After approval, re-read the implementation prompt and implement strictly according to it.

Do not silently expand the scope.

### Step 8 — Implement

Make the smallest coherent set of changes needed to satisfy the approved requirements.

Preserve existing architecture unless the approved prompt explicitly changes it.

### Step 9 — Run checks

At minimum, run:

```bash
pnpm typecheck
pnpm lint
```

Run:

```bash
pnpm build
```

when routes, configuration, server modules, or other build-sensitive areas have changed.

Never claim a check passed unless it was actually run.

### Step 10 — Report the result

Report:

- What was implemented
- Files changed
- Database/schema changes, if any
- AI behavior changes, if any
- Tests/checks actually run
- Exact results
- Manual verification steps
- Any known limitations

---

## 4. Architecture Principles

Keep responsibilities separated.

The preferred high-level architecture is:

```text
Browser
   ↓
Next.js UI
   ↓
Authenticated Server Actions / Route Handlers
   ↓
Application Services
   ├── Supabase / PostgreSQL / RLS
   ├── AI Service
   ├── External Data Adapters
   ├── Background Jobs
   ├── Billing
   └── Observability
```

### UI layer

The UI is responsible for:

- Displaying application state
- Collecting user input
- Calling approved server actions or route handlers
- Presenting loading, empty, success, and error states

The UI must not directly:

- Call privileged AI providers
- Expose secret keys
- Modify protected database state
- Perform server-only research pipelines
- Run creator analytics calculations that belong in application services

### API / server layer

Route handlers and server actions should remain thin.

They should:

1. Authenticate the user
2. Validate input
3. Authorize access
4. Call the appropriate application service
5. Return a controlled result

Business logic should live in application/service modules rather than being duplicated across routes.

### Database layer

Supabase PostgreSQL is the source of truth for persistent application data.

Use Row Level Security where appropriate.

Do not introduce a second persistence system for core product data without an explicit architectural decision.

### AI layer

AI calls should be centralized through application-level AI services.

Do not scatter provider-specific model calls throughout UI components.

### Background jobs

Long-running or scheduled operations should run through the approved background-job mechanism rather than blocking normal UI requests.

---

## 5. Technology Stack

The product blueprint specifies:

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- Clerk
- Supabase PostgreSQL
- Supabase Row Level Security
- Supabase Storage
- Vercel AI SDK
- OpenAI, with optional Gemini or Anthropic support
- pgvector
- Inngest or Trigger.dev
- Vercel Cron
- Stripe
- Resend
- Zod
- Sentry / Vercel Analytics
- Vitest
- Playwright
- Vercel
- GitHub

Use the existing project implementation as the source of truth for which of these are already configured.

Do not introduce an alternative framework or infrastructure pattern merely because it is personally preferred.

---

## 6. Product Agent Architecture

The product contains two different kinds of agents.

### A. Development Agent

This is the engineering agent governed by this document.

Its responsibility is to inspect, plan, implement, test, and report changes to the SaaS application.

### B. Creator Intelligence Agents

These are product-level AI capabilities that operate on behalf of the creator.

The conceptual flow is:

```text
                 CREATOR AI ORCHESTRATOR
                          │
        ┌─────────────────┼─────────────────┐
        ↓                 ↓                 ↓
 Strategy Agent    Opportunity Agent   Research Agent
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ↓
                   Content Agent
                          ↓
                Calendar / Publishing
                          ↓
                    Analytics
                          ↓
                  Diagnosis Agent
                          ↓
                   Learning Agent
                          ↓
              Improved Recommendations
```

These agents should not be implemented as uncontrolled autonomous loops.

Each agent should have:

- A defined responsibility
- Explicit inputs
- Structured outputs
- Validation
- Access to only the data it needs
- Clear failure behavior
- Appropriate usage/cost controls

---

## 7. Creator Context

AI recommendations must be grounded in creator-specific context.

The context builder should be capable of assembling relevant information such as:

- Creator profile
- Brand voice
- Audience
- Niche
- Content pillars
- Platforms
- Goals
- Posting capacity
- Recent content
- Historical performance
- Research signals
- Creator insights
- Relevant competitor information

Do not generate personalized recommendations using generic prompts when relevant creator data is available.

The creator's historical performance should increasingly become part of the recommendation context.

---

## 8. Creator Intelligence Responsibilities

### Strategy Agent

Responsible for generating and maintaining:

- Positioning
- Audience profile
- 3–5 content pillars
- Format strategy
- Tone / voice profile
- Growth objective
- Monetization objective
- Initial 30-day strategy

The strategy should become persistent strategic memory rather than a one-time AI response.

---

### Opportunity Agent

Every opportunity should be an actionable object.

An opportunity can include:

- Topic
- Audience need
- Angle
- Hook
- Format
- Evidence
- Difficulty
- Expected fit
- CTA

Avoid unsupported or speculative "virality scores."

Prefer signals such as:

- Audience fit
- Evidence strength
- Trend signal
- Content gap

Opportunities should answer:

- What should the creator make?
- Why does it matter now?
- Who is it for?
- What angle should be used?
- What format fits?
- What should the creator do next?

---

### Research Agent

The research layer should use permitted and supported data sources.

Potential sources described by the product blueprint include:

- Official platform APIs
- YouTube Data API
- Search/trend APIs
- Reddit where terms/access permit
- Creator-provided competitor URLs or handles
- Comments
- Uploaded analytics
- Cached research signals

External data should be treated as an input to the strategy system rather than being blindly presented as truth.

Research should be cached where appropriate.

---

### Content Agent

The Content Studio should transform an opportunity or creator request into useful production material.

Expected outputs may include:

- Hooks
- Structured script
- Shot list
- Platform caption
- CTA
- Title
- Thumbnail concept
- Repurposing suggestions

AI outputs must be structured and validated.

---

### Calendar / Publishing

The calendar should help the creator turn recommendations into planned actions.

The product blueprint includes a calendar route and content scheduling concepts.

Publishing integrations should be added only when explicitly supported by the implementation plan and available APIs.

Do not claim that the product can publish to a platform unless the integration actually exists.

---

### Analytics Agent

Analytics should collect or accept relevant performance information such as:

- Views
- Watch time
- Retention
- Likes
- Comments
- Shares
- Saves
- Follower changes
- Content metadata

Performance analysis should primarily compare a creator against their own historical baseline rather than using simplistic universal benchmarks.

---

### Diagnosis Agent

The diagnosis system should investigate performance using:

- Creator baseline
- Topic
- Format
- Hook
- Length / duration
- Historical performance
- Audience response
- Follower changes around publishing

The output should be understandable in plain language.

Every diagnosis should lead toward an actionable next experiment or recommendation.

---

### Learning Agent

The learning layer should identify recurring patterns such as:

- Successful topics
- Successful hooks
- Successful formats
- Useful durations
- Effective CTAs
- Audience response patterns
- Repeated underperformance patterns

Learned signals should feed back into future recommendations.

Where appropriate, store learned signals in creator insight records and/or vector storage.

Do not treat a single unusually high-performing post as definitive evidence of a permanent creator preference.

---

## 9. AI Service Rules

AI functionality should be exposed through reusable application services.

The product blueprint identifies functions such as:

```text
generateCreatorStrategy()
generateContentOpportunities()
generateContentPackage()
analyzeContentPerformance()
extractAudiencePainPoints()
analyzeCompetitorContent()
updateCreatorInsights()
rewriteInCreatorVoice()
generateWeeklyPlan()
```

When implementing an AI capability:

1. Define the input schema
2. Define the output schema
3. Validate output with Zod
4. Build creator context
5. Call the configured model through the AI service
6. Handle malformed or failed output
7. Apply usage/cost controls
8. Persist useful results where appropriate
9. Return a controlled application result

### Prompt management

Keep important prompts organized and versionable.

Do not bury large product prompts inside UI components.

### Model routing

Use a model-routing layer where appropriate so model choice can change without rewriting business logic.

### Fallbacks

AI failures should be recoverable.

The UI should not crash because an AI provider fails.

### Regeneration

Support section-level regeneration where practical.

Do not regenerate an entire artifact when the creator only requested one section to change.

### Safety

Reject or transform requests involving:

- Impersonation
- Deceptive engagement
- Spam
- Prohibited content

Do not build functionality intended to manipulate engagement dishonestly.

---

## 10. Database Rules

The product blueprint identifies these core tables:

- `users`
- `subscriptions`
- `creator_profiles`
- `brand_profiles`
- `content_pillars`
- `content_ideas`
- `content_items`
- `content_versions`
- `analytics_snapshots`
- `competitors`
- `research_signals`
- `creator_insights`
- `ai_generations`
- `assets`
- `usage_events`
- `notifications`

Use these as the conceptual data model.

Before changing the schema:

1. Inspect the existing schema
2. Determine whether the required entity already exists
3. Prefer extending an existing model when appropriate
4. Add migrations for new persistent structures
5. Update generated/application types
6. Update RLS policies where required
7. Test authorization and data isolation

Every creator-owned record must be isolated correctly.

A creator must never be able to read or mutate another creator's private data.

---

## 11. Authentication and Authorization

Use Clerk for authentication where configured.

Use server-side authorization checks for protected operations.

Never trust creator/user IDs supplied by the browser without verifying the authenticated identity.

Supabase RLS should provide an additional database-level protection layer where configured.

Never expose:

- API keys
- Provider secrets
- Database service-role credentials
- Stripe secrets
- Other privileged credentials

to client-side code.

Use environment variables for secrets.

---

## 12. Research and External Data

External research must use supported APIs or permitted data providers.

Do not build scraping behavior simply because a website is publicly accessible.

Respect:

- API terms
- Access permissions
- Rate limits
- Data licensing
- Platform rules
- User privacy

Research data should be:

- Validated
- Timestamped where appropriate
- Deduplicated where appropriate
- Cached where appropriate
- Associated with its source

When a recommendation depends on external evidence, retain enough source information to explain where the signal came from.

---

## 13. Background Jobs

The product blueprint identifies background work such as:

- Daily opportunity generation
- Weekly strategy refresh
- Analytics refresh
- Competitor research
- Trend ingestion
- Insight extraction
- Email digest
- Cleanup

Background jobs should:

- Be idempotent where practical
- Handle retries
- Log failures
- Avoid duplicate records
- Respect usage limits
- Avoid blocking normal user requests
- Make execution status observable

Use the configured job runner and cron system rather than inventing a separate scheduler.

---

## 14. Dashboard and UX Rules

The dashboard should quickly answer:

> What should I do today?

The dashboard may include:

- Today's plan
- Top opportunity with evidence
- Quick Create
- Performance snapshot
- What AI learned
- Upcoming content
- Usage information

UX principles:

- Progressive disclosure
- Clear hierarchy
- Useful empty states
- Useful loading states
- Useful error states
- Every AI output should have a next action
- Section-level regeneration
- Auto-save/versioning where appropriate
- Explain recommendations and evidence
- Export/copy/download where appropriate

Do not create UI that looks complete while the underlying functionality is fake.

A button that claims to perform an action must either perform it or clearly indicate that the feature is not yet available.

---

## 15. Application Routes

The product blueprint identifies these major routes:

```text
/onboarding
/app
/app/strategy
/app/opportunities
/app/calendar
/app/studio
/app/studio/[id]
/app/analytics
/app/insights
/app/competitors
/app/research
/app/brand
/app/assets
/app/monetization
/app/settings
/app/billing
/app/help
```

Treat this as the target product map, not a guarantee that every route already exists.

Inspect the project before modifying or creating routes.

---

## 16. Implementation Prompt Requirements

Every implementation prompt under `prompts/` should include:

### Goal

What the feature is intended to accomplish.

### Skills Read

Which approved skills were consulted.

### Existing Code Inspected

Relevant files, routes, components, services, schema, and tests.

### Decisions / Assumptions

Explicit implementation decisions and assumptions.

### Files Likely to Change

Expected files and why.

### Database Changes

Tables, columns, indexes, constraints, migrations, and RLS changes.

### Implementation Requirements

Detailed functional requirements.

### AI Behavior

Where relevant:

- Input context
- Prompt behavior
- Model behavior
- Structured output
- Validation
- Error handling
- Persistence
- Usage controls

### Security Requirements

Authentication, authorization, RLS, secret handling, validation, and data isolation.

### Acceptance Criteria

Specific conditions that must be true when implementation is complete.

### Checks

Commands and automated tests to run.

### Manual Test Procedure

Exact steps a developer can follow to verify the feature.

For UI work, also document:

- Visual interpretation
- Layout
- Typography
- Spacing
- Component behavior
- Responsive behavior
- Loading states
- Empty states
- Error states
- Mobile behavior
- Relevant visual expectations

---

## 17. Testing Requirements

Use the project's configured testing tools.

The product blueprint identifies:

- Vitest
- Playwright

At minimum, test the behavior changed by the implementation.

Prioritize tests for:

- Authentication
- Authorization
- Creator data isolation
- AI output validation
- Critical server actions
- Database operations
- Usage metering
- Billing behavior
- Important user flows

For user-facing features, provide exact manual verification steps.

Do not claim tests passed if they were not run.

---

## 18. Error Handling and Recovery

All production-facing functionality must have predictable failure behavior.

Handle:

- Invalid user input
- Missing creator context
- Unauthorized access
- Database errors
- AI provider failures
- Rate limits
- External API failures
- Background job failures
- Missing analytics
- Malformed AI responses

Errors should be logged appropriately without exposing sensitive information to users.

User-facing errors should explain what happened and what the user can do next when possible.

---

## 19. Usage and Cost Controls

AI usage must be measurable.

The product blueprint includes `usage_events` and metered usage.

When implementing AI features, consider:

- Per-user limits
- Generation counts
- Token/cost tracking where available
- Expensive background jobs
- Repeated regeneration
- Caching
- Appropriate model selection

Do not create an AI feature that can unintentionally trigger uncontrolled provider costs.

---

## 20. Billing

Stripe is the specified billing provider.

Billing functionality should be isolated from unrelated creator intelligence logic.

Relevant areas include:

- Checkout
- Subscription state
- Usage limits
- Webhooks
- Billing page

Never trust client-side billing state for access control.

Verify subscription state server-side.

---

## 21. Observability

The product blueprint identifies:

- Sentry
- Vercel Analytics

Use appropriate logging and monitoring for:

- AI failures
- Background job failures
- API failures
- Important user actions
- Unexpected exceptions
- Performance issues

Avoid logging secrets or unnecessary private creator data.

---

## 22. Data Handling

The application should support appropriate creator data handling, including:

- Secure storage
- Creator data isolation
- Deletion/data handling
- Asset management
- Reliable persistence

Before shipping a feature that stores creator data, determine:

- What is stored
- Why it is stored
- Who can access it
- How it is deleted
- Whether it should be included in AI context

Do not send unrelated private creator data to an AI provider.

---

## 23. Development Phases

The product blueprint recommends the following implementation sequence.

### Phase 1 — Foundation

Build:

- App shell
- Authentication
- Database
- RLS
- Core types
- AI service
- Observability
- Basic settings

### Phase 2 — Creator Intelligence

Build:

- Onboarding
- Creator profile
- Brand voice
- Strategy generation
- Persistent strategy

### Phase 3 — Opportunity Engine

Build:

- Opportunities
- Evidence/signals
- Daily recommendations
- Calendar
- Weekly planning

### Phase 4 — Content Studio

Build:

- Content package generation
- Hooks
- Scripts
- Shot lists
- Captions
- CTAs
- Titles
- Thumbnail concepts
- Repurposing
- Save/edit/version

### Phase 5 — Analytics and Learning

Build:

- Analytics import/manual entry
- Performance snapshots
- AI diagnosis
- Creator insights
- Learning feedback loop

### Phase 6 — Billing

Build:

- Plans
- Checkout
- Subscription state
- Usage metering
- Webhooks

### Phase 7 — Reliability

Build:

- Error handling
- Monitoring
- Job retries
- Tests
- Data handling
- Performance improvements

### Phase 8 — Beta

Test with approximately 20–50 creators.

Use feedback to identify:

- Confusing workflows
- Weak recommendations
- Missing creator context
- AI quality issues
- Analytics gaps
- Reliability problems

### Phase 9 — Public Launch

Only after the product has reliable core workflows, appropriate observability, and working billing/data handling.

---

## 24. Definition of Done

A feature is not done merely because its UI renders.

Before considering a feature complete, verify as applicable:

- Authentication works
- Authorization works
- Creator data is isolated
- Database migrations are applied
- RLS is correct
- Types are updated
- Server/client boundaries are respected
- AI output is validated
- AI failures are recoverable
- Usage is metered where applicable
- Loading/empty/error states exist
- Data persists correctly
- Background work is reliable
- Tests pass
- Typecheck passes
- Lint passes
- Build passes when applicable
- Manual verification succeeds
- Observability is present where appropriate
- No secrets are exposed
- The implementation matches the approved prompt
- No unrelated scope was added

---

## 25. Final Engineering Rules

Keep implementation small and coherent.

Use the relevant existing skill rather than inventing a new workflow.

Inspect before changing.

Preserve server/client boundaries.

Keep Supabase as the source of truth for persistent application data.

Keep AI provider calls behind application services.

Validate structured AI output.

Ground recommendations in creator-specific context.

Prefer creator-specific historical evidence over generic assumptions when enough data exists.

Explain recommendations with evidence where possible.

Do not fabricate analytics, research signals, integrations, or platform capabilities.

Do not claim an external API or publishing integration exists unless it has actually been implemented and tested.

Do not code before the implementation prompt is approved unless the user explicitly says to skip that process.

Run checks after implementation.

Report exact checks and results.

The product should remain focused on its core loop:

**Understand the creator → identify opportunities → help create → measure performance → learn → improve the next recommendation.**