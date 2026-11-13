"use client";

/**
 * Post-processing for the high tier only: ONE pass — a soft bloom that lifts the chartreuse
 * livery. Loaded as its own lazy chunk so medium-tier devices never download it. No depth of
 * field, no chromatic aberration (cut for cost).
 */

import { Bloom, EffectComposer } from "@react-three/postprocessing";

export default function Effects() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.6} luminanceSmoothing={0.25} radius={0.7} />
    </EffectComposer>
  );
}
