"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * `?plan=pro` (from /pricing and Upgrade buttons): brings the Pro card into
 * view and outlines it once. Never starts a checkout. Renders nothing.
 */
export function PlanFocus({ targetId }: { targetId: string }) {
  const params = useSearchParams();
  const done = useRef(false);
  const wanted = params.get("plan") === "pro";

  useEffect(() => {
    if (!wanted || done.current) return;
    const card = document.getElementById(targetId);
    if (!card) return;
    done.current = true;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    card.focus({ preventScroll: true });
    card.classList.add("plan-card-focus");
    const clear = () => card.classList.remove("plan-card-focus");
    card.addEventListener("blur", clear, { once: true });
  }, [wanted, targetId]);

  return null;
}
