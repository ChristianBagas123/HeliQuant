/**
 * Server-safe motion primitives. None of these need client JavaScript of their own: the reveal
 * observer in LandingShell sets `data-in`, and landing.css does the rest. Text is always present
 * in the DOM in its final form (screen readers and no-JS get the real content).
 */

import type { CSSProperties, ReactNode } from "react";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/** Section eyebrow: mono label with the status block. */
export function Eyebrow({ children, tone = "chartreuse" }: { children: ReactNode; tone?: "chartreuse" | "signal2" | "bitget" }) {
  const color = tone === "signal2" ? "text-signal2" : tone === "bitget" ? "text-bitget" : "text-chartreuse";
  return (
    <p data-reveal="rise" className="font-mono text-[11px] uppercase tracking-[0.3em] text-steel">
      <span className={color}>▮</span> {children}
    </p>
  );
}

/** Heading whose lines rise from behind a mask, one after another (80ms apart). */
export function LineHeading({
  lines,
  className = "",
  style,
  as: Tag = "h2",
}: {
  lines: ReactNode[];
  className?: string;
  style?: CSSProperties;
  as?: "h2" | "h3";
}) {
  return (
    <Tag data-reveal="lines" className={className} style={style}>
      {lines.map((line, i) => (
        <span key={i} className="ld-line">
          <span style={{ "--i": i } as Vars}>{line}</span>
        </span>
      ))}
    </Tag>
  );
}

/**
 * Hero headline: every letter slams in with a spring overshoot, 40ms apart inside a line.
 * `lines` are plain strings so the headline can be exposed once to assistive tech via aria-label.
 */
export function SlamHeadline({
  lines,
  className = "",
  style,
}: {
  lines: { text: string; className?: string }[];
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <h1 className={className} style={style} aria-label={lines.map((l) => l.text).join(" ")}>
      {lines.map((line, li) => {
        let n = 0;
        return (
          <span key={li} aria-hidden className={`block ${line.className ?? ""}`}>
            {line.text.split(" ").map((word, wi) => (
              <span key={wi}>
                <span className="ld-word">
                  {word.split("").map((ch, ci) => (
                    <span key={ci} className="ld-char" style={{ "--d": `${(li * 0.1 + n++ * 0.04).toFixed(2)}s` } as Vars}>
                      {ch}
                    </span>
                  ))}
                </span>{" "}
              </span>
            ))}
          </span>
        );
      })}
    </h1>
  );
}

/**
 * Odometer: digits roll from 0 to the value that is passed in — always a real figure copied from
 * the firm's data. Resting state, no-JS state and reduced-motion state all show the real value.
 */
export function Odometer({ value, className = "" }: { value: string; className?: string }) {
  let i = 0;
  return (
    <span data-reveal="odo" className={className}>
      <span className="sr-only">{value}</span>
      <span aria-hidden className="ld-odo">
        {value.split("").map((ch, k) =>
          /\d/.test(ch) ? (
            <span key={k} className="ld-odo-col" style={{ "--n": Number(ch), "--i": i++ } as Vars}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          ) : (
            <span key={k}>{ch}</span>
          ),
        )}
      </span>
    </span>
  );
}

/** CSS custom-property helper for stagger indices and delays. */
export const vars = (v: Record<`--${string}`, string | number>) => v as Vars;
