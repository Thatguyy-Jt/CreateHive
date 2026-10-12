"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { parseStrategyNotice, REGENERATE_BUTTON_ID, strategyNoticeCopy } from "@/lib/strategy-notices";

function focusRegenerateButton() {
  const button = document.getElementById(REGENERATE_BUTTON_ID);
  if (!button) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  button.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  button.focus({ preventScroll: true });
}

/**
 * Shows the toast for a `?notice=` redirect once, then strips the parameters
 * so a refresh or Back doesn't show it again. Renders nothing.
 */
export function StrategyNoticeToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Strict Mode runs effects twice in development; show each notice once.
  const shown = useRef<string | null>(null);

  const notice = params.get("notice");
  const version = params.get("v");

  useEffect(() => {
    const parsed = parseStrategyNotice({ notice, v: version });
    if (!notice) return;

    const key = `${notice}:${version ?? ""}`;
    if (parsed && shown.current !== key) {
      shown.current = key;
      const copy = strategyNoticeCopy(parsed);
      toast.success(copy.title, {
        description: copy.description ?? undefined,
        duration: copy.durationMs,
        action: copy.regenerateAction ? { label: "Regenerate now", onClick: focusRegenerateButton } : undefined,
      });
    }
    // Unknown notices are dropped too, so a stale or forged URL cleans itself up.
    const rest = new URLSearchParams(params.toString());
    rest.delete("notice");
    rest.delete("v");
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [notice, version, params, pathname, router]);

  return null;
}
