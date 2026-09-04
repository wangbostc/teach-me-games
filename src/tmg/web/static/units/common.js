// Shared geometry vocabulary for every faction's units.
//
// Nine armies need the same body plans over and over -- humanoids, beasts on
// four legs, dragons, serpents, robed casters, flyers -- so they live here,
// parameterized, and each faction module supplies only its own palette and
// the per-unit choices that make its roster distinct. Everything is built
// from Three.js primitives; no models, textures, or sprites are loaded from
// any game.
//
// CONVENTIONS every faction module follows:
//   * Units face -z. board3d.js turns black's pieces 180 degrees.
//   * A unit builder returns { group, height }, where `height` is the
//     nominal body height (top of the head/skull/helm) NOT counting raised
//     weapons, wings, or banners -- the board scales by it, so a pawn's
//     upheld pike must not shrink the pawn.
//   * Materials are passed in explicitly. Never share a material between
//     two pieces: selection highlighting mutates the emissive channel.
import * as THREE from "three";

// Target body height per chess role, in board squares. Shared by board3d.js
// and the preview page so both scale units identically.
// A physical set stands its king about 1.7 squares tall; these run a little
// under that so raised wings and weapons still clear the neighbouring files.
export const ROLE_HEIGHT = { p: 0.64, n: 0.82, b: 0.9, r: 0.76, q: 1.06, k: 1.18 };

// The true top of a built group, for units with no raised weapon or wing to
// discount. Body plans that end in loose geometry (elementals, insects,
// hand-built birds) must measure rather than guess: returning a nominal
// height that doesn't match the geometry silently mis-scales the piece.
export function measuredHeight(group) {
  return new THREE.Box3().setFromObject(group).max.y;
}

export function add(g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  g.add(mesh);
  return mesh;
}

// Build a mirrored pair; `fn(side)` gets -1 then +1.
export function pair(fn) {
  fn(-1);
  fn(1);
}

// ---------------------------------------------------------------------------
// Wings
// ---------------------------------------------------------------------------

// Feathered: leading edge sweeps to the tip, trailing edge returns as a run
// of feather points.
export function featherWing(span, chord) {
  const pts = [
    [0, 0.0], [0.15, 0.22], [0.45, 0.42], [1.0, 0.5],
    [0.88, 0.05], [0.82, 0.2], [0.72, -0.05], [0.64, 0.12], [0.52, -0.1],
    [0.44, 0.05], [0.32, -0.12], [0.24, 0.0], [0.12, -0.1], [0, -0.06],
  ];
  const shape = new THREE.Shape();
  pts.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(x * span, y * chord);
    else shape.lineTo(x * span, y * chord);
  });
  shape.closePath();
  // A thin extrude, not a flat plane: a zero-thickness face lit from behind
  // renders as flat grey.
  return new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
}

// Membranous (bat/dragon): straight finger struts with the membrane scalloped
// back between their tips.
export function batWing(span, chord) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.35 * span, 0.4 * chord);
  shape.lineTo(1.0 * span, 0.46 * chord);
  shape.quadraticCurveTo(0.8 * span, 0.02 * chord, 0.68 * span, 0.16 * chord);
  shape.quadraticCurveTo(0.55 * span, -0.16 * chord, 0.44 * span, 0.02 * chord);
  shape.quadraticCurveTo(0.3 * span, -0.28 * chord, 0.2 * span, -0.08 * chord);
  shape.quadraticCurveTo(0.1 * span, -0.22 * chord, 0, -0.05 * chord);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: false });
}

// Skeletal: bare finger bones with only a tattered scrap of membrane.
export function boneWing(span, chord) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.4 * span, 0.34 * chord);
  shape.lineTo(1.0 * span, 0.4 * chord);
  shape.lineTo(0.85 * span, 0.24 * chord);
  shape.lineTo(0.6 * span, 0.3 * chord);
  shape.lineTo(0.42 * span, 0.1 * chord);
  shape.lineTo(0.22 * span, 0.14 * chord);
  shape.lineTo(0.08 * span, -0.02 * chord);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
}

// Insect: a smooth lanceolate membrane, no feather points, no finger struts.
export function membraneWing(span, chord) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(span * 0.4, chord * 0.5, span, chord * 0.12);
  shape.quadraticCurveTo(span * 0.45, -chord * 0.28, 0, -chord * 0.06);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false });
}

const WING_SHAPES = { feather: featherWing, bat: batWing, bone: boneWing, membrane: membraneWing };

// `lift` raises the wing from horizontal, `sweep` folds it back toward +z.
// YZX order applies the lift first, then the sweep about world up.
export function addWings(g, mat, { x, y, z, span, chord, lift = 0.9, sweep = 0.55, type = "feather" }) {
  const shapeFn = WING_SHAPES[type] || featherWing;
  pair((s) => {
    const wing = new THREE.Mesh(shapeFn(span, chord), mat);
    wing.position.set(s * x, y, z);
    wing.scale.x = s;
    wing.rotation.order = "YZX";
    wing.rotation.set(0, -s * sweep, s * lift);
    g.add(wing);
  });
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

export function hornPair(g, mat, { y, x = 0.06, z = 0, len = 0.1, r = 0.02, spread = 0.4, sweep = -0.2, segments = 6 }) {
  pair((s) => {
    add(g, new THREE.ConeGeometry(r, len, segments), mat, s * x, y, z, sweep, 0, s * spread);
  });
}

// Curled ram/bull horns: a short chain of tapering segments.
export function curlHorns(g, mat, { y, x = 0.09, z = 0, len = 0.09, r = 0.028, links = 3 }) {
  pair((s) => {
    let px = s * x;
    let py = y;
    let pz = z;
    for (let i = 0; i < links; i++) {
      const rr = r * (1 - i * 0.22);
      add(g, new THREE.CylinderGeometry(rr * 0.8, rr, len, 8), mat, px, py, pz, 0, 0, s * (0.9 + i * 0.35));
      px += s * len * 0.72;
      py += len * (0.4 - i * 0.3);
      pz += 0.01;
    }
  });
}

// A row of dorsal spikes along -z..+z.
export function spikeRow(g, mat, { from, to, y, count = 6, len = 0.07, r = 0.02, x = 0 }) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const z = from + (to - from) * t;
    const scale = 1 - Math.abs(t - 0.4) * 0.7;
    add(g, new THREE.ConeGeometry(r, len * scale, 6), mat, x, y, z, -0.25, 0, 0);
  }
}

export function glowEyes(g, mat, { y, x = 0.045, z = -0.09, r = 0.018 }) {
  pair((s) => add(g, new THREE.SphereGeometry(r, 8, 8), mat, s * x, y, z));
}

// A skull: cranium, brow, muzzle and dark sockets.
export function skullHead(g, boneMat, voidMat, { y, r = 0.095, z = 0 }) {
  add(g, new THREE.SphereGeometry(r, 14, 12), boneMat, 0, y, z);
  add(g, new THREE.BoxGeometry(r * 1.5, r * 0.55, r * 0.9), boneMat, 0, y - r * 0.55, z - r * 0.45);
  pair((s) => {
    add(g, new THREE.SphereGeometry(r * 0.3, 8, 8), voidMat, s * r * 0.42, y + r * 0.1, z - r * 0.72);
  });
  add(g, new THREE.BoxGeometry(r * 0.9, r * 0.16, r * 0.1), voidMat, 0, y - r * 0.72, z - r * 0.78);
}

