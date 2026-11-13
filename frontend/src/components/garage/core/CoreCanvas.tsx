"use client";

/**
 * CoreCanvas — the V8 core's WebGL canvas (lazy chunk; never on the server).
 *
 * Scroll story (core.progress, 0..1 through the pinned section):
 *   0.00–0.30  parts fly in and assemble while the camera closes in
 *   0.30–0.62  the engine runs up and the camera sweeps around it
 *   0.62–0.88  the engine explodes into its parts
 *   0.88–1.00  holds the exploded view, ready to inspect
 * Drag turns the engine (horizontal drags only on touch, so the page still scrolls). Hover lights a
 * part; click inspects it: the camera flies to it, the rest of the engine goes X-ray, the part lifts
 * out and its anatomy hotspots are pinned on screen. The DOM overlay (labels, hotspots) is written
 * directly from the frame loop through `overlay` — no React renders per frame.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { buildEngine, buildFloor, type Engine } from "./model";
import type { PartId } from "./parts";
import { core, coreOverlay, coreUi } from "./store";


// [progress, azimuth, elevation, distance, explode, crank rad/s]
const STORY: [number, number, number, number, number, number][] = [
  [0.0, 0.62, 0.3, 150, 1.8, 2.2],
  [0.3, 0.72, 0.32, 112, 0, 3.0],
  [0.62, -0.95, 0.22, 104, 0, 9.0],
  [0.88, -0.62, 0.38, 142, 1, 2.4],
  [1.0, -0.62, 0.38, 142, 1, 2.4],
];
const smooth = (t: number) => t * t * (3 - 2 * t);
function story(p: number) {
  let i = 0;
  while (i < STORY.length - 2 && p > STORY[i + 1][0]) i++;
  const a = STORY[i];
  const b = STORY[i + 1];
  const t = smooth(THREE.MathUtils.clamp((p - a[0]) / (b[0] - a[0]), 0, 1));
  const lerp = (k: number) => a[k] + (b[k] - a[k]) * t;
  return { az: lerp(1), el: lerp(2), dist: lerp(3), explode: lerp(4), rpm: lerp(5) };
}

const FLOOR_Y = -19.5;
const LIME = new THREE.Color("#c9f24b");

type PieceState = { e: number; center: THREE.Vector3; radius: number };

/** X-ray opacity and glow for one part's materials */
function applyLook(list: THREE.Material[], a: number, g: number) {
  for (const m of list) {
    m.opacity = ((m.userData.baseOpacity as number) ?? 1) * a;
    // the decal material is always transparent; the physical ones switch only while X-rayed
    if (!(m instanceof THREE.MeshPhysicalMaterial)) continue;
    const wantT = a < 0.999;
    if (m.transparent !== wantT) {
      m.transparent = wantT;
      m.needsUpdate = true;
    }
    m.depthWrite = a > 0.5;
    m.emissiveIntensity = g;
  }
}

function partOf(o: THREE.Object3D | null): PartId | null {
  while (o) {
    if (o.userData.part) return o.userData.part as PartId;
    o = o.parent;
  }
  return null;
}

