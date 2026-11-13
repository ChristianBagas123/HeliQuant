"use client";

/** CopyButton — copies a string to the clipboard and confirms for a moment. Fails quietly. */

import { useEffect, useState } from "react";

export default function CopyButton({ text, label = "copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1400);
    return () => window.clearTimeout(t);
  }, [done]);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(() => setDone(true), () => {});
      }}
      className={`bay-copy ${className}`}
      data-done={done ? "" : undefined}
      aria-label={done ? "copied" : `${label} to clipboard`}
    >
      {done ? "✓ copied" : label}
    </button>
  );
}
