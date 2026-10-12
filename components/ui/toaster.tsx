"use client";

import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

// Sonner's own variables, mapped to our semantic tokens so toasts follow the
// light/dark theme like everything else.
const TOKENS = {
  "--normal-bg": "var(--surface)",
  "--normal-text": "var(--foreground)",
  "--normal-border": "var(--border)",
  "--border-radius": "var(--radius-md)",
  "--width": "22.5rem",
} as CSSProperties;

/** The app's single toaster. Confirmations only; errors stay inline. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      offset={16}
      mobileOffset={16}
      style={TOKENS}
      containerAriaLabel="Notifications"
      toastOptions={{
        closeButtonAriaLabel: "Dismiss notification",
        classNames: {
          toast: "toast",
          title: "toast-title",
          description: "toast-description",
          actionButton: "toast-action",
          closeButton: "toast-close",
          icon: "toast-icon",
        },
      }}
    />
  );
}