function Rig({ shadows }: { shadows: boolean }) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const turntable = useRef<THREE.Group>(null);
  const floorRef = useRef<THREE.Group>(null);

  // the engine is built and owned by this effect; the frame loop reaches it through `live`
  const live = useRef<{ engine: Engine; floor: ReturnType<typeof buildFloor>; pieces: PieceState[] } | null>(null);
  useLayoutEffect(() => {
    const tt = turntable.current;
    const fg = floorRef.current;
    if (!tt || !fg) return;
    const engine: Engine = buildEngine();
    const floor = buildFloor();
    // every part material can glow chartreuse; base glow is zero
    for (const list of Object.values(engine.mats)) {
      for (const m of list) {
        if (m instanceof THREE.MeshPhysicalMaterial) {
          m.emissive.copy(LIME);
          m.emissiveIntensity = 0;
        }
        m.userData.baseOpacity = m.opacity;
      }
    }
    tt.add(engine.root);
    fg.add(floor.group);
    engine.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(engine.root.matrixWorld).invert();
    const pieces = engine.pieces.map((p) => {
      const box = new THREE.Box3().setFromObject(p.wrapper);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      return { e: core.reduced ? 0 : 1.8, center: sphere.center.applyMatrix4(inv), radius: sphere.radius };
    });
    live.current = { engine, floor, pieces };
    return () => {
      live.current = null;
      tt.remove(engine.root);
      fg.remove(floor.group);
      engine.dispose();
      floor.dispose();
    };
  }, []);

  // studio reflections, generated in code
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.035).texture;
    room.dispose();
    pmrem.dispose();
    const { scene } = get();
    scene.environment = env;
    scene.environmentIntensity = 0.62;
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, get]);

  const st = useRef({ theta: 0, rpm: 2, alpha: {} as Record<string, number>, glow: {} as Record<string, number>, camPos: new THREE.Vector3(0, 30, 90), look: new THREE.Vector3(), focusDir: null as THREE.Vector3 | null, lastSel: null as PartId | null, frames: 0, t: 0 });

  const scratch = useRef({ v: new THREE.Vector3(), w: new THREE.Vector3(), c: new THREE.Vector3(), desired: new THREE.Vector3(), lookDesired: new THREE.Vector3() });

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = st.current;
    const tt = turntable.current;
    const L = live.current;
    if (!tt || !L) return;
    const { engine, floor, pieces: pieceState } = L;
    const camera = state.camera;
    const size = state.size;
    const tmp = scratch.current;
    s.t += dt;
    const ui = coreUi.get();
    const sel = ui.selected;
    const reduced = core.reduced;
    const sto = story(reduced ? 0.45 : core.progress);

    // ── crank ──
    const rpmTarget = sel ? 0.9 : reduced ? 0.8 : sto.rpm;
    s.rpm += (rpmTarget - s.rpm) * (1 - Math.exp(-dt * 2));
    s.theta += s.rpm * dt;
    engine.update(s.theta);

    // ── drag turntable (with inertia) ──
    const d = core.drag;
    d.yaw += d.vel;
    d.vel *= Math.exp(-dt * 4);
    tt.rotation.y = d.yaw + (reduced ? 0 : Math.sin(s.t * 0.25) * 0.04);
    tt.rotation.x = d.pitch;

    // ── explode ──
    const forced = ui.exploded;
    const E = forced === null ? (reduced ? 0 : sto.explode) : forced ? 1 : 0;
    engine.pieces.forEach((p, i) => {
      const ps = pieceState[i];
      const rate = Math.max(1.8, 6 - p.delay * 7);
      ps.e += (E - ps.e) * (1 - Math.exp(-dt * (reduced ? 30 : rate)));
      const lift = sel === p.part && p.dir.lengthSq() > 0 ? 0.35 : 0;
      p.wrapper.position.copy(p.dir).multiplyScalar(ps.e + lift);
      const sp = Math.max(0, ps.e - 1);
      p.wrapper.rotation.set(p.spin.x * sp * 2, p.spin.y * sp * 2, p.spin.z * sp * 2);
    });

    // ── X-ray + glow per part ──
    const hov = ui.hovered;
    for (const id of Object.keys(engine.mats) as PartId[]) {
      const aT = sel && sel !== id ? 0.09 : 1;
      const a = (s.alpha[id] ??= 1) + (aT - (s.alpha[id] ?? 1)) * (1 - Math.exp(-dt * 6));
      s.alpha[id] = a;
      const gT = sel === id ? 0.1 + Math.sin(s.t * 3) * 0.05 : hov === id ? 0.16 : 0;
      const g = (s.glow[id] ??= 0) + (gT - (s.glow[id] ?? 0)) * (1 - Math.exp(-dt * 10));
      s.glow[id] = g;
      applyLook(engine.mats[id], a, g);
    }

    // ── camera ──
    tt.updateMatrixWorld(true);
    let focus: THREE.Vector3 | null = null;
    let radius = 0;
    if (sel) {
      const idx = engine.pieces.map((p, i) => (p.part === sel ? i : -1)).filter((i) => i >= 0);
      const c = tmp.c.set(0, 0, 0);
      for (const i of idx) {
        const p = engine.pieces[i];
        tmp.v.copy(pieceState[i].center).add(p.wrapper.position);
        engine.root.localToWorld(tmp.v);
        c.add(tmp.v);
      }
      c.multiplyScalar(1 / idx.length);
      for (const i of idx) {
        const p = engine.pieces[i];
        tmp.v.copy(pieceState[i].center).add(p.wrapper.position);
        engine.root.localToWorld(tmp.v);
        radius = Math.max(radius, tmp.v.distanceTo(c) + pieceState[i].radius * (idx.length > 1 ? 0.6 : 1));
      }
      focus = c;
      if (s.lastSel !== sel || !s.focusDir) {
        s.focusDir = camera.position.clone().sub(c).normalize();
        s.focusDir.y = Math.max(s.focusDir.y, 0.25);
        s.focusDir.normalize();
        s.lastSel = sel;
      }
    } else {
      s.lastSel = null;
      s.focusDir = null;
    }

    const aspect = size.width / Math.max(1, size.height);
    const fit = aspect < 1 ? 1.45 : 1; // narrow screens need more distance
    if (focus && s.focusDir) {
      const dist = Math.max(26, radius * 3.2 + 10) * fit;
      tmp.desired.copy(focus).addScaledVector(s.focusDir, dist);
      tmp.lookDesired.copy(focus);
      // on wide screens the panel sits on the right: push the part left of centre
      if (aspect >= 1) {
        const right = tmp.w.crossVectors(s.focusDir, camera.up).normalize();
        tmp.lookDesired.addScaledVector(right, -dist * 0.18);
        tmp.desired.addScaledVector(right, -dist * 0.18);
      } else {
        // on phones the sheet covers the lower part of the stage: lift the part into the top half
        tmp.lookDesired.y -= dist * 0.2;
        tmp.desired.y -= dist * 0.2;
      }
    } else {
      const dist = sto.dist * fit;
      tmp.desired.set(Math.sin(sto.az) * Math.cos(sto.el) * dist, Math.sin(sto.el) * dist, Math.cos(sto.az) * Math.cos(sto.el) * dist);
      tmp.desired.x += core.px * 3;
      tmp.desired.y += -core.py * 2;
      tmp.lookDesired.set(0, -2, 0);
    }
    const k = 1 - Math.exp(-dt * (reduced ? 20 : focus ? 3.2 : 4));
    s.camPos.lerp(tmp.desired, k);
    s.look.lerp(tmp.lookDesired, k);
    camera.position.copy(s.camPos);
    camera.lookAt(s.look);

    // floor glow breathes with the revs
    floor.glow.opacity = 0.7 + Math.min(1, s.rpm / 9) * 0.3;

    // ── DOM overlay: hotspots for the selected part ──
    const ov = coreOverlay;
    const spots = sel ? engine.hotspots[sel] ?? [] : [];
    ov.spots.forEach((el, i) => {
      if (!el) return;
      const h = spots[i];
      if (!h) {
        el.style.opacity = "0";
        return;
      }
      tmp.v.copy(h.at).add(engine.pieces[h.piece].wrapper.position);
      engine.root.localToWorld(tmp.v);
      tmp.v.project(camera);
      const x = (tmp.v.x * 0.5 + 0.5) * size.width;
      const y = (-tmp.v.y * 0.5 + 0.5) * size.height;
      const on = tmp.v.z < 1 && Math.abs(tmp.v.x) < 1.1 && Math.abs(tmp.v.y) < 1.1;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = on ? "1" : "0";
      // labels on the right half open leftward so they stay on screen
      const flip = x > size.width * 0.55;
      if ((el.dataset.flip === "1") !== flip) {
        if (flip) el.dataset.flip = "1";
        else delete el.dataset.flip;
      }
    });

    if (s.frames++ === 2) coreUi.set({ ready: true });
  });

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const id = partOf(e.object);
    if (coreUi.get().hovered !== id) coreUi.set({ hovered: id });
    const ov = coreOverlay;
    if (ov.tip && ov.stage) {
      const r = ov.stage.getBoundingClientRect();
      ov.tip.style.transform = `translate(${(e.nativeEvent.clientX - r.left + 16).toFixed(0)}px, ${(e.nativeEvent.clientY - r.top + 14).toFixed(0)}px)`;
    }
    document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    coreUi.set({ hovered: null });
    document.body.style.cursor = "";
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (core.drag.moved) return;
    const id = partOf(e.object);
    if (id) coreUi.set({ selected: coreUi.get().selected === id ? null : id });
  };

  useEffect(() => () => {
    document.body.style.cursor = "";
  }, []);

  return (
    <>
      <color attach="background" args={["#0b0b0b"]} />
      <fog attach="fog" args={["#0b0b0b", 130, 230]} />
      <ambientLight intensity={0.15} />
      <directionalLight
        position={[26, 48, 30]}
        intensity={2.4}
        color="#fff6e8"
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
        shadow-camera-near={10}
        shadow-camera-far={140}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-34, 18, -26]} intensity={1.5} color="#c9f24b" />
      <directionalLight position={[10, -20, 30]} intensity={0.45} color="#ff7a3d" />
      {/* the engine is added to this group by the layout effect; R3F raycasts its children */}
      <group ref={turntable} onPointerMove={onMove} onPointerOut={onOut} onClick={onClick} />
      <group ref={floorRef} position={[0, FLOOR_Y, 0]} />
    </>
  );
}

