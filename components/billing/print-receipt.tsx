"use client";

import { useEffect, useRef } from "react";

/** "Print / Save as PDF". With `auto`, opens the print dialog once on load (the Download action). */
export function PrintReceipt({ auto }: { auto: boolean }) {
  const printed = useRef(false);

  useEffect(() => {
    if (!auto || printed.current) return;
    printed.current = true;
    window.print();
  }, [auto]);

  return (
    <button type="button" className="btn btn-primary btn-sm no-print" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  );
}
