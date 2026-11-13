/**
 * Shared state for the V8 core. `core` holds per-frame values (scroll progress, pointer) that the
 * canvas reads inside its frame loop without React renders. `coreUi` is a tiny external store for
 * the values React must render (selected part, hovered part, exploded toggle).
 */

import { useSyncExternalStore } from "react";

import type { PartId } from "./parts";

export const core = {
  /** scroll progress through the pinned section, 0..1 */
  progress: 0,
  /** pointer in -1..1 over the stage (for camera parallax) */
  px: 0,
  py: 0,
  /** true while the stage is on screen */
  visible: false,
  reduced: false,
  /** drag-to-turn state, written by the stage's pointer handlers */
  drag: { yaw: 0, pitch: 0, vel: 0, moved: false },
};

/** DOM overlay elements the canvas writes to every frame (hover label, anatomy hotspots) */
export const coreOverlay: { tip: HTMLElement | null; spots: (HTMLElement | null)[]; stage: HTMLElement | null } = { tip: null, spots: [null, null, null], stage: null };

type Ui = {
  selected: PartId | null;
  hovered: PartId | null;
  /** null = follow the scroll story; true/false = user forced */
  exploded: boolean | null;
  /** the canvas has rendered its first frame */
  ready: boolean;
};

let ui: Ui = { selected: null, hovered: null, exploded: null, ready: false };
const subs = new Set<() => void>();

export const coreUi = {
  get: () => ui,
  set(patch: Partial<Ui>) {
    const next = { ...ui, ...patch };
    if ((Object.keys(patch) as (keyof Ui)[]).every((k) => next[k] === ui[k])) return;
    ui = next;
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

const serverUi: Ui = { selected: null, hovered: null, exploded: null, ready: false };
export function useCoreUi(): Ui {
  return useSyncExternalStore(coreUi.subscribe, coreUi.get, () => serverUi);
}
