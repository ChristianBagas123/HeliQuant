/**
 * The procedural V8, built in plain three.js (no model files, no texture files).
 *
 * Coordinates are the engine frame: crank axis along Z (front = +Z), Y up, the two banks at ±45°.
 * Each inspectable part is made of one or more "pieces". A piece is a wrapper group that the
 * canvas moves along `dir` to explode the engine. Moving parts (crank, pistons, rods, chain,
 * pulleys) are driven by `update(theta)`, where theta is the crank angle in radians.
 *
 * Materials are created per part, so one part can glow or turn to X-ray without touching others.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { PartId } from "./parts";

// ── engine dimensions (engine units; the whole engine is ~30 long) ──
const CYL_R = 1.9;
const SPACING = 4.6;
const BANK_LEN = 20;
const BANK_W = 6.5;
const BANK_DEPTH = 7;
const DECK_Y = 12.6;
const HEAD_H = 1.8;
const COVER_H = 1.3;
const V = Math.PI / 4;
const OFFSET_Z = SPACING / 2; // the right bank is staggered back by half a bore
const CRANK_R = 2.6;
const ROD_LEN = 8.5;
const FRONT_Z = 13.4;
const OFFSETS_L = [0, Math.PI, Math.PI / 2, Math.PI * 1.5];
const OFFSETS_R = [Math.PI / 2, Math.PI * 1.5, Math.PI, 0];

/** the engine's centre (the canvas centres it at the origin) */
export const ENGINE_CENTER = new THREE.Vector3(0, 4.8, 0.8);

type Side = "L" | "R";
const bankAngle = (s: Side) => (s === "L" ? V : -V);
const bankZ = (s: Side) => (s === "L" ? 0 : OFFSET_Z);
/** bank-local (lx, ly, lz) → engine frame */
function bankToEngine(s: Side, lx: number, ly: number, lz: number) {
  const a = bankAngle(s);
  return new THREE.Vector3(lx * Math.cos(a) - ly * Math.sin(a), lx * Math.sin(a) + ly * Math.cos(a), lz + bankZ(s));
}
/** bank frame group: children are written in bank-local coordinates */
function bankFrame(s: Side) {
  const g = new THREE.Group();
  g.rotation.z = bankAngle(s);
  g.position.z = bankZ(s);
  return g;
}
/** the outer side of a bank, in bank-local X */
const outer = (s: Side) => (s === "L" ? -1 : 1);

// ═════════════════════════════════ textures ═════════════════════════════════

function carbonTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#121314";
  g.fillRect(0, 0, 256, 256);
  const cell = 32;
  // 2x2 twill: each tow is a shaded strip, alternating direction on the diagonal
  for (let y = 0; y < 256 / cell; y++) {
    for (let x = 0; x < 256 / cell; x++) {
      const horiz = (x + y) % 4 < 2;
      const px = x * cell;
      const py = y * cell;
      const grad = horiz ? g.createLinearGradient(px, py, px, py + cell) : g.createLinearGradient(px, py, px + cell, py);
      grad.addColorStop(0, "#0d0e0f");
      grad.addColorStop(0.45, "#3a3d42");
      grad.addColorStop(0.6, "#2a2c30");
      grad.addColorStop(1, "#0b0c0d");
      g.fillStyle = grad;
      g.fillRect(px + 1, py + 1, cell - 2, cell - 2);
      g.strokeStyle = "rgba(255,255,255,0.05)";
      for (let k = 4; k < cell; k += 6) {
        g.beginPath();
        if (horiz) {
          g.moveTo(px + 2, py + k);
          g.lineTo(px + cell - 2, py + k);
        } else {
          g.moveTo(px + k, py + 2);
          g.lineTo(px + k, py + cell - 2);
        }
        g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(0.55, 0.55);
  return t;
}

function logoTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 160;
  const g = c.getContext("2d")!;
  const probe = document.querySelector(".font-display");
  const family = probe ? getComputedStyle(probe).fontFamily : "sans-serif";
  g.clearRect(0, 0, c.width, c.height);
  g.font = `800 112px ${family}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "18px";
  g.fillStyle = "#c9f24b";
  g.fillText("HELIQUANT", c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(201,242,75,0.28)");
  grad.addColorStop(0.4, "rgba(201,242,75,0.07)");
  grad.addColorStop(1, "rgba(201,242,75,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ═════════════════════════════════ materials ═════════════════════════════════

type Tex = { carbon: THREE.Texture; logo: THREE.Texture };

function materials(tex: Tex) {
  const P = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p);
  return {
    gunmetal: P({ color: "#2e3135", metalness: 0.9, roughness: 0.34, clearcoat: 0.45, clearcoatRoughness: 0.25 }),
    alu: P({ color: "#d9dce0", metalness: 1, roughness: 0.17 }),
    chrome: P({ color: "#f4f4f2", metalness: 1, roughness: 0.06 }),
    steel: P({ color: "#9aa0a7", metalness: 1, roughness: 0.28 }),
    titanium: P({ color: "#868c94", metalness: 1, roughness: 0.22, clearcoat: 0.4 }),
    forged: P({ color: "#cfcbc0", metalness: 0.95, roughness: 0.26 }),
    carbon: P({ color: "#ffffff", map: tex.carbon, metalness: 0.35, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.03 }),
    lime: P({ color: "#c9f24b", metalness: 0.8, roughness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.08 }),
    signal: P({ color: "#ff5a1f", metalness: 0.25, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05 }),
    gold: P({ color: "#d8aa4c", metalness: 1, roughness: 0.2 }),
    satin: P({ color: "#18191b", metalness: 0.5, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    heat: P({ color: "#ffffff", vertexColors: true, metalness: 1, roughness: 0.26, clearcoat: 0.35, clearcoatRoughness: 0.2 }),
    chain: P({ color: "#ffffff", metalness: 1, roughness: 0.3 }),
    logo: new THREE.MeshStandardMaterial({ map: tex.logo, transparent: true, emissive: "#c9f24b", emissiveMap: tex.logo, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
}

// ═════════════════════════════════ geometry helpers ═════════════════════════════════

/** chamfered rectangle (w across X, l along Y) */
function chamferRect(w: number, l: number, c: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + c, -l / 2);
  s.lineTo(w / 2 - c, -l / 2);
  s.lineTo(w / 2, -l / 2 + c);
  s.lineTo(w / 2, l / 2 - c);
  s.lineTo(w / 2 - c, l / 2);
  s.lineTo(-w / 2 + c, l / 2);
  s.lineTo(-w / 2, l / 2 - c);
  s.lineTo(-w / 2, -l / 2 + c);
  s.closePath();
  return s;
}

/** a slab: shape extruded upward. Spans X across, Z along (shape Y → -Z), Y from 0 to h. */
function slab(shape: THREE.Shape, h: number, bevel = 0.18, segs = 3) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 28 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** a gear / sprocket in the XY plane, centred on Z = 0 */
function gearGeom(r: number, teeth: number, depth: number, opts: { root?: number; bore?: number; holes?: number; holeR?: number; holeAt?: number } = {}) {
  const root = opts.root ?? r * 0.86;
  const s = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts: [number, number][] = [
      [root, a],
      [r, a + step * 0.22],
      [r, a + step * 0.48],
      [root, a + step * 0.7],
    ];
    pts.forEach(([rr, aa], k) => {
      const x = Math.cos(aa) * rr;
      const y = Math.sin(aa) * rr;
      if (i === 0 && k === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    });
  }
  s.closePath();
  const bore = new THREE.Path();
  bore.absarc(0, 0, opts.bore ?? r * 0.22, 0, Math.PI * 2, true);
  s.holes.push(bore);
  const n = opts.holes ?? 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const h = new THREE.Path();
    const at = opts.holeAt ?? r * 0.56;
    h.absarc(Math.cos(a) * at, Math.sin(a) * at, opts.holeR ?? r * 0.16, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 20 });
  g.translate(0, 0, -depth / 2);
  return g;
}

function lathe(profile: [number, number][], segs = 48) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segs,
  );
}

const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
};

/** hex bolts as one instanced mesh; each entry: position + the axis the bolt points along */
function bolts(m: THREE.Material, list: { p: THREE.Vector3; axis?: THREE.Vector3 }[], r = 0.2, h = 0.3) {
  const g = new THREE.CylinderGeometry(r, r, h, 6);
  const im = new THREE.InstancedMesh(g, m, list.length);
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const mat = new THREE.Matrix4();
  list.forEach((b, i) => {
    q.setFromUnitVectors(up, (b.axis ?? up).clone().normalize());
    mat.compose(b.p, q, one);
    im.setMatrixAt(i, mat);
  });
  im.castShadow = true;
  return im;
}

/** gradient of heat-tinted titanium along a tube: straw → bronze → violet → blue → steel */
const HEAT: [number, string][] = [
  [0, "#d9b46a"],
  [0.18, "#b9773f"],
  [0.38, "#6b4592"],
  [0.6, "#3c64b0"],
  [0.85, "#8e98a6"],
  [1, "#b4bac2"],
];
function heatColor(t: number, out: THREE.Color) {
  for (let i = 1; i < HEAT.length; i++) {
    if (t <= HEAT[i][0]) {
      const [t0, c0] = HEAT[i - 1];
      const [t1, c1] = HEAT[i];
      return out.set(c0).lerp(new THREE.Color(c1), (t - t0) / (t1 - t0));
    }
  }
  return out.set(HEAT[HEAT.length - 1][1]);
}
/** a tube whose colour runs along its length (t0..t1 of the heat gradient) */
function heatTube(curve: THREE.Curve<THREE.Vector3>, radius: number, t0: number, t1: number, segs = 48) {
  const g = new THREE.TubeGeometry(curve, segs, radius, 14, false);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const colors = new Float32Array(uv.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < uv.count; i++) {
    heatColor(t0 + (t1 - t0) * uv.getX(i), c);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

// ═════════════════════════════════ the engine ═════════════════════════════════

export type Piece = {
  part: PartId;
  wrapper: THREE.Group;
  /** explode direction × distance at full explode */
  dir: THREE.Vector3;
  /** a little spin while parts fly in during assembly */
  spin: THREE.Vector3;
  /** 0..1 stagger in the explode timeline */
  delay: number;
};

export type Engine = {
  root: THREE.Group;
  pieces: Piece[];
  /** each part's materials (for glow and X-ray) */
  mats: Record<PartId, THREE.Material[]>;
  /** local anchor points per part, used for the inspect hotspots: [piece index, local point] */
  hotspots: Record<PartId, { piece: number; at: THREE.Vector3 }[]>;
  update: (theta: number) => void;
  dispose: () => void;
};

export function buildEngine(): Engine {
  const tex: Tex = { carbon: carbonTexture(), logo: logoTexture() };
  const disposables: { dispose: () => void }[] = [tex.carbon, tex.logo];
  const root = new THREE.Group();
  root.position.copy(ENGINE_CENTER).multiplyScalar(-1);
  const pieces: Piece[] = [];
  const mats = {} as Record<PartId, THREE.Material[]>;
  const hotspots = {} as Record<PartId, { piece: number; at: THREE.Vector3 }[]>;

  const partMats = (id: PartId) => {
    const m = materials(tex);
    mats[id] = Object.values(m);
    Object.values(m).forEach((x) => disposables.push(x));
    return m;
  };
  const piece = (part: PartId, dir: THREE.Vector3, delay: number, spin = new THREE.Vector3()) => {
    const wrapper = new THREE.Group();
    wrapper.userData.part = part;
    root.add(wrapper);
    pieces.push({ part, wrapper, dir, spin, delay });
    return wrapper;
  };
  const hot = (part: PartId, at: THREE.Vector3, pieceIndex = pieces.length - 1) => {
    (hotspots[part] ??= []).push({ piece: pieceIndex, at });
  };
  const track = <T extends { dispose: () => void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  const cylZ = (i: number) => (i - 1.5) * SPACING;

  // ── BLOCK: two bored banks, a hollow crankcase, bearing bulkheads, ribs, deck bolts ──
  {
    const M = partMats("block");
    const w = piece("block", new THREE.Vector3(0, 0, 0), 0);
    const bank = chamferRect(BANK_W, BANK_LEN, 1.1);
    for (let i = 0; i < 4; i++) {
      const h = new THREE.Path();
      h.absarc(0, cylZ(i), CYL_R, 0, Math.PI * 2, true);
      bank.holes.push(h);
    }
    const bankG = track(slab(bank, BANK_DEPTH, 0.22));
    bankG.translate(0, DECK_Y - BANK_DEPTH, 0);
    const ribG = track(new THREE.BoxGeometry(0.35, BANK_DEPTH - 1.2, 0.5));
    for (const s of ["L", "R"] as Side[]) {
      const f = bankFrame(s);
      f.add(mesh(bankG, M.gunmetal));
      // cast ribs on the outer wall
      for (let i = 0; i < 5; i++) {
        const rib = mesh(ribG, M.gunmetal);
        rib.position.set(outer(s) * (BANK_W / 2 + 0.25), DECK_Y - BANK_DEPTH / 2 - 0.2, (i - 2) * 4.3);
        f.add(rib);
      }
      // titanium-gold head studs along the outer wall, two per bore
      const list: { p: THREE.Vector3; axis: THREE.Vector3 }[] = [];
      for (let i = 0; i < 4; i++)
        for (const dz of [-1.6, 1.6]) list.push({ p: new THREE.Vector3(outer(s) * (BANK_W / 2 + 0.12), DECK_Y - 0.7, cylZ(i) + dz), axis: new THREE.Vector3(outer(s), 0, 0) });
      const b = bolts(M.gold, list, 0.19, 0.5);
      track(b.geometry);
      f.add(b);
      w.add(f);
    }
    // crankcase: a hollow shell from the bank bottoms down to the pan rail, open at the ends
    const outerP = [
      [-6.6, -1.2],
      [6.6, -1.2],
      [6.6, 1.5],
      [1.7, 6.4],
      [-1.7, 6.4],
      [-6.6, 1.5],
    ];
    const cs = new THREE.Shape();
    outerP.forEach(([x, y], i) => (i ? cs.lineTo(x, y) : cs.moveTo(x, y)));
    cs.closePath();
    const inner = new THREE.Path();
    [
      [-5.9, -1.2],
      [-5.9, 1.25],
      [-1.45, 5.7],
      [1.45, 5.7],
      [5.9, 1.25],
      [5.9, -1.2],
    ].forEach(([x, y], i) => (i ? inner.lineTo(x, y) : inner.moveTo(x, y)));
    inner.closePath();
    cs.holes.push(inner);
    const caseLen = BANK_LEN + OFFSET_Z + 1.4;
    const caseG = track(new THREE.ExtrudeGeometry(cs, { depth: caseLen, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 2 }));
    caseG.translate(0, 0, -BANK_LEN / 2 - 0.7);
    w.add(mesh(caseG, M.gunmetal));
    // main bearing bulkheads with machined bores
    const bulk = new THREE.Shape();
    [
      [-5.9, -1.2],
      [-5.9, 1.25],
      [-1.45, 5.7],
      [1.45, 5.7],
      [5.9, 1.25],
      [5.9, -1.2],
    ].forEach(([x, y], i) => (i ? bulk.lineTo(x, y) : bulk.moveTo(x, y)));
    bulk.closePath();
    const bore = new THREE.Path();
    bore.absarc(0, 0, 1.0, 0, Math.PI * 2, true);
    bulk.holes.push(bore);
    // windows so the throws stay visible
    for (const sx of [-1, 1]) {
      const win = new THREE.Path();
      win.absarc(sx * 3.3, 0.6, 1.3, 0, Math.PI * 2, true);
      bulk.holes.push(win);
    }
    const bulkG = track(new THREE.ExtrudeGeometry(bulk, { depth: 0.45, bevelEnabled: false, curveSegments: 20 }));
    for (let i = 0; i < 5; i++) {
      const b = mesh(bulkG, M.gunmetal);
      b.position.z = -BANK_LEN / 2 + 0.6 + i * ((BANK_LEN + OFFSET_Z - 1.4) / 4) - 0.2;
      w.add(b);
    }
    // the rail the oil pan bolts to
    const railG = track(new THREE.BoxGeometry(13.6, 0.35, caseLen + 0.4));
    const rail = mesh(railG, M.steel);
    rail.position.set(0, -1.25, -BANK_LEN / 2 - 0.9 + (caseLen + 0.4) / 2);
    w.add(rail);
    hot("block", bankToEngine("L", 0, DECK_Y - 2, cylZ(0)));
    hot("block", new THREE.Vector3(6.6, 0.2, 4));
    hot("block", bankToEngine("R", outer("R") * (BANK_W / 2), DECK_Y - 0.6, cylZ(2) + OFFSET_Z));
  }

  // ── HEADS: polished heads, carbon covers with the HELIQUANT script, coil packs, bolts ──
  {
    const M = partMats("heads");
    const headG = track(slab(chamferRect(BANK_W + 0.3, BANK_LEN + 0.4, 0.9), HEAD_H, 0.16));
    const coverG = track(slab(chamferRect(BANK_W - 0.7, BANK_LEN - 0.8, 1.4), COVER_H, 0.45, 5));
    const logoG = track(new THREE.PlaneGeometry(BANK_LEN * 0.62, (BANK_LEN * 0.62 * 160) / 1024));
    const coilG = track(new THREE.CylinderGeometry(0.42, 0.48, 1.3, 20));
    const capG = track(new THREE.TorusGeometry(0.44, 0.09, 10, 28));
    const finG = track(new THREE.BoxGeometry(0.34, 0.12, BANK_LEN - 1.2));
    ["L", "R"].forEach((sRaw, k) => {
      const s = sRaw as Side;
      const axis = bankToEngine(s, 0, 1, 0).sub(bankToEngine(s, 0, 0, 0)).normalize();
      const w = piece("heads", axis.clone().multiplyScalar(7), 0.1 + k * 0.05, new THREE.Vector3(0, 0, s === "L" ? 0.5 : -0.5));
      const f = bankFrame(s);
      const head = mesh(headG, M.alu);
      head.position.y = DECK_Y;
      f.add(head);
      // machined fins on the outer face of the head
      for (let i = 0; i < 3; i++) {
        const fin = mesh(finG, M.alu);
        fin.position.set(outer(s) * (BANK_W / 2 + 0.3), DECK_Y + 0.4 + i * 0.5, 0);
        f.add(fin);
      }
      const cover = mesh(coverG, M.carbon);
      cover.position.y = DECK_Y + HEAD_H + 0.2;
      f.add(cover);
      const logo = new THREE.Mesh(logoG, M.logo);
      logo.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      logo.position.set(outer(s) * -0.2, DECK_Y + HEAD_H + 0.2 + COVER_H + 0.47, 0);
      f.add(logo);
      // coil-on-plug: one coil per cylinder, anodised caps
      for (let i = 0; i < 4; i++) {
        const coil = mesh(coilG, M.satin);
        coil.position.set(-outer(s) * 1.7, DECK_Y + HEAD_H + COVER_H + 0.95, cylZ(i));
        f.add(coil);
        const cap = mesh(capG, M.lime);
        cap.rotation.x = Math.PI / 2;
        cap.position.set(-outer(s) * 1.7, DECK_Y + HEAD_H + COVER_H + 1.6, cylZ(i));
        f.add(cap);
      }
      // cover bolts along the outer edge of the carbon cover
      const list: { p: THREE.Vector3 }[] = [];
      for (let i = 0; i < 6; i++) {
        const z = -BANK_LEN / 2 + 1.8 + i * ((BANK_LEN - 3.6) / 5);
        list.push({ p: new THREE.Vector3(outer(s) * 2.3, DECK_Y + HEAD_H + 0.2 + COVER_H + 0.5, z) });
      }
      const b = bolts(M.gold, list, 0.2, 0.45);
      track(b.geometry);
      f.add(b);
      w.add(f);
      // anatomy order (parts.ts): 1 cover (left), 2 coil (left), 3 head (right bank's outer face)
      if (s === "R") hot("heads", bankToEngine(s, outer(s) * (BANK_W / 2 + 0.3), DECK_Y + 0.9, cylZ(1)));
      else {
        hot("heads", bankToEngine(s, 0, DECK_Y + HEAD_H + COVER_H + 0.5, cylZ(0)));
        hot("heads", bankToEngine(s, -outer(s) * 1.7, DECK_Y + HEAD_H + COVER_H + 1.6, cylZ(3)));
      }
    });
  }

  // ── INTAKE: carbon plenum in the V, eight anodised velocity stacks, chrome runners ──
  {
    const M = partMats("intake");
    const w = piece("intake", new THREE.Vector3(0, 11, 0), 0.05, new THREE.Vector3(0.3, 0, 0));
    const plenumG = track(slab(chamferRect(5.6, BANK_LEN + 1, 1.6), 2.6, 0.4, 5));
    const plenum = mesh(plenumG, M.carbon);
    plenum.position.set(0, 9.3, OFFSET_Z / 2);
    w.add(plenum);
    const stackG = track(lathe([
      [0.6, 0],
      [0.6, 1.1],
      [0.68, 1.55],
      [0.88, 1.95],
      [1.18, 2.15],
      [1.3, 2.12],
      [1.22, 2.0],
      [0.95, 1.86],
      [0.78, 1.5],
      [0.7, 1.05],
      [0.7, 0],
    ]));
    const runnerMat = M.chrome;
    for (const s of ["L", "R"] as Side[]) {
      for (let i = 0; i < 4; i++) {
        const z = cylZ(i) + bankZ(s);
        const x = s === "L" ? -1.4 : 1.4;
        const st = mesh(stackG, M.lime);
        st.position.set(x, 12.15, z);
        w.add(st);
        // runner: plenum side → inner port of the head
        const port = bankToEngine(s, -outer(s) * (BANK_W / 2 + 0.15), DECK_Y + 0.9, cylZ(i));
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x * 1.6, 10.6, z), new THREE.Vector3(x * 2.6, 11.0, z), port]);
        const rg = track(new THREE.TubeGeometry(curve, 16, 0.42, 12, false));
        w.add(mesh(rg, runnerMat));
      }
    }
    // throttle body at the front
    const tbG = track(new THREE.CylinderGeometry(1.15, 1.15, 1.6, 32));
    tbG.rotateX(Math.PI / 2);
    const tb = mesh(tbG, M.steel);
    tb.position.set(0, 10.6, BANK_LEN / 2 + OFFSET_Z / 2 + 1.6);
    w.add(tb);
    const ringG = track(new THREE.TorusGeometry(1.2, 0.14, 12, 40));
    const ring = mesh(ringG, M.lime);
    ring.position.set(0, 10.6, BANK_LEN / 2 + OFFSET_Z / 2 + 2.45);
    w.add(ring);
    hot("intake", new THREE.Vector3(1.4, 14.3, cylZ(1) + OFFSET_Z));
    hot("intake", new THREE.Vector3(0, 12, OFFSET_Z / 2 - 4));
    hot("intake", new THREE.Vector3(0, 10.6, BANK_LEN / 2 + OFFSET_Z / 2 + 2.5));
  }

  // ── PISTONS & RODS (positions solved per frame in update) ──
  const pistons: { side: Side; i: number; offset: number; piston: THREE.Object3D; rod: THREE.Object3D }[] = [];
  {
    const M = partMats("pistons");
    const pistonG = track(lathe([
      [0, -1.15],
      [1.55, -1.2],
      [1.8, -1.08],
      [1.8, 0.5],
      [1.73, 0.56],
      [1.73, 0.66],
      [1.8, 0.71],
      [1.8, 0.82],
      [1.73, 0.87],
      [1.73, 0.97],
      [1.8, 1.02],
      [1.8, 1.12],
      [1.62, 1.26],
      [0.9, 1.33],
      [0, 1.36],
    ]));
    const big = new THREE.CylinderGeometry(0.95, 0.95, 0.7, 24);
    big.rotateX(Math.PI / 2);
    const small = new THREE.CylinderGeometry(0.58, 0.58, 0.7, 20);
    small.rotateX(Math.PI / 2);
    small.translate(0, ROD_LEN, 0);
    const web = new THREE.BoxGeometry(0.22, ROD_LEN - 1.4, 0.5);
    web.translate(0, ROD_LEN / 2, 0);
    const flangeA = new THREE.BoxGeometry(0.7, ROD_LEN - 1.6, 0.14);
    flangeA.translate(0, ROD_LEN / 2, 0.24);
    const flangeB = flangeA.clone();
    flangeB.translate(0, 0, -0.48);
    const rodG = track(mergeGeometries([big, small, web, flangeA, flangeB])!);
    [big, small, web, flangeA, flangeB].forEach((g) => g.dispose());
    const pinG = track(new THREE.CylinderGeometry(0.42, 0.42, 3.2, 16));
    pinG.rotateX(Math.PI / 2);
    for (const s of ["L", "R"] as Side[]) {
      const axis = bankToEngine(s, 0, 1, 0).sub(bankToEngine(s, 0, 0, 0)).normalize();
      const w = piece("pistons", axis.clone().multiplyScalar(4.5), 0.2, new THREE.Vector3(0, 0, s === "L" ? 0.3 : -0.3));
      for (let i = 0; i < 4; i++) {
        const piston = new THREE.Group();
        const body = mesh(pistonG, M.forged);
        piston.add(body);
        const wristPin = mesh(pinG, M.chrome);
        piston.add(wristPin);
        piston.rotation.z = bankAngle(s);
        w.add(piston);
        const rod = mesh(rodG, M.titanium);
        w.add(rod);
        pistons.push({ side: s, i, offset: (s === "L" ? OFFSETS_L : OFFSETS_R)[i], piston, rod });
      }
      hot("pistons", bankToEngine(s, 0, DECK_Y - 1.5, cylZ(s === "L" ? 1 : 2)));
    }
    hot("pistons", new THREE.Vector3(-2.2, 4.4, cylZ(0)), pieces.length - 2);
  }

  // ── CRANKSHAFT: shaft, journals, counterweighted webs, rod pins ──
  let crankGroup: THREE.Group;
  {
    const M = partMats("crank");
    const w = piece("crank", new THREE.Vector3(0, -4.2, 0), 0.25, new THREE.Vector3(0, 0, 0.2));
    crankGroup = new THREE.Group();
    w.add(crankGroup);
    const shaftLen = FRONT_Z + BANK_LEN / 2 + 1.6;
    const shaftG = track(new THREE.CylinderGeometry(0.72, 0.72, shaftLen, 32));
    shaftG.rotateX(Math.PI / 2);
    const shaft = mesh(shaftG, M.chrome);
    shaft.position.z = FRONT_Z - shaftLen / 2 + 0.2;
    crankGroup.add(shaft);
    const cw = new THREE.Shape();
    cw.moveTo(-3.0, 0);
    cw.absarc(0, 0, 3.0, Math.PI, Math.PI * 2, false);
    cw.lineTo(1.05, 0.5);
    cw.lineTo(1.05, CRANK_R);
    cw.absarc(0, CRANK_R, 1.05, 0, Math.PI, false);
    cw.lineTo(-1.05, 0.5);
    cw.closePath();
    const cwG = track(new THREE.ExtrudeGeometry(cw, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2, curveSegments: 24 }));
    cwG.translate(0, 0, -0.25);
    const pinG = track(new THREE.CylinderGeometry(0.62, 0.62, 1.15, 24));
    pinG.rotateX(Math.PI / 2);
    const webs = new THREE.InstancedMesh(cwG, M.steel, 16);
    webs.castShadow = true;
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (const s of ["L", "R"] as Side[]) {
      for (let i = 0; i < 4; i++) {
        const phi = (s === "L" ? OFFSETS_L : OFFSETS_R)[i];
        const z = cylZ(i) + bankZ(s);
        const pin = mesh(pinG, M.chrome);
        pin.position.set(Math.sin(phi) * CRANK_R, Math.cos(phi) * CRANK_R, z);
        crankGroup.add(pin);
        for (const dz of [-0.85, 0.85]) {
          m4.makeRotationZ(-phi).setPosition(0, 0, z + dz);
          webs.setMatrixAt(k++, m4);
        }
      }
    }
    crankGroup.add(webs);
    // rear flange
    const flG = track(new THREE.CylinderGeometry(1.6, 1.6, 0.5, 40));
    flG.rotateX(Math.PI / 2);
    const fl = mesh(flG, M.chrome);
    fl.position.z = -BANK_LEN / 2 - 0.9;
    crankGroup.add(fl);
    hot("crank", new THREE.Vector3(0, -2.6, cylZ(1) + 0.85));
    hot("crank", new THREE.Vector3(0, 0.8, cylZ(3) + 3.6));
  }

  // ── FLYWHEEL ──
  let flywheel: THREE.Object3D;
  {
    const M = partMats("flywheel");
    const w = piece("flywheel", new THREE.Vector3(0, -2, -8), 0.3, new THREE.Vector3(0, 0, 0.6));
    const fw = new THREE.Group();
    fw.position.z = -BANK_LEN / 2 - 1.8;
    const ringG = track(gearGeom(5.3, 48, 0.7, { root: 5.0, bore: 4.6 }));
    fw.add(mesh(ringG, M.chrome));
    const disc = new THREE.Shape();
    disc.absarc(0, 0, 4.7, 0, Math.PI * 2, false);
    const c = new THREE.Path();
    c.absarc(0, 0, 0.9, 0, Math.PI * 2, true);
    disc.holes.push(c);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * 2.9, Math.sin(a) * 2.9, 0.75, 0, Math.PI * 2, true);
      disc.holes.push(h);
    }
    const discG = track(new THREE.ExtrudeGeometry(disc, { depth: 0.55, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2, curveSegments: 48 }));
    discG.translate(0, 0, -0.27);
    fw.add(mesh(discG, M.steel));
    const list = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      return { p: new THREE.Vector3(Math.cos(a) * 1.5, Math.sin(a) * 1.5, -0.4), axis: new THREE.Vector3(0, 0, -1) };
    });
    const b = bolts(M.gold, list, 0.2, 0.4);
    track(b.geometry);
    fw.add(b);
    w.add(fw);
    flywheel = fw;
    hot("flywheel", new THREE.Vector3(0, 5.2, -BANK_LEN / 2 - 1.8));
    hot("flywheel", new THREE.Vector3(2.9, 0, -BANK_LEN / 2 - 2.2));
  }

  // ── TIMING: crank + cam sprockets, idler, a running duplex chain ──
  const CAM = 9.55;
  let crankSprocket: THREE.Object3D, camL: THREE.Object3D, camR: THREE.Object3D, idler: THREE.Object3D;
  let chain: THREE.InstancedMesh;
  const chainTable: { p: THREE.Vector3; q: THREE.Quaternion }[] = [];
  const LINKS = 104;
  {
    const M = partMats("timing");
    const w = piece("timing", new THREE.Vector3(0, 0, 9), 0.15, new THREE.Vector3(0, 0, 0.4));
    const cs = track(gearGeom(1.6, 16, 0.9, { root: 1.36, bore: 0.45 }));
    crankSprocket = mesh(cs, M.chrome);
    crankSprocket.position.set(0, 0, FRONT_Z);
    w.add(crankSprocket);
    const cg = track(gearGeom(2.8, 32, 0.8, { root: 2.55, bore: 0.55, holes: 5, holeR: 0.48, holeAt: 1.55 }));
    camL = mesh(cg, M.chrome);
    camL.position.set(-CAM, CAM, FRONT_Z);
    camR = mesh(cg, M.chrome);
    camR.position.set(CAM, CAM, FRONT_Z);
    w.add(camL, camR);
    // anodised centre caps and cam stubs back into the heads
    const capG = track(new THREE.CylinderGeometry(0.62, 0.62, 1.1, 24));
    capG.rotateX(Math.PI / 2);
    for (const x of [-CAM, CAM]) {
      const cap = mesh(capG, M.lime);
      cap.position.set(x, CAM, FRONT_Z + 0.3);
      w.add(cap);
    }
    const stubG = track(new THREE.CylinderGeometry(0.5, 0.5, 3.6, 20));
    stubG.rotateX(Math.PI / 2);
    const stub = mesh(stubG, M.steel);
    stub.position.set(-CAM, CAM, FRONT_Z - 2);
    w.add(stub);
    const crankCap = mesh(capG, M.lime);
    crankCap.position.set(0, 0, FRONT_Z + 0.3);
    w.add(crankCap);
    const ig = track(gearGeom(1.0, 12, 0.7, { root: 0.84, bore: 0.3 }));
    idler = mesh(ig, M.steel);
    idler.position.set(0, 7.0, FRONT_Z);
    w.add(idler);
    // the chain path hugs the sprockets
    const pts: THREE.Vector3[] = [];
    const arc = (cx: number, cy: number, r: number, degs: number[]) => degs.forEach((d) => pts.push(new THREE.Vector3(cx + Math.cos((d * Math.PI) / 180) * r, cy + Math.sin((d * Math.PI) / 180) * r, FRONT_Z)));
    arc(CAM, CAM, 3.0, [115, 75, 35, -5, -40]);
    arc(0, 0, 1.8, [-15, -55, -90, -125, -165]);
    arc(-CAM, CAM, 3.0, [220, 185, 145, 105, 65]);
    pts.push(new THREE.Vector3(-3.4, 8.9, FRONT_Z), new THREE.Vector3(0, 8.2, FRONT_Z), new THREE.Vector3(3.4, 8.9, FRONT_Z));
    const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
    const N = 1600;
    const bin = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const p = curve.getPointAt(t);
      const tg = curve.getTangentAt(t).normalize();
      const n = new THREE.Vector3().crossVectors(bin, tg).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(n, tg, bin));
      chainTable.push({ p, q });
    }
    const linkG = track(new THREE.BoxGeometry(0.34, 0.62, 0.72));
    chain = new THREE.InstancedMesh(linkG, M.chain, LINKS);
    const steel = new THREE.Color("#8d949c");
    const lime = new THREE.Color("#c9f24b");
    for (let i = 0; i < LINKS; i++) chain.setColorAt(i, i % 13 === 0 ? lime : steel);
    chain.castShadow = true;
    w.add(chain);
    hot("timing", new THREE.Vector3(CAM, CAM, FRONT_Z + 0.5));
    hot("timing", new THREE.Vector3(0, 0, FRONT_Z + 0.6));
    hot("timing", new THREE.Vector3(0, 8.3, FRONT_Z + 0.4));
  }

  // ── ALTERNATOR ──
  let altPulley: THREE.Object3D, altFan: THREE.Object3D;
  {
    const M = partMats("alternator");
    const w = piece("alternator", new THREE.Vector3(-7, 1, 6), 0.35, new THREE.Vector3(0, 0.5, 0));
    const AX = -8.6;
    const AY = 3.0;
    const bodyG = track(new THREE.CylinderGeometry(2.0, 2.0, 3.4, 40));
    bodyG.rotateX(Math.PI / 2);
    const body = mesh(bodyG, M.satin);
    body.position.set(AX, AY, FRONT_Z - 2.6);
    w.add(body);
    const finG = track(new THREE.BoxGeometry(0.22, 0.5, 3.0));
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const fin = mesh(finG, M.alu);
      fin.position.set(AX + Math.cos(a) * 2.1, AY + Math.sin(a) * 2.1, FRONT_Z - 2.6);
      fin.rotation.z = a + Math.PI / 2;
      w.add(fin);
    }
    const pg = track(lathe(
      (() => {
        const p: [number, number][] = [[0.3, -0.6]];
        for (let i = 0; i < 6; i++) p.push([1.15, -0.6 + i * 0.2], [0.98, -0.5 + i * 0.2]);
        p.push([1.15, 0.6], [0.3, 0.6]);
        return p;
      })(),
    ));
    pg.rotateX(Math.PI / 2);
    altPulley = mesh(pg, M.chrome);
    altPulley.position.set(AX, AY, FRONT_Z);
    w.add(altPulley);
    const fan = new THREE.Group();
    const bladeG = track(new THREE.BoxGeometry(0.16, 1.5, 0.5));
    for (let i = 0; i < 10; i++) {
      const b = mesh(bladeG, M.steel);
      const a = (i / 10) * Math.PI * 2;
      b.position.set(Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0);
      b.rotation.set(0, 0.5, a + Math.PI / 2);
      fan.add(b);
    }
    fan.position.set(AX, AY, FRONT_Z - 0.85);
    altFan = fan;
    w.add(fan);
    const brG = track(new THREE.BoxGeometry(1.0, 4.4, 0.5));
    const br = mesh(brG, M.gunmetal);
    br.position.set(AX + 1.8, AY - 1.0, FRONT_Z - 3.6);
    br.rotation.z = 0.9;
    w.add(br);
    hot("alternator", new THREE.Vector3(AX, AY, FRONT_Z + 0.65));
    hot("alternator", new THREE.Vector3(AX, AY + 2.3, FRONT_Z - 2.6));
  }

  // ── OIL FILTER ──
  {
    const M = partMats("filter");
    const w = piece("filter", new THREE.Vector3(6.5, -2.5, 0), 0.4, new THREE.Vector3(0, 0, -0.6));
    const g = new THREE.Group();
    const prof: [number, number][] = [
      [0, -1.75],
      [0.7, -1.78],
      [1.1, -1.66],
      [1.28, -1.35],
      [1.28, 0.4],
    ];
    for (let k = 0; k < 9; k++) prof.push([1.28, 0.45 + k * 0.12], [1.36, 0.5 + k * 0.12]);
    prof.push([1.28, 1.6], [1.2, 1.72], [0, 1.74]);
    const canG = track(lathe(prof, 56));
    g.add(mesh(canG, M.signal));
    const plateG = track(new THREE.CylinderGeometry(1.55, 1.55, 0.36, 6));
    const plate = mesh(plateG, M.chrome);
    plate.position.y = 1.95;
    g.add(plate);
    g.position.set(7.4, 0.4, 3.6);
    g.rotation.z = -Math.PI / 3;
    w.add(g);
    hot("filter", new THREE.Vector3(8.6, -0.3, 3.6));
    hot("filter", new THREE.Vector3(6.2, 1.5, 3.6));
  }

  // ── EXHAUST: four-into-one heat-tinted headers per bank ──
  {
    const M = partMats("exhaust");
    for (const s of ["L", "R"] as Side[]) {
      const sx = s === "L" ? -1 : 1;
      const w = piece("exhaust", new THREE.Vector3(sx * 7.5, -1.5, 0), 0.3, new THREE.Vector3(0, 0, sx * 0.4));
      const collZ0 = -BANK_LEN / 2 + bankZ(s) - 1;
      for (let i = 0; i < 4; i++) {
        const port = bankToEngine(s, outer(s) * (BANK_W / 2 + 0.2), DECK_Y + 0.9, cylZ(i));
        const n = bankToEngine(s, outer(s), 0, 0).sub(bankToEngine(s, 0, 0, 0)).normalize();
        const z = cylZ(i) + bankZ(s);
        const curve = new THREE.CatmullRomCurve3([
          port,
          port.clone().addScaledVector(n, 1.8),
          new THREE.Vector3(sx * 12.0, 4.4, z),
          new THREE.Vector3(sx * 11.6, 2.0, z - 1.2),
          new THREE.Vector3(sx * 11.0, 1.2, THREE.MathUtils.lerp(z - 2.2, collZ0, 0.35)),
        ]);
        const tg = track(heatTube(curve, 0.52, 0, 0.75));
        w.add(mesh(tg, M.heat));
        // port flange
        const flG = track(new THREE.BoxGeometry(1.6, 0.3, 1.6));
        const fl = mesh(flG, M.chrome);
        fl.position.copy(port);
        fl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
        w.add(fl);
      }
      const coll = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx * 11.0, 1.2, cylZ(3) + bankZ(s) - 0.5),
        new THREE.Vector3(sx * 11.0, 1.0, collZ0 + 3),
        new THREE.Vector3(sx * 10.6, 0.2, collZ0 - 1),
        new THREE.Vector3(sx * 9.6, -1.6, collZ0 - 4),
      ]);
      const cg = track(heatTube(coll, 0.9, 0.55, 1, 64));
      w.add(mesh(cg, M.heat));
      const tipG = track(new THREE.TorusGeometry(0.92, 0.12, 12, 36));
      const tip = mesh(tipG, M.chrome);
      tip.position.set(sx * 9.6, -1.6, collZ0 - 4);
      tip.lookAt(sx * 9.0, -2.8, collZ0 - 7);
      w.add(tip);
      hot("exhaust", new THREE.Vector3(sx * 12.0, 4.4, cylZ(1) + bankZ(s)));
      if (s === "L") hot("exhaust", new THREE.Vector3(sx * 11.0, 1.0, 0));
    }
  }

  // ── OIL PAN: baffled sump, cooling fins, gasket flange, gold drain plug ──
  {
    const M = partMats("sump");
    const w = piece("sump", new THREE.Vector3(0, -7, 0), 0.45, new THREE.Vector3(0.2, 0, 0));
    const len = BANK_LEN + OFFSET_Z + 1.6;
    const z0 = -BANK_LEN / 2 - 0.8;
    const pan = new THREE.Shape();
    pan.moveTo(-6.5, -1.5);
    pan.lineTo(6.5, -1.5);
    pan.lineTo(6.2, -2.6);
    pan.quadraticCurveTo(5.4, -4.4, 3.6, -4.6);
    pan.lineTo(-3.6, -4.6);
    pan.quadraticCurveTo(-5.4, -4.4, -6.2, -2.6);
    pan.closePath();
    const panG = track(new THREE.ExtrudeGeometry(pan, { depth: len, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 4, curveSegments: 24 }));
    panG.translate(0, 0, z0);
    w.add(mesh(panG, M.gunmetal));
    const deepG = track(slab(chamferRect(6.4, 9, 1.4), 2.0, 0.35, 4));
    deepG.rotateX(Math.PI);
    const deep = mesh(deepG, M.gunmetal);
    deep.position.set(0, -4.4, -3);
    w.add(deep);
    const finShape = new THREE.Shape();
    finShape.moveTo(-5.6, 0);
    finShape.quadraticCurveTo(-5.2, -2.6, -3.2, -2.9);
    finShape.lineTo(3.2, -2.9);
    finShape.quadraticCurveTo(5.2, -2.6, 5.6, 0);
    finShape.closePath();
    const finG = track(new THREE.ExtrudeGeometry(finShape, { depth: 0.16, bevelEnabled: false, curveSegments: 16 }));
    for (let i = 0; i < 9; i++) {
      const f = mesh(finG, M.alu);
      f.position.set(0, -1.9, z0 + 2 + i * ((len - 4) / 8));
      f.scale.set(1.04, 1, 1);
      w.add(f);
    }
    const flangeG = track(new THREE.BoxGeometry(13.8, 0.32, len + 0.5));
    const flange = mesh(flangeG, M.steel);
    flange.position.set(0, -1.42, z0 + len / 2);
    w.add(flange);
    const list: { p: THREE.Vector3 }[] = [];
    for (let i = 0; i < 9; i++) {
      const z = z0 + 0.8 + i * ((len - 1.6) / 8);
      list.push({ p: new THREE.Vector3(-6.6, -1.2, z) }, { p: new THREE.Vector3(6.6, -1.2, z) });
    }
    const b = bolts(M.gold, list, 0.2, 0.42);
    track(b.geometry);
    w.add(b);
    const plugG = track(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 6));
    const plug = mesh(plugG, M.gold);
    plug.position.set(0, -6.65, -3);
    w.add(plug);
    hot("sump", new THREE.Vector3(5.6, -3.6, 4));
    hot("sump", new THREE.Vector3(0, -6.65, -3));
  }

  // ── kinematics ──
  const tmp = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const mat4 = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const chainLen = chainTable.length;

  const update = (theta: number) => {
    crankGroup.rotation.z = -theta;
    flywheel.rotation.z = -theta;
    crankSprocket.rotation.z = -theta;
    camL.rotation.z = -theta / 2;
    camR.rotation.z = -theta / 2;
    idler.rotation.z = theta * 1.6;
    altPulley.rotation.z = -theta * 2.4; // the pulley's axis is Z (geometry rotated in build)
    altFan.rotation.z = -theta * 2.4;

    for (const p of pistons) {
      const c = theta + p.offset;
      const z = cylZ(p.i) + bankZ(p.side);
      const pin = tmp.set(Math.sin(c) * CRANK_R, Math.cos(c) * CRANK_R, z);
      const a = bankAngle(p.side);
      const lx = pin.x * Math.cos(a) + pin.y * Math.sin(a);
      const ly = -pin.x * Math.sin(a) + pin.y * Math.cos(a);
      const py = ly + Math.sqrt(ROD_LEN * ROD_LEN - lx * lx);
      const wx = -py * Math.sin(a);
      const wy = py * Math.cos(a);
      p.piston.position.set(wx, wy, z);
      p.rod.position.copy(pin);
      dir.set(wx - pin.x, wy - pin.y, 0).normalize();
      p.rod.quaternion.setFromUnitVectors(up, dir);
    }

    // chain: link speed matches the crank sprocket's pitch radius
    const travel = ((theta * 1.8) / 62) % 1;
    for (let i = 0; i < LINKS; i++) {
      let t = i / LINKS - travel;
      t -= Math.floor(t);
      const e = chainTable[Math.floor(t * chainLen) % chainLen];
      mat4.compose(e.p, e.q, one);
      chain.setMatrixAt(i, mat4);
    }
    chain.instanceMatrix.needsUpdate = true;
  };
  update(0);

  return {
    root,
    pieces,
    mats,
    hotspots,
    update,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

/** the floor under the engine: a shadow catcher and a soft chartreuse glow */
export function buildFloor() {
  const g = new THREE.Group();
  const shadowG = new THREE.PlaneGeometry(120, 120);
  const shadowM = new THREE.ShadowMaterial({ opacity: 0.55 });
  const shadow = new THREE.Mesh(shadowG, shadowM);
  shadow.rotation.x = -Math.PI / 2;
  shadow.receiveShadow = true;
  g.add(shadow);
  const tex = glowTexture();
  const glowG = new THREE.PlaneGeometry(52, 52);
  const glowM = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Mesh(glowG, glowM);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  g.add(glow);
  return {
    group: g,
    glow: glowM,
    dispose: () => {
      shadowG.dispose();
      shadowM.dispose();
      glowG.dispose();
      glowM.dispose();
      tex.dispose();
    },
  };
}
