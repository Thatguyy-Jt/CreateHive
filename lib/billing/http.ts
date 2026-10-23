import type { z } from "zod";

export const PROVIDER_TIMEOUT_MS = 15_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Provider call outcome. `code` is safe to log: an HTTP status, a provider
 * response code, or one of our own tokens. Never a body, key or reference.
 */
export type ProviderResult<T> = { ok: true; data: T } | { ok: false; code: string; transient: boolean };

export const providerFail = <T>(code: string, transient: boolean): ProviderResult<T> => ({ ok: false, code, transient });

/** Calls a provider and parses the JSON body with `schema`. Never throws. */
export async function callJson<S extends z.ZodType>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  schema: S,
): Promise<ProviderResult<z.infer<S>>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), cache: "no-store" });
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    return providerFail(name === "TimeoutError" ? "timeout" : "network", true);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return providerFail(`http_${response.status}`, response.status >= 500);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // A 4xx with an unexpected body is still a rejection, not a bad response.
    if (!response.ok) return providerFail(`http_${response.status}`, response.status >= 500 || response.status === 429);
    return providerFail("invalid_response", false);
  }
  if (!response.ok) return providerFail(`http_${response.status}`, response.status >= 500 || response.status === 429);
  return { ok: true, data: parsed.data };
}
