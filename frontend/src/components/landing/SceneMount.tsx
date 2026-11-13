"use client";

/**
 * SceneMount — decides IF and WHEN the 3D canvas loads.
 * It waits until the hero is on screen (preloader finished) and a moment of idle, then pulls the
 * three.js chunk with next/dynamic (ssr: false). On the low tier (reduced motion, no WebGL, lost
 * context, measured slow frames, or ?gl=off) nothing is loaded and the static SVG rotor stays.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

import { useQuality } from "./store";

const EngineCanvas = dynamic(() => import("./scene/EngineCanvas"), { ssr: false });

export default function SceneMount() {
  const tier = useQuality();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const root = document.getElementById("ld-root");
    if (!root) return;
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => setArmed(true), 400);
    };
    if (root.dataset.ready) {
      arm();
      return () => window.clearTimeout(timer);
    }
    const mo = new MutationObserver(() => {
      if (!root.dataset.ready) return;
      mo.disconnect();
      arm();
    });
    mo.observe(root, { attributes: true, attributeFilter: ["data-ready"] });
    return () => {
      mo.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  if (!armed || tier === "low") return null;
  return <EngineCanvas tier={tier} />;
}
