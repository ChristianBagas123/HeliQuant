/**
 * Landing runtime state shared between the DOM layer and the 3D canvas.
 * `scene` is a plain mutable object read inside animation frames (never React state: per-frame
 * values must not trigger renders). `quality` is a tiny external store for the render tier.
 */

import { useSyncExternalStore } from "react";

/** Token mirror for places that cannot read CSS variables (WebGL). Values = app/globals.css @theme. */
export const TOKENS = {
  pitch: "#0b0b0b",
  carbon: "#161614",
  carbon2: "#1e1e1b",
  bone: "#f2efe6",
  chartreuse: "#c9f24b",
  steel: "#8b8b80",
  signal: "#ff5a1f",
} as const;

export const scene = {
  /** scroll position (px) and velocity (px per frame, signed) */
  y: 0,
  v: 0,
  /** pointer in normalised device coords, -1..1 (0,0 = centre) */
  px: 0,
  py: 0,
  /** 1 while the rotor is held (rev easter egg) */
  rev: 0,
  /** the tach needle's reading, 0–100 (written by the hero's engine simulation) */
  rpm: 10,
  /** the needle's resting (idle) reading — the 3D rotor measures revs above it */
  idle: 10,
  /** counts gear shifts; the 3D rig flashes when it changes. shiftUp: 1 = upshift, 0 = downshift */
  shift: 0,
  shiftUp: 1,
};

export type Quality = "high" | "medium" | "low";

let current: Quality = "low";
const subs = new Set<() => void>();

export const quality = {
  get: (): Quality => current,
  set(next: Quality) {
    if (next === current) return;
    current = next;
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

/**
 * prefers-reduced-motion as a hydration-safe hook: the server and the hydration pass both read
 * "false", then the client value applies. (Reading matchMedia during the first client render makes
 * server and client text differ and React throws a hydration error.)
 */
const subscribeReduced = (cb: () => void) => {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const getReduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const getReducedServer = () => false;
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, getReduced, getReducedServer);
}

const serverQuality = (): Quality => "low";
export function useQuality(): Quality {
  return useSyncExternalStore(quality.subscribe, quality.get, serverQuality);
}

/**
 * Pick the starting tier from feature detection (not user agent):
 *  low    = static fallback (reduced motion, no WebGL, or ?gl=off for testing)
 *  medium = 3D without post-processing (touch devices, few cores, little memory)
 *  high   = 3D + bloom
 * The canvas can still step a tier down later from measured frame time.
 */
export function detectQuality(): Quality {
  if (typeof window === "undefined") return "low";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "low";
  const forced = new URLSearchParams(window.location.search).get("gl"); // testing hook: ?gl=off | ?gl=medium
  if (forced === "off") return "low";
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return "low";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    return "low";
  }
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (forced === "medium" || coarse || cores <= 4 || memory <= 4) return "medium";
  return "high";
}
