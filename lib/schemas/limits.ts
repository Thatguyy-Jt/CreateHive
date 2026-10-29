// Input limits and defaults shared by the Zod schemas and the client forms
// (`maxLength`, counters, default values), with no Zod import so forms don't
// ship Zod.
// tests/schemas/client-safe.test.ts keeps this file free of `zod`.

// Posts (analytics.ts)
export const TITLE_MAX = 200;
export const FORMAT_MAX = 60;

// Research signals (research.ts)
export const MANUAL_TEXT_MAX = 1000;

// Calendar (calendar.ts)
/** Default time for new items. We don't recommend posting times. */
export const DEFAULT_TIME = "09:00";
