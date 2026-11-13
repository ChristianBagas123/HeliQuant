"use client";

/**
 * EngineCanvas — the ONE WebGL canvas of the landing (lazy chunk; never on the server).
 *
 * A procedural six-blade turbine built from the brand mark's geometry: hex hub ring, six tapered
 * twisted blades, six ring arcs. No models, no texture files, no third-party assets. A lacquered metallic finish with
 * reflections from a code-built studio environment, a sweeping glint light and twinkling glitter.
 *
 * The canvas is fixed behind the content and screen-blended over the page, so black is
 * transparent and the rotor reads as light. In the hero it locks onto the tachometer hub (a DOM
 * anchor); past the hero it glides to a dim "ghost" position per section, so the camera appears to
 * travel through the engine as the page scrolls. In the hero it faces the viewer head-on (no tilt,
 * no cursor lean); at the ghost positions it tilts and leans toward the cursor. It spins faster with
 * scroll speed, runs up on the dyno, stalls at the crash, and revs while the hub is held.
 *
 * Per-frame values mutate three objects directly (no React state). The loop stops when the tab is
 * hidden. Frame time is measured: a sustained slow frame steps the quality tier down
 * (high → medium → low), and a lost context falls back to the static rotor.
 */

import { Component, Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { TOKENS, quality, scene, type Quality } from "../store";

const Effects = lazy(() => import("./Effects"));

const BLADES = 6;
const LIGHT = { ambient: 0.35, key: 2.4, rim: 0.9, glint: 3.2, glow: 0.14, env: 1.25 };
const SPARKLES = 54;

/**
 * Glitter on the rotor: tiny star flares that twinkle along the blade edges and the ring arcs.
 * Additive, so it only ever adds light. Brightens on a gear shift.
 */
const SPARKLE_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uScale;
  uniform float uH;
  uniform float uFlash;
  varying float vTw;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = pow(max(0.0, sin(uTime * aSpeed + aPhase)), 14.0);
    vTw = min(1.0, tw + uFlash * (0.55 + 0.45 * sin(aPhase * 7.0)));
    gl_PointSize = aSize * uScale * projectionMatrix[1][1] * uH * 0.5 / -mv.z * (0.6 + 0.6 * vTw);
    gl_Position = projectionMatrix * mv;
  }
`;
const SPARKLE_FRAG = /* glsl */ `
  uniform float uDim;
  uniform vec3 uColor;
  varying float vTw;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float core = exp(-dot(p, p) * 16.0);
    float flare = exp(-abs(p.x) * 26.0) * exp(-p.y * p.y * 2.5) + exp(-abs(p.y) * 26.0) * exp(-p.x * p.x * 2.5);
    float a = (core + flare * 0.75) * vTw * uDim;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

function buildSparkles(): THREE.BufferGeometry {
  const pos = new Float32Array(SPARKLES * 3);
  const phase = new Float32Array(SPARKLES);
  const speed = new Float32Array(SPARKLES);
  const size = new Float32Array(SPARKLES);
  // deterministic scatter (no Math.random): the same glitter on every load
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < SPARKLES; i++) {
    let r: number;
    let a: number;
    if (i % 3 === 2) {
      // on a ring arc
      r = 0.72;
      a = ((41 + Math.floor(rnd() * 6) * 60 + rnd() * 38) * Math.PI) / 180;
    } else {
      // along a blade's leading edge
      const t = 0.15 + rnd() * 0.85;
      r = R_ROOT + (R_TIP - R_ROOT) * t;
      a = ((30 + Math.floor(rnd() * 6) * 60) * Math.PI) / 180 + (0.118 * Math.pow(1 - t, 0.85) + 0.02) / r;
    }
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(a) * r;
    pos[i * 3 + 2] = 0.07;
    phase[i] = rnd() * Math.PI * 2;
    speed[i] = 0.9 + rnd() * 1.8;
    size[i] = 0.07 + rnd() * 0.09;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  g.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  return g;
}
const R_ROOT = 0.4;
const R_TIP = 1.0;

