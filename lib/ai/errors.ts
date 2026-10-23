import {
  APICallError,
  JSONParseError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  RetryError,
  TypeValidationError,
} from "ai";

export type AiErrorCode =
  | "disabled"
  | "not_configured"
  | "limit_reached"
  | "upgrade_required"
  | "plan_limit"
  | "invalid_output"
  | "rate_limited"
  | "timeout"
  | "provider_error"
  | "persistence_error";

/**
 * Creator-facing messages: what happened and what to do next. They never
 * include provider text, ids or prompts.
 */
export const AI_ERRORS: Record<AiErrorCode, { message: string; retryable: boolean }> = {
  disabled: {
    message: "AI features are paused right now. Your work is saved; please check back a little later.",
    retryable: false,
  },
  not_configured: {
    message: "AI features aren't available yet. Please try again later or contact support.",
    retryable: false,
  },
  limit_reached: {
    message:
      "You've reached today's AI safety limit. It frees up over the next 24 hours.",
    retryable: false,
  },
  upgrade_required: {
    message:
      "You've used this month's allowance for this on the Free plan. Upgrade to Pro for more, or wait for it to free up.",
    retryable: false,
  },
  plan_limit: {
    message: "You've used this month's allowance for this. It frees up as older uses pass 30 days.",
    retryable: false,
  },
  invalid_output: {
    message: "The AI returned an incomplete result. Please try again.",
    retryable: true,
  },
  rate_limited: {
    message: "The AI service is busy. Please wait a minute and try again.",
    retryable: true,
  },
  timeout: {
    message: "The AI took too long to respond. Please try again.",
    retryable: true,
  },
  provider_error: {
    message: "The AI service had a problem. Please try again in a moment.",
    retryable: true,
  },
  persistence_error: {
    message: "We couldn't start this generation. Please try again in a moment.",
    retryable: true,
  },
};

export type ProviderFailureCode = Extract<AiErrorCode, "invalid_output" | "rate_limited" | "timeout" | "provider_error">;

/** Maps an error thrown by `generateText` to a result code. */
export function classifyProviderError(error: unknown): ProviderFailureCode {
  // After the SDK's retry budget is spent, the cause is the last attempt's error.
  const cause = RetryError.isInstance(error) ? error.lastError : error;

  if (
    NoObjectGeneratedError.isInstance(cause) ||
    NoOutputGeneratedError.isInstance(cause) ||
    TypeValidationError.isInstance(cause) ||
    JSONParseError.isInstance(cause)
  ) {
    return "invalid_output";
  }
  if (APICallError.isInstance(cause) && cause.statusCode === 429) return "rate_limited";
  // The SDK's `timeout` aborts with a `TimeoutError`; nothing else aborts these calls.
  if (cause instanceof Error || (typeof DOMException === "function" && cause instanceof DOMException)) {
    if (cause.name === "TimeoutError" || cause.name === "AbortError") return "timeout";
  }
  return "provider_error";
}