// An exposed ribcage: paired arcs down the torso.
export function ribcage(g, mat, { y, height = 0.3, r = 0.13, count = 4 }) {
  add(g, new THREE.CylinderGeometry(0.022, 0.022, height, 8), mat, 0, y, 0.03);
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const ry = y + height * 0.42 - height * 0.84 * t;
    const rr = r * (1 - Math.abs(t - 0.35) * 0.55);
    add(g, new THREE.TorusGeometry(rr, 0.016, 6, 14, Math.PI), mat, 0, ry, 0, Math.PI / 2, 0, 0);
  }
}

export function tailSpike(g, mat, { x = 0, y, z, len = 0.3, r = 0.05, tilt = -Math.PI / 2.3 }) {
  add(g, new THREE.ConeGeometry(r, len, 8), mat, x, y, z, 0, 0, tilt);
}

// A tapering, drooping tail built from shrinking links.
export function tail(g, mat, { y, z, len = 0.34, r = 0.05, links = 4, droop = 0.35, tipMat = null, tipLen = 0 }) {
  let py = y;
  let pz = z;
  const step = len / links;
  for (let i = 0; i < links; i++) {
    const rr = r * (1 - i / (links + 1));
    add(g, new THREE.CylinderGeometry(rr * 0.8, rr, step * 1.1, 8), mat, 0, py, pz, Math.PI / 2 - droop * (i + 1) * 0.25, 0, 0);
    pz += step * Math.cos(droop * (i + 1) * 0.25);
    py -= step * Math.sin(droop * (i + 1) * 0.25);
  }
  if (tipLen > 0) {
    add(g, new THREE.ConeGeometry(r * 0.6, tipLen, 8), tipMat || mat, 0, py, pz, -1.1, 0, 0);
  }
  // Where the tail ends, for callers that want to cap it themselves.
  return { x: 0, y: py, z: pz };
}

// A rising column of smoke or flame standing in for legs: a flared base
// with a tapering, twisting plume swept up out of it. Stacked flat rings
// were tried first and read as a pile of pancakes.
export function smokeTail(g, mat, { y, r = 0.19, height = 0.34, twists = 2.5 }) {
  add(g, new THREE.ConeGeometry(r, height * 0.55, 16), mat, 0, y + height * 0.27, 0);
  const segs = 40;
  const points = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = t * twists * Math.PI * 2;
    const rad = r * 0.4 * (1 - t * 0.7);
    points.push(new THREE.Vector3(Math.cos(a) * rad, y + height * 0.3 + t * height * 0.75, Math.sin(a) * rad));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  add(g, new THREE.TubeGeometry(curve, segs, r * 0.3, 10, false), mat, 0, 0, 0);
  return y + height;
}

export function banner(g, poleMat, clothMat, { x = 0, y, z = 0, poleLen = 0.5, w = 0.14, h = 0.2 }) {
  add(g, new THREE.CylinderGeometry(0.012, 0.012, poleLen, 8), poleMat, x, y, z);
  add(g, new THREE.BoxGeometry(w, h, 0.008), clothMat, x + w / 2 + 0.01, y + poleLen / 2 - h / 2 - 0.02, z);
}

// ---------------------------------------------------------------------------
// Equipment. All take an x offset -- the hand position on the humanoid,
// nominally +/-0.19..0.26 -- and sit at the humanoid's hand height (0.45).
// ---------------------------------------------------------------------------

export function sword(g, { grip, guard, blade }, x, { length = 0.42, handY = 0.45 } = {}) {
  add(g, new THREE.CylinderGeometry(0.016, 0.016, 0.1, 8), grip, x, handY - 0.03, -0.06);
  add(g, new THREE.SphereGeometry(0.025, 8, 6), guard, x, handY - 0.085, -0.06);
  add(g, new THREE.BoxGeometry(0.13, 0.022, 0.03), guard, x, handY + 0.025, -0.06);
  add(g, new THREE.BoxGeometry(0.036, length, 0.012), blade, x, handY + 0.04 + length / 2, -0.06);
  add(g, new THREE.ConeGeometry(0.018, 0.05, 4), blade, x, handY + 0.04 + length + 0.025, -0.06, 0, Math.PI / 4, 0);
}

export function spear(g, { shaft, head }, x, { length = 1.35, handY = 0.45, z = -0.03 } = {}) {
  add(g, new THREE.CylinderGeometry(0.014, 0.014, length, 8), shaft, x, handY + 0.33, z);
  const tipY = handY + 0.33 + length / 2;
  add(g, new THREE.ConeGeometry(0.035, 0.18, 8), head, x, tipY + 0.09, z);
  add(g, new THREE.BoxGeometry(0.1, 0.02, 0.02), head, x, tipY - 0.01, z);
}

export function axe(g, { shaft, head }, x, { length = 0.7, handY = 0.45, twoBlade = false } = {}) {
  const topY = handY + length / 2;
  add(g, new THREE.CylinderGeometry(0.018, 0.018, length, 8), shaft, x, handY + 0.12, -0.05);
  const bladeY = handY + 0.12 + length / 2 - 0.06;
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, -0.11);
  bladeShape.lineTo(0.2, -0.15);
  bladeShape.quadraticCurveTo(0.26, 0, 0.2, 0.15);
  bladeShape.lineTo(0, 0.11);
  bladeShape.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.022, bevelEnabled: false });
  add(g, bladeGeo, head, x + 0.02, bladeY, -0.06, 0, 0, 0);
  if (twoBlade) {
    const m = add(g, bladeGeo, head, x - 0.02, bladeY, -0.04, 0, Math.PI, 0);
    m.scale.z = 1;
  }
  return topY;
}

export function club(g, { shaft, head }, x, { length = 0.34, handY = 0.45, spiked = false } = {}) {
  add(g, new THREE.CylinderGeometry(0.018, 0.022, length, 8), shaft, x, handY + 0.08, -0.05);
  const bulbY = handY + 0.08 + length / 2 + 0.02;
  add(g, new THREE.DodecahedronGeometry(0.062), head, x, bulbY, -0.05);
  if (spiked) {
    [
      [0, 0.075, 0], [0, -0.075, 0], [0.075, 0, 0], [-0.075, 0, 0], [0, 0, 0.075], [0, 0, -0.075],
    ].forEach(([dx, dy, dz]) => {
      const dir = new THREE.Vector3(dx, dy, dz);
      const spike = add(g, new THREE.ConeGeometry(0.016, 0.05, 6), head, x + dx, bulbY + dy, -0.05 + dz);
      spike.lookAt(new THREE.Vector3(x + dx * 3, bulbY + dy * 3, -0.05 + dz * 3));
      spike.rotateX(Math.PI / 2);
      void dir;
    });
  }
}

export function staff(g, { shaft, orb }, x, { length = 1.1, handY = 0.45, orbR = 0.055, gem = null } = {}) {
  add(g, new THREE.CylinderGeometry(0.015, 0.017, length, 8), shaft, x, handY + 0.22, -0.04);
  const topY = handY + 0.22 + length / 2;
  add(g, new THREE.TorusGeometry(0.045, 0.012, 8, 16), orb, x, topY + 0.02, -0.04, Math.PI / 2, 0, 0);
  add(g, new THREE.OctahedronGeometry(orbR), gem || orb, x, topY + 0.02, -0.04);
  return topY;
}