/** One blade along +X: tapered, slightly swept, extruded, then twisted about its own axis. */
function buildBlade(): THREE.BufferGeometry {
  const N = 12;
  const lead: [number, number][] = [];
  const trail: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = R_ROOT + (R_TIP - R_ROOT) * t;
    const half = 0.118 * Math.pow(1 - t, 0.85) + 0.012;
    const sweep = 0.05 * t * t;
    lead.push([x, sweep + half]);
    trail.push([x, sweep - half * 0.86]);
  }
  const shape = new THREE.Shape();
  shape.moveTo(lead[0][0], lead[0][1]);
  for (const [x, y] of lead) shape.lineTo(x, y);
  shape.lineTo(R_TIP + 0.05, 0.05);
  for (let i = trail.length - 1; i >= 0; i--) shape.lineTo(trail[i][0], trail[i][1]);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: 1, steps: 1, curveSegments: 2 });
  geo.translate(0, 0, -0.035);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = Math.min(1, Math.max(0, (x - R_ROOT) / (R_TIP - R_ROOT)));
    const a = 0.52 - 0.36 * t; // pitch: steep at the root, flat at the tip
    pos.setXYZ(i, x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Ghost positions past the hero, as fractions of the viewport: x, y, size (of the short side), dim, tilt. */
type Stop = { x: number; y: number; size: number; dim: number; rx: number; ry: number };
const STOPS: Record<string, Stop> = {
  loop: { x: 0.95, y: 0.26, size: 0.62, dim: 0.14, rx: -0.5, ry: -0.45 },
  engine: { x: 0.5, y: 0.56, size: 1.12, dim: 0.06, rx: -0.15, ry: 0 },
  dyno: { x: 0.05, y: 0.8, size: 0.78, dim: 0.15, rx: -0.55, ry: 0.5 },
  crash: { x: 0.94, y: 0.78, size: 0.66, dim: 0.1, rx: 0.35, ry: -0.6 },
  report: { x: 0.97, y: 0.2, size: 0.5, dim: 0.08, rx: -0.4, ry: -0.5 },
  blackbox: { x: 0.03, y: 0.3, size: 0.6, dim: 0.11, rx: -0.3, ry: 0.55 },
  garage: { x: 0.93, y: 0.84, size: 0.74, dim: 0.14, rx: -0.6, ry: -0.4 },
  footer: { x: 0.5, y: 1.02, size: 1.0, dim: 0.14, rx: -0.9, ry: 0 },
};
const MOBILE_STOP: Stop = { x: 0.5, y: 0.5, size: 1.2, dim: 0.05, rx: -0.25, ry: 0 };

type Layout = { sections: { id: string; top: number }[]; anchor: { x: number; y: number; d: number } | null; mobile: boolean };

/** Page offset from the offsetParent chain: unlike getBoundingClientRect it ignores CSS transforms. */
function pageOffset(el: HTMLElement) {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

function Rig() {
  const group = useRef<THREE.Group>(null);
  const rotor = useRef<THREE.Group>(null);
  const blades = useRef<THREE.InstancedMesh>(null);
  const arcs = useRef<THREE.InstancedMesh>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const rim = useRef<THREE.DirectionalLight>(null);
  const glint = useRef<THREE.DirectionalLight>(null);
  const glow = useRef<THREE.MeshStandardMaterial | null>(null);
  const mats = useRef<{ livery: THREE.MeshPhysicalMaterial; steel: THREE.MeshPhysicalMaterial; sparkle: THREE.ShaderMaterial } | null>(null);
  const size = useThree((s) => s.size);
  const viewport = useThree((s) => s.viewport);
  const gl = useThree((s) => s.gl);
  const wrap = useRef<HTMLElement | null>(null);
  const layout = useRef<Layout | null>(null);
  const cur = useRef({ flash: 0, lastShift: scene.shift, init: false, locked: false, live: false, x: 0, y: 0, d: 100, dim: 0, shown: -1, rx: 0, ry: 0, omega: 0.45, t: 0, intro: 0.7, acc: 0, n: 0, warm: false, slow: 0 });

  const parts = useMemo(() => {
    const blade = buildBlade();
    // faceted look from real per-face normals (non-indexed geometry), not from flatShading:
    // derivative-based normals can go NaN on sliver triangles and bloom smears a NaN over the frame
    const faceted = (g: THREE.BufferGeometry) => {
      const flat = g.toNonIndexed();
      g.dispose();
      flat.computeVertexNormals();
      return flat;
    };
    const arc = faceted(new THREE.TorusGeometry(0.72, 0.034, 4, 8, (38 * Math.PI) / 180));
    const hex = faceted(new THREE.TorusGeometry(0.36, 0.07, 4, 6));
    const nut = faceted(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 6));
    // lacquered metallic livery: metal base, a clear coat on top, a faint pearl (iridescent) shift
    const livery = new THREE.MeshPhysicalMaterial({
      color: TOKENS.chartreuse,
      metalness: 0.78,
      roughness: 0.24,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      iridescence: 0.4,
      iridescenceIOR: 1.45,
      iridescenceThicknessRange: [180, 520],
      emissive: TOKENS.chartreuse,
      emissiveIntensity: 0,
      envMapIntensity: 0,
    });
    // polished chrome hub nut
    const steel = new THREE.MeshPhysicalMaterial({ color: TOKENS.bone, metalness: 1, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0 });
    const sparkleGeo = buildSparkles();
    const sparkleMat = new THREE.ShaderMaterial({
      vertexShader: SPARKLE_VERT,
      fragmentShader: SPARKLE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1 },
        uH: { value: 800 },
        uFlash: { value: 0 },
        uDim: { value: 0 },
        uColor: { value: new THREE.Color("#fbffe6") },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { blade, arc, hex, nut, livery, steel, sparkleGeo, sparkleMat };
  }, []);

  useEffect(
    () => () => {
      parts.blade.dispose();
      parts.arc.dispose();
      parts.hex.dispose();
      parts.nut.dispose();
      parts.livery.dispose();
      parts.steel.dispose();
      parts.sparkleGeo.dispose();
      parts.sparkleMat.dispose();
    },
    [parts],
  );

  // reflections: a studio environment generated in code (no texture files), applied per material so
  // the per-section dimming can scale it through envMapIntensity
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.03).texture;
    room.dispose();
    pmrem.dispose();
    const m = mats.current;
    if (m) {
      for (const mat of [m.livery, m.steel]) {
        mat.envMap = env;
        mat.needsUpdate = true;
      }
    }
    return () => {
      if (m) {
        m.livery.envMap = null;
        m.steel.envMap = null;
      }
      env.dispose();
    };
  }, [gl, parts]);

  // place the six blades and the six arcs between them
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    for (let i = 0; i < BLADES; i++) {
      m.makeRotationZ(((30 + i * 60) * Math.PI) / 180);
      blades.current?.setMatrixAt(i, m);
      m.makeRotationZ(((41 + i * 60) * Math.PI) / 180);
      arcs.current?.setMatrixAt(i, m);
    }
    if (blades.current) blades.current.instanceMatrix.needsUpdate = true;
    if (arcs.current) arcs.current.instanceMatrix.needsUpdate = true;
    glow.current = parts.livery; // mutated per frame through the ref (dimming)
    mats.current = { livery: parts.livery, steel: parts.steel, sparkle: parts.sparkleMat };
  }, [parts]);

  // measure the DOM once per layout change — never inside the frame loop
  useEffect(() => {
    const root = document.getElementById("ld-root");
    if (!root) return;
    wrap.current = gl.domElement.closest<HTMLElement>(".ld-canvas");
    const measure = () => {
      const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-scene]")).map((el) => ({ id: el.dataset.scene ?? "", top: pageOffset(el).y }));
      const tach = root.querySelector<HTMLElement>("[data-turbine-anchor]")?.closest<HTMLElement>(".ld-tach") ?? null;
      let anchor: Layout["anchor"] = null;
      if (tach) {
        const o = pageOffset(tach);
        anchor = { x: o.x + tach.offsetWidth / 2, y: o.y + tach.offsetHeight / 2, d: tach.offsetWidth * 0.52 };
      }
      layout.current = { sections, anchor, mobile: window.innerWidth < 768 };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      delete root.dataset.gl;
    };
  }, [gl]);

  useFrame((_, rawDt) => {
    const L = layout.current;
    const g = group.current;
    const r = rotor.current;
    if (!L || !g || !r) return;
    const c = cur.current;
    const dt = Math.min(rawDt, 0.05);
    c.t += dt;
    const w = size.width;
    const h = size.height;

    // which section owns the middle of the viewport
    const mid = scene.y + h * 0.5;
    let id = L.sections[0]?.id ?? "hero";
    for (const s of L.sections) {
      if (s.top <= mid) id = s.id;
      else break;
    }
    const hero = id === "hero" && L.anchor !== null;

    let tx: number, ty: number, td: number, tdim: number, trx: number, tryy: number;
    if (hero && L.anchor) {
      tx = L.anchor.x;
      ty = L.anchor.y - scene.y;
      td = L.anchor.d;
      tdim = 1;
      // face-on in the hero: the rotor sits in the tach hub, so no tilt and no cursor lean
      trx = 0;
      tryy = 0;
    } else {
      const s = L.mobile ? MOBILE_STOP : (STOPS[id] ?? STOPS.loop);
      tx = s.x * w;
      ty = s.y * h;
      td = s.size * Math.min(w, h);
      tdim = s.dim;
      trx = s.rx;
      tryy = s.ry;
    }

    if (!c.init) {
      c.init = true;
      c.x = tx;
      c.y = ty;
      c.d = td;
      c.rx = trx;
      c.ry = tryy;
    }
    if (hero) {
      if (c.locked) {
        c.x = tx;
        c.y = ty;
        c.d = td;
      } else {
        const k = 1 - Math.exp(-dt * 9);
        c.x += (tx - c.x) * k;
        c.y += (ty - c.y) * k;
        c.d += (td - c.d) * k;
        if (Math.hypot(tx - c.x, ty - c.y) < 2 && Math.abs(td - c.d) < 2) c.locked = true;
      }
    } else {
      c.locked = false;
      const k = 1 - Math.exp(-dt * 3.2);
      c.x += (tx - c.x) * k;
      c.y += (ty - c.y) * k;
      c.d += (td - c.d) * k;
    }
    c.dim += (tdim - c.dim) * (1 - Math.exp(-dt * 4));
    c.intro += (1 - c.intro) * (1 - Math.exp(-dt * 5));

    // pixels → world units at the z = 0 plane
    g.position.set((c.x / w - 0.5) * viewport.width, -(c.y / h - 0.5) * viewport.height, 0);
    // a gear shift gives the rotor a short punch in scale and a flare of light
    if (scene.shift !== c.lastShift) {
      c.lastShift = scene.shift;
      c.flash = scene.shiftUp ? 1 : 0.45;
    }
    c.flash *= Math.exp(-dt * 4.2);
    const scale = (((c.d / h) * viewport.height) / 2 / R_TIP) * c.intro * (1 + c.flash * 0.05);
    g.scale.setScalar(scale);

    // lean toward the cursor (ghost positions only; the hero rotor stays face-on)
    const k2 = 1 - Math.exp(-dt * 5);
    const lean = hero ? 0 : 1;
    c.rx += (trx + scene.py * 0.22 * lean - c.rx) * k2;
    c.ry += (tryy + scene.px * 0.32 * lean - c.ry) * k2;
    g.rotation.set(c.rx, c.ry, 0);

    // spin: idle + scroll speed; runs up on the dyno, stalls at the crash. In the hero it follows the
    // tach needle (scene.rpm), so it revs, drops on each shift and bounces off the limiter.
    const revs = Math.max(0, scene.rpm - scene.idle) / Math.max(1, 100 - scene.idle);
    let target = 0.45 + Math.min(Math.abs(scene.v) * 0.11, 9);
    if (id === "dyno") target += 2.2;
    if (id === "crash") target = Math.min(target, 0.1);
    if (hero) target += revs * 17;
    c.omega += (target - c.omega) * (1 - Math.exp(-dt * (hero ? 6 : 1.8)));
    r.rotation.z -= c.omega * dt;

    // dim INSIDE WebGL: the layer is screen-blended, so less light = more transparent. (A fractional
    // CSS opacity on the canvas layer blanked the whole page in the embedded browser — never use it.)
    const shown = Math.round(c.dim * 200) / 200;
    if (shown !== c.shown) {
      c.shown = shown;
      if (ambient.current) ambient.current.intensity = LIGHT.ambient * shown;
      if (key.current) key.current.intensity = LIGHT.key * shown;
      if (rim.current) rim.current.intensity = LIGHT.rim * shown;
      if (mats.current) {
        mats.current.livery.envMapIntensity = LIGHT.env * shown;
        mats.current.steel.envMapIntensity = LIGHT.env * 1.2 * shown;
      }
    }
    // the livery glows hotter with the revs and flares on a shift
    if (glow.current) glow.current.emissiveIntensity = (LIGHT.glow + (hero ? revs * 0.08 : 0) + c.flash * 0.6) * shown;
    // a glint light sweeps around the rotor so the facets catch it one after another
    if (glint.current) {
      const a = c.t * 0.85;
      glint.current.position.set(Math.cos(a) * 6, Math.sin(a) * 6, 3.5);
      const pulse = Math.pow(Math.max(0, Math.sin(c.t * 1.3)), 4);
      glint.current.intensity = LIGHT.glint * shown * (0.25 + 0.75 * pulse + c.flash);
    }
    if (mats.current) {
      const su = mats.current.sparkle.uniforms;
      su.uTime.value = c.t;
      su.uScale.value = scale;
      su.uH.value = h * gl.getPixelRatio();
      su.uFlash.value = c.flash;
      su.uDim.value = shown;
    }
    if (!c.live) {
      c.live = true;
      if (wrap.current) wrap.current.style.opacity = "1";
      const root = document.getElementById("ld-root");
      if (root) root.dataset.gl = "1";
    }

    // measured frame time → step the tier down when it stays slow (throttled tabs are ignored)
    if (rawDt < 0.1 && !document.hidden) {
      c.acc += rawDt;
      c.n += 1;
      if (c.n >= 150) {
        const avg = c.acc / c.n;
        c.acc = 0;
        c.n = 0;
        if (c.warm) {
          c.slow = avg > 0.026 ? c.slow + 1 : 0;
          if (c.slow >= 2) {
            c.slow = 0;
            quality.set(quality.get() === "high" ? "medium" : "low");
          }
        }
        c.warm = true;
      }
    }
  });

  return (
    <>
      <ambientLight ref={ambient} intensity={0} />
      <directionalLight ref={key} position={[3, 4, 6]} intensity={0} color={TOKENS.bone} />
      <directionalLight ref={rim} position={[-5, -2, 3]} intensity={0} color={TOKENS.chartreuse} />
      <directionalLight ref={glint} position={[6, 0, 3.5]} intensity={0} color="#fffdf2" />
      <group ref={group}>
        <group ref={rotor}>
          <instancedMesh ref={blades} args={[parts.blade, parts.livery, BLADES]} frustumCulled={false} />
          <instancedMesh ref={arcs} args={[parts.arc, parts.livery, BLADES]} frustumCulled={false} />
          <mesh geometry={parts.hex} material={parts.livery} rotation={[0, 0, Math.PI / 6]} />
          <mesh geometry={parts.nut} material={parts.steel} rotation={[Math.PI / 2, 0, 0]} />
          <points geometry={parts.sparkleGeo} material={parts.sparkleMat} frustumCulled={false} renderOrder={2} />
        </group>
      </group>
    </>
  );
}

/** If WebGL throws while mounting or rendering, fall back to the static rotor instead of breaking the page. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    quality.set("low");
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function EngineCanvas({ tier }: { tier: Exclude<Quality, "low"> }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return (
    <div className="ld-canvas" aria-hidden>
      <Boundary>
        <Canvas
          flat
          dpr={tier === "high" ? [1, 2] : [1, 1.5]}
          frameloop={hidden ? "never" : "always"}
          gl={{ antialias: tier !== "high", alpha: false, stencil: false, powerPreference: "high-performance" }}
          camera={{ fov: 32, position: [0, 0, 10], near: 0.1, far: 60 }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 1);
            gl.domElement.addEventListener("webglcontextlost", (e) => {
              e.preventDefault();
              quality.set("low");
            });
          }}
        >
          <Rig />
          {tier === "high" && (
            <Suspense fallback={null}>
              <Effects />
            </Suspense>
          )}
        </Canvas>
      </Boundary>
    </div>
  );
}
