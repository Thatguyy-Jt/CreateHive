"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { AnalyticsFormState } from "@/app/app/analytics/actions";

export const IDLE: AnalyticsFormState = { status: "idle", message: null, fieldErrors: {}, submission: 0, values: {} };

type Action = (previous: AnalyticsFormState, formData: FormData) => Promise<AnalyticsFormState>;

/** `useActionState` for an analytics form, toasting `success` once per successful submission. */
export function useAnalyticsForm(action: Action, success?: string) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  // Strict Mode runs effects twice in development; toast each result once.
  const toasted = useRef<AnalyticsFormState | null>(null);

  useEffect(() => {
    if (!success || state.status !== "ok" || toasted.current === state) return;
    toasted.current = state;
    toast.success(success);
  }, [state, success]);

  return [state, formAction, pending] as const;
}
