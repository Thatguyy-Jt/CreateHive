import { z } from "zod";

// Read lazily, on first use, so `next build` and the test suite run without
// Supabase credentials. Errors name the missing variables, never their values.

const publicConfigSchema = z.object({
  // The project origin only. supabase-js appends `/rest/v1` itself, so a URL
  // copied with that path would silently 404 on every request.
  SUPABASE_URL: z.url({ protocol: /^https?$/ }).refine((value) => {
    // Zod still runs refinements after z.url() fails; that failure is
    // already reported, so only judge values that parse.
    if (!URL.canParse(value)) return true;
    const url = new URL(value);
    return url.pathname === "/" && !url.search && !url.hash;
  }, "must be the project URL only, like https://<ref>.supabase.co, with no path such as /rest/v1"),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const secretKeySchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
});

type EnvSource = Record<string, string | undefined>;

export class SupabaseEnvError extends Error {
  constructor(
    readonly variables: string[],
    reasons: string[],
  ) {
    super(`Missing or invalid Supabase environment variables: ${reasons.join("; ")}`);
    this.name = "SupabaseEnvError";
  }
}

function parse<T>(schema: z.ZodType<T>, source: EnvSource): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Zod messages describe the rule, never the value, so they are safe to show.
    const issues = result.error.issues;
    throw new SupabaseEnvError(
      issues.map((issue) => issue.path.join(".")),
      issues.map((issue) => `${issue.path.join(".")} ${issue.message}`),
    );
  }
  return result.data;
}

/** URL and publishable key: safe to use for requests made as the signed-in creator. */
export function getSupabaseConfig(source: EnvSource = process.env) {
  const env = parse(publicConfigSchema, source);
  return { url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY };
}

/** Secret (service-role) key. Only `lib/supabase/admin.ts` may call this. */
export function getSupabaseSecretKey(source: EnvSource = process.env) {
  return parse(secretKeySchema, source).SUPABASE_SECRET_KEY;
}
