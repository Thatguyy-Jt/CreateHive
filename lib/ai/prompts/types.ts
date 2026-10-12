/**
 * One versioned prompt. Never edit a published version in place: add
 * `v<N+1>.ts` and point the registry at it, so `ai_generations.prompt_version`
 * always identifies the exact text that ran.
 */
export interface PromptDefinition<Kind extends string, Input> {
  kind: Kind;
  /** Recorded in `ai_generations.prompt_version`, for example "v1". */
  version: string;
  /** Sent as the model's instructions. */
  system: string;
  /** Builds the user message from only the input this task needs. */
  buildUser: (input: Input) => string;
}
