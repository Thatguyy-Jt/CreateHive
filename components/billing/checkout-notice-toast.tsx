"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Only these codes are accepted; every word shown comes from here, never the URL.
const NOTICES = {
  success: { kind: "success", title: "Payment received", description: "Your plan is active. Enjoy the extra AI allowance." },
  pending: {
    kind: "info",
    title: "Payment still processing",
    description: "We'll update your plan as soon as the provider confirms it. Use Check status below.",
  },
  failed: { kind: "error", title: "Payment didn't go through", description: "Nothing was charged. You can try again." },
} as const;

/** Shows the toast for a `?checkout=` return once, then strips the parameter. Renders nothing. */
export function CheckoutNoticeToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const shown = useRef<string | null>(null);
  const code = params.get("checkout");

  useEffect(() => {
    if (!code) return;
    if (shown.current !== code && code in NOTICES) {
      shown.current = code;
      const notice = NOTICES[code as keyof typeof NOTICES];
      const show = notice.kind === "success" ? toast.success : notice.kind === "error" ? toast.error : toast.info;
      show(notice.title, { description: notice.description });
    }
    const rest = new URLSearchParams(params.toString());
    rest.delete("checkout");
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [code, params, pathname, router]);

  return null;
}
