// One-shot confirmations shown as a toast on /app/strategy after a server
// action redirects there with `?notice=<code>` (and `&v=<version>`). Only these
// codes are accepted, and every word shown comes from this file, never the URL.

export const STRATEGY_NOTICE_CODES = ["strategy_created", "strategy_regenerated", "profile_saved"] as const;
export type StrategyNoticeCode = (typeof STRATEGY_NOTICE_CODES)[number];

export interface StrategyNotice {
  code: StrategyNoticeCode;
  version: number | null;
}

type ParamValue = string | string[] | null | undefined;

const first = (value: ParamValue) => (Array.isArray(value) ? value[0] : value) ?? null;

function isNoticeCode(value: string): value is StrategyNoticeCode {
  return (STRATEGY_NOTICE_CODES as readonly string[]).includes(value);
}

/** Reads `notice` and `v`; returns null for a missing or unknown notice. */
export function parseStrategyNotice(params: { notice?: ParamValue; v?: ParamValue }): StrategyNotice | null {
  const code = first(params.notice);
  if (!code || !isNoticeCode(code)) return null;
  const raw = first(params.v);
  const version = raw && /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
  return { code, version };
}

/** Builds the redirect target for a notice. */
export function strategyNoticeHref(code: StrategyNoticeCode, version?: number): string {
  const params = new URLSearchParams({ notice: code });
  if (version && Number.isInteger(version) && version > 0) params.set("v", String(version));
  return `/app/strategy?${params.toString()}`;
}

export interface StrategyNoticeCopy {
  title: string;
  description: string | null;
  /** The profile-saved toast offers a shortcut to the Regenerate control. */
  regenerateAction: boolean;
  durationMs: number;
}

export function strategyNoticeCopy({ code, version }: StrategyNotice): StrategyNoticeCopy {
  switch (code) {
    case "strategy_created":
      return { title: "Your strategy is ready", description: "Start with week 1 below.", regenerateAction: false, durationMs: 6000 };
    case "strategy_regenerated":
      return {
        title: "Your strategy has been regenerated",
        description: version ? `Version ${version}` : null,
        regenerateAction: false,
        durationMs: 6000,
      };
    case "profile_saved":
      return {
        title: "Profile saved",
        description: "Your strategy still reflects your previous answers. Regenerate it when you want it updated.",
        regenerateAction: true,
        durationMs: 10000,
      };
  }
}

/** Element id of the "Regenerate strategy" button the profile-saved toast points to. */
export const REGENERATE_BUTTON_ID = "regenerate-strategy";
