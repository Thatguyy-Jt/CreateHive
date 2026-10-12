import type { PromptDefinition } from "../types";

/**
 * Used only by the opt-in live test to prove the end-to-end path (key, model,
 * structured output, metering). Contains no creator data.
 */
export const smokeTestV1: PromptDefinition<"smoke_test", { word: string }> = {
  kind: "smoke_test",
  version: "v1",
  system:
    "You are a connectivity check. Reply only with the requested JSON object. " +
    'Set "status" to "ok" and "echo" to the exact word you are given.',
  buildUser: ({ word }) => `Word: ${word}`,
};