export function bow(g, { limb, string }, x, { size = 0.28, handY = 0.5 } = {}) {
  add(g, new THREE.TorusGeometry(size, 0.014, 8, 20, Math.PI * 1.15), limb, x, handY, -0.05, 0, Math.PI / 2, -Math.PI * 0.08);
  add(g, new THREE.CylinderGeometry(0.004, 0.004, size * 1.85, 6), string, x + 0.02, handY, -0.05);
}

export function quiver(g, { body, fletch }, { x = -0.16, y = 0.62, z = 0.11 } = {}) {
  add(g, new THREE.CylinderGeometry(0.045, 0.05, 0.22, 10), body, x, y, z, 0.25, 0, 0.3);
  for (let i = 0; i < 3; i++) {
    add(g, new THREE.ConeGeometry(0.016, 0.06, 5), fletch, x + (i - 1) * 0.022, y + 0.15, z + 0.03, 0.25, 0, 0.3);
  }
}

export function scythe(g, { shaft, blade }, x, { length = 1.25, handY = 0.45 } = {}) {
  add(g, new THREE.CylinderGeometry(0.014, 0.014, length, 8), shaft, x, handY + 0.3, -0.04);
  const topY = handY + 0.3 + length / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.3, 0.06, 0.42, -0.16);
  shape.quadraticCurveTo(0.26, 0.0, 0, -0.05);
  shape.closePath();
  add(g, new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false }), blade, x, topY - 0.02, -0.05);
  return topY;
}

export function trident(g, { shaft, head }, x, { length = 1.3, handY = 0.45 } = {}) {
  add(g, new THREE.CylinderGeometry(0.015, 0.015, length, 8), shaft, x, handY + 0.32, -0.04);
  const topY = handY + 0.32 + length / 2;
  [-1, 0, 1].forEach((s) => {
    add(g, new THREE.ConeGeometry(0.022, 0.16, 6), head, x + s * 0.05, topY + 0.08 + (s === 0 ? 0.03 : 0), -0.04);
  });
  add(g, new THREE.BoxGeometry(0.12, 0.02, 0.02), head, x, topY + 0.01, -0.04);
}

export function roundShield(g, { face, rim, boss }, x, { r = 0.12, y = 0.6 } = {}) {
  add(g, new THREE.CylinderGeometry(r, r, 0.025, 18), face, x, y, -0.06, Math.PI / 2, 0, 0);
  add(g, new THREE.TorusGeometry(r, 0.012, 8, 20), rim, x, y, -0.07);
  add(g, new THREE.SphereGeometry(r * 0.25, 8, 6), boss, x, y, -0.08);
}

export function kiteShield(g, { face, device }, x, { y = 0.6, cross = true } = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.13, 0.14);
  shape.lineTo(0.13, 0.14);
  shape.lineTo(0.13, 0.0);
  shape.lineTo(0, -0.27);
  shape.lineTo(-0.13, 0.0);
  shape.closePath();
  add(g, new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false }), face, x, y, -0.06);
  if (cross) {
    add(g, new THREE.BoxGeometry(0.05, 0.3, 0.01), device, x, y - 0.05, -0.066);
    add(g, new THREE.BoxGeometry(0.2, 0.05, 0.01), device, x, y + 0.02, -0.066);
  }
}

export function spikedShield(g, { face, rim, spike }, x, { r = 0.13, y = 0.6 } = {}) {
  add(g, new THREE.CylinderGeometry(r, r * 0.92, 0.03, 8), face, x, y, -0.06, Math.PI / 2, 0, 0);
  add(g, new THREE.TorusGeometry(r, 0.013, 6, 12), rim, x, y, -0.07);
  add(g, new THREE.ConeGeometry(0.026, 0.11, 7), spike, x, y, -0.13, -Math.PI / 2, 0, 0);
}

// ---------------------------------------------------------------------------
// Humanoid -- the workhorse body plan (roughly half of all 54 units).
// ---------------------------------------------------------------------------