export default function CoreCanvas({ tier, active }: { tier: "high" | "medium"; active: boolean }) {
  const down = useRef<{ x: number; y: number; id: number } | null>(null);

  return (
    <div
      className="absolute inset-0"
      style={{ touchAction: "pan-y" }}
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        core.drag.moved = false;
      }}
      onPointerMove={(e) => {
        const d = down.current;
        const r = e.currentTarget.getBoundingClientRect();
        core.px = ((e.clientX - r.left) / r.width) * 2 - 1;
        core.py = ((e.clientY - r.top) / r.height) * 2 - 1;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) core.drag.moved = true;
        core.drag.vel = dx * 0.0016;
        core.drag.yaw += dx * 0.006;
        core.drag.pitch = THREE.MathUtils.clamp(core.drag.pitch + dy * 0.003, -0.35, 0.45);
        d.x = e.clientX;
        d.y = e.clientY;
      }}
      onPointerUp={() => {
        down.current = null;
      }}
      onPointerCancel={() => {
        down.current = null;
      }}
      onPointerLeave={() => {
        down.current = null;
        core.px = 0;
        core.py = 0;
      }}
    >
      <Canvas
        shadows={tier === "high"}
        dpr={tier === "high" ? [1, 2] : [1, 1.5]}
        frameloop={active ? "always" : "never"}
        gl={{ antialias: tier !== "high", powerPreference: "high-performance", stencil: false }}
        camera={{ fov: 30, position: [0, 30, 90], near: 1, far: 400 }}
        onCreated={({ gl }) => {
          // the medium tier has no bloom or AO, so it gets a little more exposure
          gl.toneMappingExposure = tier === "high" ? 1.05 : 1.3;
        }}
        onPointerMissed={() => {
          if (!core.drag.moved && coreUi.get().selected) coreUi.set({ selected: null });
        }}
      >
        <Rig shadows={tier === "high"} />
        {tier === "high" && (
          <EffectComposer multisampling={4}>
            <N8AO aoRadius={3} distanceFalloff={1.2} intensity={2.2} quality="medium" halfRes />
            <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.82} luminanceSmoothing={0.2} radius={0.6} />
            <Vignette offset={0.32} darkness={0.62} />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}

