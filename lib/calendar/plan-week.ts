import { daysBetween, localDateKey, weekStart } from "./dates";

/** Weeks in the strategy's 30-day plan. */
export const PLAN_WEEKS = 4;

/**
 * The week of the plan the target week falls in, counted from the Monday of
 * the week the strategy was saved, in `tz`. Not capped at 4. Null for invalid
 * input or a target before the strategy was saved.
 */
export function elapsedPlanWeek(strategySavedAt: string, targetWeek: string, tz: string): number | null {
  const savedDay = localDateKey(strategySavedAt, tz);
  const start = savedDay ? weekStart(savedDay) : null;
  const days = start ? daysBetween(start, targetWeek) : null;
  if (days === null || days < 0) return null;
  return Math.floor(days / 7) + 1;
}

/** The 30-day plan week (1 to 4) the target week falls in, or null outside the plan. */
export function planWeekNumber(strategySavedAt: string, targetWeek: string, tz: string): number | null {
  const week = elapsedPlanWeek(strategySavedAt, targetWeek, tz);
  return week !== null && week <= PLAN_WEEKS ? week : null;
}