// Materials: body (limbs/torso plate or bare hide), skin (face/hands), cloth
// (tabard/surcoat, optional), emblem (device painted on the cloth), accent
// (belt, trim), boot (feet).
//
// Shape knobs: bulk widens the frame; legLen/torsoLen/headR set proportions;
// legs "straight" | "digitigrade" | "mounted" | "none"; head "human" |
// "skull" | "beast" | "bull" | "bird" | "cyclops" | "none"; helm "kettle" |
// "great" | "plume" | "horned" | "hood" | "none"; hunch leans the torso.
export function humanoid({
  body,
  skin: skinMat = null,
  cloth = null,
  emblem = null,
  emblemShape = "bar",
  accent = null,
  boot = null,
  hair: hairMat = null,
  eye = null,
  helm = "none",
  head = "human",
  legs = "straight",
  bulk = 1,
  legLen = 0.4,
  torsoLen = 0.32,
  headR = 0.095,
  hunch = 0,
  arms = 2,
  horns = null,
}) {
  const g = new THREE.Group();
  const w = bulk;
  const bootMat = boot || accent || body;
  const faceMat = skinMat || body;

  const hip = legLen;
  const beltY = hip + 0.05;
  const torsoTop = beltY + torsoLen;
  const shoulderY = torsoTop - 0.02;
  const headY = torsoTop + 0.06 + headR;

  // A rounded boot: a low capsule reads as footwear where a box reads as a
  // brick strapped to the ankle.
  const addBoot = (x, y, z, ry = 0) => {
    const b = add(g, new THREE.CapsuleGeometry(0.038 * w, 0.075, 4, 10), bootMat, x, y, z, Math.PI / 2, ry, 0);
    b.scale.set(1.15, 1, 0.8);
  };
  // Limb segments are capsules, so shoulders, knees and elbows are rounded
  // and a joint sphere is only needed where a real joint bends.
  const limb = (r1, r2, len, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const seg = add(g, new THREE.CapsuleGeometry(Math.max(r1, r2), Math.max(0.02, len - Math.max(r1, r2) * 2), 4, 10), body, x, y, z, rx, ry, rz);
    return seg;
  };

  if (legs === "straight") {
    // Thigh, knee, shin: a leg that could bend, even standing straight.
    pair((s) => {
      const x = s * 0.078 * w;
      limb(0.052 * w, 0.052 * w, legLen * 0.52, x, legLen * 0.74, 0.005);
      add(g, new THREE.SphereGeometry(0.048 * w, 10, 8), body, x, legLen * 0.48, 0.005);
      limb(0.044 * w, 0.044 * w, legLen * 0.5, x, legLen * 0.25, 0);
      addBoot(x, 0.035, -0.025);
    });
  } else if (legs === "digitigrade") {
    // Thigh forward, shin back, foot forward again -- a beast's crouch.
    pair((s) => {
      const x = s * 0.085 * w;
      limb(0.054 * w, 0.054 * w, legLen * 0.55, x, legLen * 0.72, 0.05, 0.5);
      add(g, new THREE.SphereGeometry(0.046 * w, 10, 8), body, x, legLen * 0.47, 0.11);
      limb(0.042 * w, 0.042 * w, legLen * 0.6, x, legLen * 0.32, 0.0, -0.55);
      addBoot(x, 0.03, -0.06);
    });
  } else if (legs === "mounted") {
    // Thigh out across the mount's flank, shin dropping to a stirrup.
    pair((s) => {
      limb(0.052 * w, 0.052 * w, 0.22, s * 0.14 * w, hip - 0.02, -0.04, -0.25, 0, s * 1.15);
      add(g, new THREE.SphereGeometry(0.046 * w, 10, 8), body, s * 0.235 * w, hip - 0.06, -0.05);
      limb(0.044 * w, 0.044 * w, 0.24, s * 0.24 * w, hip - 0.16, -0.02, 0, 0, s * 0.12);
      addBoot(s * 0.25 * w, hip - 0.3, -0.045);
    });
  } else if (legs === "none") {
    add(g, new THREE.ConeGeometry(0.19 * w, legLen + 0.12, 14, 1, true), cloth || body, 0, beltY - (legLen + 0.12) / 2 + 0.02, 0);
  }
  // legs === "bare" adds nothing: the caller is grafting this torso onto a
  // horse's shoulders, a serpent's coil, or a column of smoke.

  // Torso: a lathe-turned trunk -- broad at the chest, drawn in at the waist,
  // flaring again at the hips -- squashed front-to-back so it is deeper than
  // it is wide in neither direction. One shape, no seams; a box torso is the
  // single thing that most made these figures read as toys.
  const trunkH = torsoLen + 0.1;
  const trunkProfile = [
    [0.1, 0],
    [0.14, 0.06],
    [0.125, 0.3],
    [0.135, 0.62],
    [0.15, 0.86],
    [0.135, 1.0],
    [0.06, 1.0],
  ].map(([r, t]) => new THREE.Vector2(r * w, hip + t * trunkH));
  const trunk = add(g, new THREE.LatheGeometry(trunkProfile, 20), body, 0, 0, 0, hunch, 0, 0);
  trunk.scale.z = 0.72;
  if (cloth) {
    // The surcoat wraps the trunk as a slightly larger open lathe, split at
    // the sides by leaving the shape's silhouette a touch wider front and
    // back -- a thin panel floating over each face reads as a sandwich board.
    const coatProfile = [
      [0.12, -0.1],
      [0.15, 0.06],
      [0.135, 0.3],
      [0.142, 0.62],
      [0.152, 0.84],
    ].map(([r, t]) => new THREE.Vector2(r * w + 0.012, hip + t * trunkH));
    const coat = add(g, new THREE.LatheGeometry(coatProfile, 20), cloth, 0, 0, 0, hunch, 0, 0);
    coat.scale.z = 0.76;
    // The device on the surcoat. Defaults to a plain vertical pale: a cross
    // is Castle's own heraldry and must be asked for, not inherited by every
    // army that happens to wear a tabard.
    if (emblem) {
      const ey = beltY + torsoLen / 2;
      // Just proud of the coat's front face (coat radius * its z-squash).
      const ez = -(0.142 * w + 0.012) * 0.76 - 0.008;
      if (emblemShape === "cross") {
        add(g, new THREE.BoxGeometry(0.05, 0.22, 0.02), emblem, 0, ey - 0.02, ez);
        add(g, new THREE.BoxGeometry(0.13, 0.05, 0.02), emblem, 0, ey + 0.03, ez);
      } else if (emblemShape === "chevron") {
        pair((s) => add(g, new THREE.BoxGeometry(0.11, 0.04, 0.02), emblem, s * 0.035, ey, ez, 0, 0, s * 0.7));
      } else if (emblemShape === "diamond") {
        add(g, new THREE.BoxGeometry(0.1, 0.1, 0.02), emblem, 0, ey, ez, 0, 0, Math.PI / 4);
      } else if (emblemShape === "bar") {
        add(g, new THREE.BoxGeometry(0.06, 0.24, 0.02), emblem, 0, ey, ez);
      }
    }
  }
  if (accent) {
    const belt = add(g, new THREE.TorusGeometry(0.135 * w, 0.016, 8, 24), accent, 0, beltY + 0.05, 0, Math.PI / 2, 0, 0);
    belt.scale.z = 0.76;
  }

  // Arms: pauldron, upper arm, elbow, forearm, hand -- hanging with a slight
  // outward angle so they read as arms rather than posts bolted to the sides.
  // A second (lower) pair for many-armed units.
  const armSets = arms >= 4 ? [shoulderY, shoulderY - 0.16] : [shoulderY];
  armSets.forEach((sy, idx) => {
    const scale = idx === 0 ? 1 : 0.85;
    pair((s) => {
      const x = s * 0.165 * w;
      const pad = add(g, new THREE.SphereGeometry(0.078 * w * scale, 12, 10), body, x, sy + 0.05, 0);
      pad.scale.set(1, 0.85, 0.9);
      limb(0.042 * scale, 0.042 * scale, 0.17 * scale, x + s * 0.02, sy - 0.05, 0, 0, 0, s * 0.12);
      add(g, new THREE.SphereGeometry(0.04 * scale, 10, 8), body, x + s * 0.03, sy - 0.14, -0.005);
      limb(0.036 * scale, 0.036 * scale, 0.16 * scale, x + s * 0.035, sy - 0.22, -0.015, -0.12, 0, s * 0.04);
      const hand = add(g, new THREE.SphereGeometry(0.042 * scale, 10, 8), faceMat, x + s * 0.035, sy - 0.3 * scale, -0.025);
      hand.scale.set(0.85, 1, 1.15);
    });
  });

  // Head
  if (head !== "none") {
    add(g, new THREE.CylinderGeometry(0.04, 0.05, 0.06, 8), faceMat, 0, torsoTop + 0.03, 0);
  }
  if (head === "human") {
    add(g, new THREE.SphereGeometry(headR, 14, 10), faceMat, 0, headY, 0);
  } else if (head === "skull") {
    skullHead(g, body, eye || accent || body, { y: headY, r: headR });
  } else if (head === "beast") {
    add(g, new THREE.SphereGeometry(headR, 14, 10), faceMat, 0, headY, 0);
    add(g, new THREE.CylinderGeometry(headR * 0.42, headR * 0.62, headR * 1.25, 10), faceMat, 0, headY - headR * 0.2, -headR * 0.95, Math.PI / 2, 0, 0);
    add(g, new THREE.SphereGeometry(headR * 0.2, 8, 6), accent || body, 0, headY - headR * 0.22, -headR * 1.6);
    pair((s) => add(g, new THREE.ConeGeometry(headR * 0.3, headR * 0.55, 6), faceMat, s * headR * 0.6, headY + headR * 0.8, 0, 0, 0, s * 0.3));
  } else if (head === "bull") {
    add(g, new THREE.SphereGeometry(headR * 1.05, 14, 10), faceMat, 0, headY, 0);
    add(g, new THREE.CylinderGeometry(headR * 0.5, headR * 0.68, headR * 1.1, 10), faceMat, 0, headY - headR * 0.3, -headR * 0.85, Math.PI / 2, 0, 0);
    add(g, new THREE.SphereGeometry(headR * 0.16, 8, 6), accent || body, 0, headY - headR * 0.32, -headR * 1.45);
    curlHorns(g, accent || body, { y: headY + headR * 0.45, x: headR * 0.85, len: headR * 0.8, r: headR * 0.3 });
  } else if (head === "bird") {
    add(g, new THREE.SphereGeometry(headR, 14, 10), faceMat, 0, headY, 0);
    add(g, new THREE.ConeGeometry(headR * 0.4, headR * 1.5, 8), accent || body, 0, headY - headR * 0.1, -headR * 1.1, -Math.PI / 2, 0, 0);
  } else if (head === "cyclops") {
    add(g, new THREE.SphereGeometry(headR * 1.1, 14, 10), faceMat, 0, headY, 0);
    add(g, new THREE.SphereGeometry(headR * 0.34, 12, 10), accent || body, 0, headY + headR * 0.12, -headR * 0.92);
    add(g, new THREE.SphereGeometry(headR * 0.15, 8, 8), eye || body, 0, headY + headR * 0.12, -headR * 1.16);
  }

  if (eye && (head === "human" || head === "beast" || head === "bull")) {
    glowEyes(g, eye, { y: headY + headR * 0.15, x: headR * 0.4, z: -headR * 0.88, r: headR * 0.14 });
  }
  if (horns) hornPair(g, horns.mat || accent || body, { y: headY + headR * 0.7, x: headR * 0.62, len: headR * 0.95, r: headR * 0.22, ...horns });

  // Helms
  const helmMat = accent && helm === "horned" ? body : body;
  if (helm === "kettle") {
    add(g, new THREE.SphereGeometry(headR * 1.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmMat, 0, headY + 0.01, 0);
    add(g, new THREE.CylinderGeometry(headR * 1.72, headR * 1.72, 0.02, 18), helmMat, 0, headY + 0.01, 0);
  } else if (helm === "great") {
    add(g, new THREE.CylinderGeometry(headR * 1.15, headR * 1.15, headR * 2.3, 16), helmMat, 0, headY + 0.03, 0);
    add(g, new THREE.CylinderGeometry(headR * 1.15, headR * 0.95, 0.03, 16), helmMat, 0, headY + 0.15, 0);
    add(g, new THREE.BoxGeometry(0.16, 0.018, 0.02), eye || accent || body, 0, headY + 0.05, -headR * 1.1);
    if (accent) add(g, new THREE.BoxGeometry(0.02, headR * 2.5, 0.006), accent, 0, headY + 0.03, -headR * 1.19);
  } else if (helm === "plume") {
    add(g, new THREE.SphereGeometry(headR * 1.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmMat, 0, headY + 0.01, 0);
    add(g, new THREE.BoxGeometry(0.2, 0.07, 0.02), helmMat, 0, headY - 0.01, -headR * 1.05);
    if (cloth) add(g, new THREE.ConeGeometry(0.03, 0.22, 8), cloth, 0, headY + 0.16, 0.06, 0.7, 0, 0);
  } else if (helm === "horned") {
    add(g, new THREE.SphereGeometry(headR * 1.18, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmMat, 0, headY + 0.01, 0);
    hornPair(g, accent || body, { y: headY + headR * 0.7, x: headR * 1.0, len: headR * 1.3, r: headR * 0.26, spread: 0.8, sweep: -0.35 });
  } else if (helm === "hood") {
    add(g, new THREE.ConeGeometry(headR * 1.45, headR * 2.6, 14), cloth || body, 0, headY + headR * 0.35, 0);
  }

  if (hairMat) {
    add(g, new THREE.SphereGeometry(headR * 1.1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat, 0, headY + 0.015, 0.01);
    add(g, new THREE.BoxGeometry(headR * 1.5, headR * 2.7, 0.05), hairMat, 0, headY - headR * 1.25, 0.09);
  }

  // How far each helm actually rises above the bare crown. Getting this
  // wrong mis-reports the unit's height, and the board scales by height --
  // so an over-estimate silently shrinks the whole piece.
  const HELM_EXTRA = { kettle: 0.25, plume: 0.3, great: 0.75, horned: 1.1, hood: 0.65, none: 0 };
  const helmExtra = headR * (HELM_EXTRA[helm] ?? 0);
  return { group: g, height: headY + headR + helmExtra, headY, shoulderY, hip };
}

// ---------------------------------------------------------------------------
// Quadruped -- horses, wolves, lions, hounds, bulls, reptiles.
// ---------------------------------------------------------------------------

// `head`: "horse" | "wolf" | "lion" | "bull" | "reptile" | "none".
// `heads`: >1 spreads that many necks/heads sideways (Cerberus).
export function quadruped({
  body,
  belly = null,
  mane = null,
  accent = null,
  eye = null,
  hoof = null,
  bodyLen = 0.4,
  bodyR = 0.16,
  legLen = 0.34,
  neckLen = 0.3,
  neckTilt = -0.7,
  head = "horse",
  heads = 1,
  horn = null,
  horns = null,
  digitigrade = false,
  tailStyle = "hair",
  spikes = null,
}) {
  const g = new THREE.Group();
  const bodyY = legLen + bodyR * 0.75;
  const hoofMat = hoof || accent || body;

  // Barrel, narrowed laterally: a plain capsule of radius bodyR is as wide
  // as it is deep, which reads as a sausage or a sheep rather than a horse.
  const barrel = add(g, new THREE.CapsuleGeometry(bodyR, bodyLen, 6, 14), body, 0, bodyY, 0, Math.PI / 2, 0, 0);
  barrel.scale.set(0.78, 1, 0.92);
  if (belly) {
    const b = add(g, new THREE.CapsuleGeometry(bodyR * 0.82, bodyLen * 0.7, 6, 12), belly, 0, bodyY - bodyR * 0.4, 0, Math.PI / 2, 0, 0);
    b.scale.set(0.76, 1, 0.9);
  }
  // Chest and haunches, also flattened, so the silhouette has shoulders and
  // a rump instead of two bulges.
  const chest = add(g, new THREE.SphereGeometry(bodyR * 0.92, 12, 10), body, 0, bodyY + bodyR * 0.06, -bodyLen * 0.46);
  chest.scale.set(0.8, 1, 0.9);
  pair((s) => {
    const h = add(g, new THREE.SphereGeometry(bodyR * 0.66, 12, 10), body, s * bodyR * 0.34, bodyY + bodyR * 0.02, bodyLen * 0.4);
    h.scale.set(0.85, 1, 0.95);
  });

  // Legs, in two tapering segments with a joint -- a single cylinder reads
  // as a table leg.
  const legZ = bodyLen * 0.44;
  const legX = bodyR * 0.52;
  [
    [-legX, -legZ], [legX, -legZ], [-legX, legZ], [legX, legZ],
  ].forEach(([x, z], i) => {
    const hind = i >= 2;
    if (digitigrade && hind) {
      add(g, new THREE.CylinderGeometry(0.036, 0.05, legLen * 0.56, 8), body, x, legLen * 0.72, z + 0.035, 0.5, 0, 0);
      add(g, new THREE.CylinderGeometry(0.026, 0.034, legLen * 0.58, 8), body, x, legLen * 0.32, z - 0.03, -0.55, 0, 0);
      add(g, new THREE.BoxGeometry(0.065, 0.038, 0.12), hoofMat, x, 0.02, z - 0.055);
    } else {
      add(g, new THREE.CylinderGeometry(0.036, 0.048, legLen * 0.52, 8), body, x, legLen * 0.74, z + (hind ? 0.015 : -0.01));
      add(g, new THREE.SphereGeometry(0.034, 8, 6), body, x, legLen * 0.48, z + (hind ? 0.015 : -0.01));
      add(g, new THREE.CylinderGeometry(0.026, 0.032, legLen * 0.5, 8), body, x, legLen * 0.25, z);
      add(g, new THREE.CylinderGeometry(0.038, 0.04, 0.045, 8), hoofMat, x, 0.024, z);
    }
  });

  // Necks and heads. `head: "none"` skips them entirely -- centaurs and
  // griffins graft their own fore-parts onto these shoulders.
  let topY = bodyY + bodyR;
  const headOffsets = head === "none" ? [] : heads === 1 ? [0] : heads === 2 ? [-0.11, 0.11] : [-0.16, 0, 0.16];
  headOffsets.forEach((hx) => {
    const neckBaseY = bodyY + bodyR * 0.5;
    const neckZ = -bodyLen * 0.5;
    add(g, new THREE.CylinderGeometry(bodyR * 0.42, bodyR * 0.66, neckLen, 10), body, hx, neckBaseY + neckLen * 0.42, neckZ - 0.06, neckTilt, 0, 0);
    if (mane) add(g, new THREE.BoxGeometry(0.024, bodyR * 0.4, neckLen * 0.9), mane, hx, neckBaseY + neckLen * 0.52, neckZ - 0.03, neckTilt, 0, 0);
    const hY = neckBaseY + neckLen * 0.78;
    const hZ = neckZ - 0.06 - neckLen * 0.5 * Math.sin(-neckTilt) - 0.06;
    topY = Math.max(topY, hY + 0.12);

    if (head === "horse") {
      // Skull, then a tapering muzzle -- a single box reads as a crate.
      add(g, new THREE.BoxGeometry(0.105, 0.13, 0.16), body, hx, hY, hZ + 0.03, 0.3, 0, 0);
      add(g, new THREE.CylinderGeometry(0.045, 0.058, 0.16, 10), body, hx, hY - 0.055, hZ - 0.08, Math.PI / 2 - 0.25, 0, 0);
      add(g, new THREE.SphereGeometry(0.018, 8, 6), accent || body, hx, hY - 0.09, hZ - 0.15);
      pair((s) => add(g, new THREE.ConeGeometry(0.022, 0.085, 6), body, hx + s * 0.042, hY + 0.09, hZ + 0.06, -0.2, 0, s * 0.2));
      if (eye) glowEyes(g, eye, { y: hY + 0.02, x: 0.05, z: hZ - 0.04, r: 0.016 });
    } else if (head === "wolf" || head === "reptile") {
      add(g, new THREE.SphereGeometry(0.095, 12, 10), body, hx, hY, hZ + 0.02);
      add(g, new THREE.CylinderGeometry(0.04, 0.062, 0.17, 10), body, hx, hY - 0.02, hZ - 0.1, Math.PI / 2, 0, 0);
      add(g, new THREE.SphereGeometry(0.02, 8, 6), accent || body, hx, hY - 0.02, hZ - 0.19);
      if (head === "wolf") pair((s) => add(g, new THREE.ConeGeometry(0.026, 0.08, 6), body, hx + s * 0.05, hY + 0.09, hZ + 0.04, 0, 0, s * 0.25));
      if (head === "reptile") spikeRow(g, accent || body, { from: hZ + 0.06, to: hZ - 0.06, y: hY + 0.08, count: 3, len: 0.045, r: 0.014, x: hx });
      if (eye) glowEyes(g, eye, { y: hY + 0.03, x: 0.045, z: hZ - 0.07, r: 0.017 });
    } else if (head === "lion") {
      add(g, new THREE.SphereGeometry(0.1, 12, 10), body, hx, hY, hZ + 0.02);
      if (mane) add(g, new THREE.TorusGeometry(0.115, 0.045, 8, 16), mane, hx, hY, hZ + 0.05, 0, 0, 0);
      add(g, new THREE.CylinderGeometry(0.045, 0.058, 0.1, 10), body, hx, hY - 0.03, hZ - 0.07, Math.PI / 2, 0, 0);
      add(g, new THREE.SphereGeometry(0.02, 8, 6), accent || body, hx, hY - 0.03, hZ - 0.13);
      if (eye) glowEyes(g, eye, { y: hY + 0.03, x: 0.045, z: hZ - 0.06, r: 0.016 });
    } else if (head === "bull") {
      add(g, new THREE.SphereGeometry(0.105, 12, 10), body, hx, hY, hZ + 0.02);
      add(g, new THREE.CylinderGeometry(0.05, 0.07, 0.12, 10), body, hx, hY - 0.035, hZ - 0.08, Math.PI / 2, 0, 0);
      curlHorns(g, accent || body, { y: hY + 0.06, x: 0.085, z: hZ + 0.02, len: 0.08, r: 0.028 });
      if (eye) glowEyes(g, eye, { y: hY + 0.02, x: 0.05, z: hZ - 0.08, r: 0.018 });
    }
    if (horn) {
      // A single spiral horn (unicorn): stacked tapering links.
      for (let i = 0; i < 4; i++) {
        add(g, new THREE.ConeGeometry(0.022 - i * 0.004, 0.07, 7), horn, hx, hY + 0.11 + i * 0.06, hZ - 0.07 - i * 0.028, -0.4, 0, 0);
      }
      topY = Math.max(topY, hY + 0.4);
    }
    if (horns) hornPair(g, horns.mat || accent || body, { y: hY + 0.08, x: 0.07, z: hZ, len: 0.1, r: 0.024, ...horns });
  });

  if (spikes) spikeRow(g, spikes.mat || accent || body, { from: -bodyLen * 0.35, to: bodyLen * 0.45, y: bodyY + bodyR * 0.95, count: 7, len: 0.075, r: 0.02, ...spikes });

  // Tail
  const tailZ = bodyLen * 0.5 + 0.02;
  if (tailStyle === "hair") {
    add(g, new THREE.CylinderGeometry(0.02, 0.05, 0.32, 8), mane || body, 0, bodyY - 0.06, tailZ + 0.06, -0.5, 0, 0);
  } else if (tailStyle === "lion") {
    add(g, new THREE.CylinderGeometry(0.018, 0.03, 0.3, 8), body, 0, bodyY - 0.02, tailZ + 0.08, 0.9, 0, 0);
    add(g, new THREE.SphereGeometry(0.04, 8, 6), mane || accent || body, 0, bodyY + 0.08, tailZ + 0.2);
  } else if (tailStyle === "reptile") {
    tail(g, body, { y: bodyY - 0.02, z: tailZ, len: 0.4, r: 0.06, links: 4 });
  } else if (tailStyle === "scorpion") {
    // Curls up and over the back, ending in a sting.
    let py = bodyY;
    let pz = tailZ;
    for (let i = 0; i < 4; i++) {
      add(g, new THREE.CylinderGeometry(0.042 - i * 0.006, 0.05 - i * 0.006, 0.11, 8), accent || body, 0, py + 0.06 + i * 0.02, pz, 0.9 - i * 0.5, 0, 0);
      py += 0.09;
      pz -= i * 0.02;
    }
    add(g, new THREE.ConeGeometry(0.028, 0.11, 7), accent || body, 0, py + 0.05, pz - 0.06, -2.2, 0, 0);
    topY = Math.max(topY, py + 0.12);
  }

  return { group: g, height: topY, bodyY, backY: bodyY + bodyR * 0.9 };
}

// ---------------------------------------------------------------------------
// Dragon -- serpentine body, wings, one or more heads.
// ---------------------------------------------------------------------------

// Reared up on its hind legs, not standing four-square: a dragon sprawled
// horizontally is wide and low, which makes a poor chess piece (it swamps
// its square while reading as short). Reared, it is tall and narrow, and the
// wings and raised neck give the king the grandest silhouette on the board.
export function dragon({
  body,
  belly = null,
  wing = null,
  accent = null,
  eye = null,
  bodyLen = 0.42,
  bodyR = 0.15,
  legLen = 0.3,
  neckLen = 0.28,
  heads = 1,
  wingSpan = 0.62,
  wingType = "bat",
  tailLen = 0.42,
  spikes = true,
  skeletal = false,
}) {
  const g = new THREE.Group();
  const wingMat = wing || body;
  const hipY = legLen;
  const lean = -0.16; // the torso tips forward off the hips
  const torsoCY = hipY + bodyLen * 0.48;
  const shoulderY = hipY + bodyLen * 0.92;

  // Hind legs: digitigrade and planted, carrying the whole body.
  pair((s) => {
    add(g, new THREE.CylinderGeometry(0.048, 0.06, legLen * 0.62, 8), body, s * bodyR * 0.72, legLen * 0.7, 0.07, 0.55, 0, 0);
    add(g, new THREE.SphereGeometry(0.045, 8, 6), body, s * bodyR * 0.72, legLen * 0.42, 0.02);
    add(g, new THREE.CylinderGeometry(0.032, 0.044, legLen * 0.58, 8), body, s * bodyR * 0.72, legLen * 0.24, -0.04, -0.5, 0, 0);
    add(g, new THREE.BoxGeometry(0.095, 0.045, 0.16), accent || body, s * bodyR * 0.72, 0.024, -0.09);
  });

  // Torso
  if (skeletal) {
    add(g, new THREE.CylinderGeometry(0.03, 0.03, bodyLen, 8), body, 0, torsoCY, 0, lean, 0, 0);
    ribcage(g, body, { y: torsoCY, height: bodyLen * 0.78, r: bodyR * 0.95, count: 5 });
  } else {
    const torso = add(g, new THREE.CapsuleGeometry(bodyR, bodyLen * 0.7, 6, 14), body, 0, torsoCY, 0, lean, 0, 0);
    torso.scale.set(0.92, 1, 0.82);
    if (belly) {
      const b = add(g, new THREE.CapsuleGeometry(bodyR * 0.7, bodyLen * 0.55, 6, 12), belly, 0, torsoCY - 0.02, -bodyR * 0.42, lean, 0, 0);
      b.scale.set(0.8, 1, 0.6);
    }
  }
  add(g, new THREE.SphereGeometry(bodyR * 0.92, 12, 10), body, 0, shoulderY - 0.05, -0.03);

  // Small forelimbs off the chest.
  pair((s) => {
    add(g, new THREE.CylinderGeometry(0.026, 0.034, bodyLen * 0.34, 8), body, s * bodyR * 0.82, shoulderY - 0.16, -0.07, 0.5, 0, s * 0.4);
    add(g, new THREE.BoxGeometry(0.055, 0.03, 0.08), accent || body, s * bodyR * 1.05, shoulderY - 0.26, -0.12);
  });

  // Necks and heads rising from the shoulders.
  let topY = shoulderY;
  const offsets = heads === 1 ? [0] : heads === 2 ? [-0.1, 0.1] : heads === 3 ? [-0.15, 0, 0.15] : [-0.2, -0.07, 0.07, 0.2];
  const nl = heads > 1 ? neckLen * 0.82 : neckLen;
  offsets.forEach((hx) => {
    const fan = offsets.length > 1 ? hx * 1.5 : 0;
    add(g, new THREE.CylinderGeometry(bodyR * 0.34, bodyR * 0.56, nl, 10), body, hx, shoulderY + nl * 0.4, -0.06, -0.32, 0, -fan);
    const hY = shoulderY + nl * 0.82;
    const hZ = -0.06 - nl * 0.3;
    const hX = hx + fan * 0.22;
    add(g, new THREE.SphereGeometry(0.082, 12, 10), body, hX, hY, hZ + 0.02);
    add(g, new THREE.ConeGeometry(0.058, 0.19, 10), body, hX, hY - 0.02, hZ - 0.1, -Math.PI / 2 + 0.15, 0, 0);
    add(g, new THREE.BoxGeometry(0.048, 0.028, 0.12), accent || body, hX, hY - 0.055, hZ - 0.09);
    hornPair(g, accent || body, { y: hY + 0.055, x: 0.04, z: hZ + 0.05, len: 0.095, r: 0.016, spread: 0.5, sweep: -0.7 });
    if (eye) glowEyes(g, eye, { y: hY + 0.025, x: 0.042, z: hZ - 0.055, r: 0.017 });
    topY = Math.max(topY, hY + 0.1);
  });

  if (spikes && !skeletal) {
    // Along the spine, from the hips up the back of the reared torso.
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      add(
        g,
        new THREE.ConeGeometry(0.02, 0.075 * (1 - t * 0.4), 6),
        accent || body,
        0,
        hipY + bodyLen * 0.15 + t * bodyLen * 0.78,
        bodyR * 0.85 + t * 0.03,
        -0.6,
        0,
        0
      );
    }
  }

  addWings(g, wingMat, {
    x: bodyR * 0.62,
    y: shoulderY - 0.06,
    z: 0.08,
    span: wingSpan,
    chord: wingSpan * 0.55,
    lift: 0.95,
    sweep: 0.5,
    type: wingType,
  });

  // Tail sweeping back and down from the hips -- the third point of balance.
  const tailTip = tail(g, body, { y: hipY + 0.02, z: bodyR * 0.7, len: tailLen, r: bodyR * 0.46, links: 4, droop: 0.55 });

  // bodyY is kept for callers written against the old horizontal dragon.
  return { group: g, height: topY, shoulderY, bodyY: torsoCY, tailTip };
}

// ---------------------------------------------------------------------------
// Serpent lower body -- nagas, medusas, hydras.
// ---------------------------------------------------------------------------

// A coiled snake body: one continuous tapering helix of body segments,
// wound tight and rising to the point where an upright torso sits (returned).
// Stacked torus rings were tried first and read unmistakably as a pile of
// doughnuts -- a real coil has to be one spiralling tube.
export function serpentCoil(g, mat, { accent = null, coils = 2.6, r = 0.26, rise = 0.34, thickness = 0.062, segments = 64 } = {}) {
  // One smooth tube swept along a rising helix. Stacked torus rings read as
  // a pile of doughnuts and a chain of spheres reads as a bunch of grapes;
  // only a continuous swept tube reads as a snake's coiled body.
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * coils * Math.PI * 2;
    const rad = r * (1 - t * 0.82);
    points.push(new THREE.Vector3(Math.cos(angle) * rad, thickness + t * rise, Math.sin(angle) * rad));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  add(g, new THREE.TubeGeometry(curve, segments, thickness, 10, false), mat, 0, 0, 0);
  // A few banded scale rings around the coil for definition.
  if (accent) {
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const band = add(g, new THREE.TorusGeometry(thickness * 1.04, thickness * 0.2, 6, 14), accent, p.x, p.y, p.z);
      band.lookAt(p.clone().add(tan));
    }
  }
  return thickness + rise;
}

// ---------------------------------------------------------------------------
// Robed caster
// ---------------------------------------------------------------------------

// A lathe-turned robe rather than a bare cone: a cone reads as a traffic
// cone, and an open-ended one shows its hollow interior. The profile flares
// from a wide hem to narrow shoulders, and sleeves with visible hands give a
// staff or orb something to actually be held by.
export function robed({ robe, hood = null, trim = null, face = null, sleeve = null, height = 1.0, r = 0.2 }) {
  const g = new THREE.Group();
  const shoulderY = height * 0.66;
  const profile = [
    [r * 1.02, 0],
    [r * 0.99, height * 0.07],
    [r * 0.86, height * 0.24],
    [r * 0.68, height * 0.44],
    [r * 0.57, shoulderY - height * 0.05],
    [r * 0.46, shoulderY],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  add(g, new THREE.LatheGeometry(profile, 22), robe, 0, 0, 0);
  if (trim) add(g, new THREE.TorusGeometry(r * 1.0, 0.014, 8, 26), trim, 0, 0.016, 0, Math.PI / 2, 0, 0);

  // Cowl over the shoulders, then the hood itself.
  add(g, new THREE.SphereGeometry(r * 0.52, 14, 10), robe, 0, shoulderY, 0);
  const hoodMat = hood || robe;
  const hoodY = shoulderY + height * 0.11;
  add(g, new THREE.ConeGeometry(r * 0.52, height * 0.28, 14), hoodMat, 0, hoodY, 0);
  // Whatever sits in the hood's shadow -- a face, a skull, or nothing.
  if (face) add(g, new THREE.SphereGeometry(r * 0.29, 12, 10), face, 0, shoulderY + height * 0.06, -r * 0.24);

  const sleeveMat = sleeve || robe;
  const handY = shoulderY - height * 0.32;
  pair((s) => {
    add(g, new THREE.CylinderGeometry(0.048, 0.062, height * 0.32, 9), sleeveMat, s * r * 0.6, shoulderY - height * 0.15, -0.01, 0, 0, s * 0.14);
    if (face) add(g, new THREE.SphereGeometry(0.04, 8, 6), face, s * r * 0.66, handY, -0.02);
  });
  if (trim) add(g, new THREE.TorusGeometry(r * 0.54, 0.012, 8, 22), trim, 0, shoulderY - 0.015, 0, Math.PI / 2, 0, 0);

  return { group: g, height: hoodY + height * 0.14, handY, shoulderY };
}

// ---------------------------------------------------------------------------
// Elemental -- a core with orbiting shards.
// ---------------------------------------------------------------------------

export function elemental({ core, shard, ring = null, height = 0.9, coreR = 0.2, shards = 6, style = "orb" }) {
  const g = new THREE.Group();
  const cy = height * 0.52;
  if (style === "orb") {
    add(g, new THREE.IcosahedronGeometry(coreR, 0), core, 0, cy, 0);
  } else if (style === "column") {
    add(g, new THREE.ConeGeometry(coreR, height * 0.85, 12), core, 0, height * 0.42, 0);
    add(g, new THREE.ConeGeometry(coreR * 0.62, height * 0.5, 10), shard, 0, height * 0.6, 0);
  } else if (style === "vortex") {
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      add(g, new THREE.TorusGeometry(coreR * (1 - t * 0.5), coreR * 0.14, 8, 18), core, 0, height * 0.22 + t * height * 0.6, 0, Math.PI / 2 + t * 0.4, 0, t * 0.9);
    }
  } else if (style === "rock") {
    add(g, new THREE.DodecahedronGeometry(coreR * 1.1), core, 0, cy, 0);
    pair((s) => add(g, new THREE.DodecahedronGeometry(coreR * 0.5), core, s * coreR * 1.1, cy - coreR * 0.5, 0));
  }
  for (let i = 0; i < shards; i++) {
    const a = (i / shards) * Math.PI * 2;
    const rr = coreR * 1.5;
    add(g, new THREE.TetrahedronGeometry(coreR * 0.3), shard, Math.cos(a) * rr, cy + Math.sin(i * 1.9) * height * 0.22, Math.sin(a) * rr, a, a * 0.5, 0);
  }
  if (ring) add(g, new THREE.TorusGeometry(coreR * 1.7, 0.012, 8, 28), ring, 0, cy, 0, Math.PI / 2 - 0.3, 0, 0);
  return { group: g, height: measuredHeight(g) };
}

// ---------------------------------------------------------------------------
// Insect flyer
// ---------------------------------------------------------------------------

export function insect({ body, accent = null, wing = null, eye = null, height = 0.8, wingSpan = 0.38, segments = 3 }) {
  const g = new THREE.Group();
  const bodyY = height * 0.52;
  for (let i = 0; i < segments; i++) {
    const r = 0.075 - i * 0.012;
    add(g, new THREE.SphereGeometry(r, 10, 8), i === 0 ? accent || body : body, 0, bodyY, 0.06 + i * 0.11);
  }
  add(g, new THREE.CapsuleGeometry(0.085, 0.16, 6, 12), body, 0, bodyY, -0.04, Math.PI / 2, 0, 0);
  add(g, new THREE.SphereGeometry(0.062, 10, 8), accent || body, 0, bodyY + 0.02, -0.17);
  if (eye) glowEyes(g, eye, { y: bodyY + 0.04, x: 0.035, z: -0.21, r: 0.022 });
  pair((s) => {
    add(g, new THREE.ConeGeometry(0.014, 0.09, 5), body, s * 0.03, bodyY + 0.07, -0.2, -0.5, 0, s * 0.4);
    [0, 1, 2].forEach((i) => {
      add(g, new THREE.CylinderGeometry(0.009, 0.011, height * 0.4, 6), body, s * 0.09, bodyY - height * 0.22, -0.06 + i * 0.08, 0, 0, s * 0.5);
    });
  });
  // Two pairs of near-horizontal membranes, swept back. Upright feathered
  // wings on an insect read as palm fronds, not flight.
  const wingMat = wing || accent || body;
  [
    [0.04, 0.42, 0.3],
    [-0.07, 0.2, 0.62],
  ].forEach(([dz, lift, sweep], i) => {
    pair((s) => {
      const w = new THREE.Mesh(membraneWing(wingSpan * (1 - i * 0.18), wingSpan * 0.34), wingMat);
      w.position.set(s * 0.045, bodyY + 0.07 - i * 0.015, dz);
      w.scale.x = s;
      w.rotation.order = "YZX";
      w.rotation.set(0, -s * sweep, s * lift);
      g.add(w);
    });
  });
  return { group: g, height: measuredHeight(g) };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

// Scale a built unit so its nominal height matches a chess role's target,
// then -- if it is still too wide or deep for its square -- shrink it until
// it fits. Height alone is not enough: a dragon with a long body and a wide
// wingspan can match a king's height and still sprawl over its neighbours.
export function fitToRole(built, role, maxExtent = 1.3) {
  const g = built.group;
  const target = ROLE_HEIGHT[role];
  if (target && built.height) g.scale.setScalar(target / built.height);
  let box = new THREE.Box3().setFromObject(g);
  const extent = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  if (extent > maxExtent) {
    g.scale.multiplyScalar(maxExtent / extent);
    box = new THREE.Box3().setFromObject(g);
  }
  // Stand it on its plinth. Body plans that end in loose floating geometry
  // (elementals especially) don't necessarily reach y=0 on their own, and a
  // piece hovering above its own base is the most obvious kind of wrong.
  // The caller adds the plinth height on top of this offset.
  g.position.y -= box.min.y;
  return g;
}
