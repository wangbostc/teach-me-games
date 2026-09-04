// Conflux -- elementals and spirits. The deliberate outlier army: mostly
// non-humanoid, luminous, abstract. Built from the shared body plans in
// common.js (leaning hard on elemental() and humanoid()); nothing is loaded
// from any game or asset pack.
import * as THREE from "three";
import {
  add,
  pair,
  addWings,
  humanoid,
  elemental,
  spikeRow,
  glowEyes,
} from "/static/units/common.js";
import {
  matte,
  glow,
  stone,
  feathers,
  burnishedGold,
} from "/static/units/materials.js";

const PALETTE = {
  paleEther: 0xcfd8e8,
  gold: 0xe0c040,
  airCyan: 0xbfe0ff,
  fireOrange: 0xff8844,
  emberRed: 0xff4a1e,
  earthBrown: 0x8a6a4a,
  rockGrey: 0x7a7a80,
  psychicViolet: 0xdd88ff,
  psychicVioletBright: 0xf0c8ff,
  phoenixFlame: 0xff5a1e,
  spiritWhite: 0xf2f4f8,
};

export const BASE_COLOR = 0x6a6f80;
export const ACCENT_COLOR = PALETTE.gold;
export const UNITS = {
  p: "pixie",
  n: "airelemental",
  b: "fireelemental",
  r: "earthelemental",
  q: "psychicelemental",
  k: "phoenix",
};

// Fresh materials per piece: selection highlighting mutates a piece's
// emissive channel, and shared materials would light up every piece at once.
function makeMats() {
  return {
    ether: matte(PALETTE.paleEther, 0.5),
    etherFeather: feathers(0xeaf0fb),
    gold: burnishedGold(PALETTE.gold),
    sparkle: glow(PALETTE.paleEther, PALETTE.gold, 0.6),
    air: glow(PALETTE.airCyan, PALETTE.airCyan, 0.45),
    airShard: glow(PALETTE.airCyan, PALETTE.spiritWhite, 1.0),
    ember: glow(PALETTE.emberRed, PALETTE.emberRed, 0.6),
    fire: glow(PALETTE.fireOrange, PALETTE.fireOrange, 1.2),
    earthBody: stone(PALETTE.earthBrown),
    rock: stone(PALETTE.rockGrey),
    // Psychic elemental: a dim violet glow for the body, a brighter,
    // paler glow for the head, and a set of fading tones for its hem and
    // halo rings so the whole piece reads as luminous rather than flat.
    violet: glow(PALETTE.psychicViolet, PALETTE.psychicViolet, 0.5),
    violetBright: glow(PALETTE.psychicVioletBright, PALETTE.psychicViolet, 1.2),
    thirdEye: glow(PALETTE.psychicVioletBright, PALETTE.psychicVioletBright, 2.0),
    hemRing0: glow(PALETTE.psychicViolet, PALETTE.psychicViolet, 0.6),
    hemRing1: glow(PALETTE.psychicViolet, PALETTE.psychicViolet, 0.45),
    hemRing2: glow(PALETTE.psychicViolet, PALETTE.psychicViolet, 0.3),
    hemRing3: glow(PALETTE.psychicViolet, PALETTE.psychicViolet, 0.15),
    haloBright: glow(PALETTE.psychicVioletBright, PALETTE.psychicViolet, 1.3),
    haloFaint: glow(PALETTE.psychicViolet, PALETTE.psychicViolet, 0.4),
    psychicOrb: glow(PALETTE.psychicVioletBright, PALETTE.psychicVioletBright, 1.6),
    flame: glow(PALETTE.phoenixFlame, PALETTE.phoenixFlame, 0.9),
    flameBright: glow(0xffcf6b, PALETTE.phoenixFlame, 1.3),
    flameFeather: feathers(0xff7a3a),
  };
}

// p -- a tiny winged sprite. The smallest, slightest piece in the whole
// game: a low-bulk humanoid with a faint glowing spark for jewelry.
function pixie(m) {
  const bulk = 0.6;
  const built = humanoid({
    body: m.ether,
    skin: m.ether,
    accent: m.gold,
    boot: m.ether,
    head: "human",
    legs: "straight",
    bulk,
    legLen: 0.22,
    torsoLen: 0.16,
    headR: 0.058,
  });
  // Wing and hand attachment points scale with bulk (humanoid() places the
  // shoulders at 0.165 * bulk) -- a fixed offset here would float the wings
  // off a body this small.
  addWings(built.group, m.etherFeather, {
    x: 0.09 * bulk,
    y: built.shoulderY + 0.02,
    z: 0.03,
    span: 0.28,
    chord: 0.14,
  });
  add(built.group, new THREE.SphereGeometry(0.018, 8, 8), m.sparkle, 0, built.shoulderY - 0.04, -0.06);
  return built;
}

// n -- a swirling column of stacked rings in air cyan, with white-hot shards
// orbiting it so it reads as living, moving air.
//
// elemental() echoes its `height` input straight back rather than measuring
// the rings it actually built, so the true top is computed by hand here --
// see the report for why. Formula: the topmost ring sits at 0.67 * height,
// tilted just off horizontal, adding roughly 0.35 * coreR of rise.
function airelemental(m) {
  const height = 0.85;
  const coreR = 0.16;
  const built = elemental({ core: m.air, shard: m.airShard, height, coreR, shards: 8, style: "vortex" });
  built.height = 0.67 * height + 0.35 * coreR;
  return built;
}

// b -- a tapering column of flame, brighter at its core, with orbiting
// embers. elemental()'s "column" style tops out at both cones' shared apex,
// roughly 0.85 * height -- see the airelemental comment above for why this
// isn't taken from the function's own return value.
function fireelemental(m) {
  const height = 0.9;
  const coreR = 0.15;
  const built = elemental({ core: m.ember, shard: m.fire, height, coreR, shards: 6, style: "column" });
  built.height = 0.85 * height;
  return built;
}

// r -- a lumpy rock construct: the heaviest, most grounded piece. Little or
// no glow -- the orbiting shards use plain stone instead of an emissive
// material. A few extra boulders are piled on beyond elemental()'s built-in
// core-plus-shoulders pair.
function earthelemental(m) {
  const height = 0.8;
  const coreR = 0.22;
  const built = elemental({ core: m.earthBody, shard: m.rock, height, coreR, shards: 3, style: "rock" });
  const g = built.group;
  const cy = height * 0.52;
  add(g, new THREE.DodecahedronGeometry(coreR * 0.55), m.rock, coreR * 0.3, cy - coreR * 0.85, coreR * 0.35);
  add(g, new THREE.DodecahedronGeometry(coreR * 0.5), m.earthBody, -coreR * 0.4, cy - coreR * 0.95, -coreR * 0.2);
  add(g, new THREE.DodecahedronGeometry(coreR * 0.35), m.rock, 0, cy + coreR * 0.75, -coreR * 0.1);
  // Honest top: elemental("rock")'s core dodecahedron peaks at
  // 0.52 * height + 1.1 * coreR; the extra boulder stacked above the
  // shoulders lands just under that, so a small margin covers both.
  built.height = 0.52 * height + 1.15 * coreR;
  return built;
}

// q -- a luminous humanoid spirit, ethereal and the second-grandest piece.
// legs: "none" gives it a tapering smoke-like base instead of feet; the
// body glows dim violet, the head glows brighter and paler so it is the
// single brightest point, and a third eye, a dissolving hem, and two
// orbiting rings of shards mark it unmistakably as a psychic spirit rather
// than a plain robed cone.
function psychicelemental(m) {
  const legLen = 0.5;
  const torsoLen = 0.34;
  const headR = 0.1;
  const built = humanoid({
    body: m.violet,
    skin: m.violetBright,
    accent: m.gold,
    legs: "none",
    head: "human",
    legLen,
    torsoLen,
    headR,
  });
  const g = built.group;

  // Third eye: the brightest single point, on the forehead -- centered
  // just proud of the head sphere's own surface (distance headR) so it
  // actually protrudes instead of sitting mostly submerged in the head.
  add(g, new THREE.SphereGeometry(0.03, 10, 8), m.thirdEye, 0, built.headY + headR * 0.15, -headR * 1.05);

  // Dissolving hem: humanoid()'s legs:"none" cone tapers linearly from a
  // point at the waist (radius 0) to its widest at the ground (radius
  // 0.19). Four rings trace that exact surface -- r = 0.19 * t at the same
  // t used for y -- each dimmer than the last, so the skirt reads as
  // bands of light fading toward the ground rather than a separate ring
  // floating outside a still-hard cone edge.
  const hip = legLen;
  const beltY = hip + 0.05;
  const hemTopY = beltY + 0.02;
  const hemBottomY = beltY - (legLen + 0.12) + 0.02;
  [m.hemRing0, m.hemRing1, m.hemRing2, m.hemRing3].forEach((mat, i) => {
    const t = (i + 1) / 5;
    const y = hemTopY - (hemTopY - hemBottomY) * t;
    const r = 0.19 * t;
    add(g, new THREE.TorusGeometry(r, 0.014, 8, 20), mat, 0, y, 0, Math.PI / 2, 0, 0);
  });

  // Psychic halo: a crown of shards orbiting at head height, tilted like a
  // floating ring of energy, plus a larger, fainter ring circling the
  // waist.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = 0.25;
    add(g, new THREE.OctahedronGeometry(0.02), m.haloBright, Math.cos(a) * rr, built.headY + Math.sin(a) * rr * 0.15, Math.sin(a) * rr, 0.4, a, 0);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const rr = 0.34;
    add(g, new THREE.OctahedronGeometry(0.026), m.haloFaint, Math.cos(a) * rr, beltY + Math.sin(a) * rr * 0.15, Math.sin(a) * rr, 0.4, a, 0);
  }

  // Arms raised and angled outward as if channelling energy -- extra
  // capsules layered over humanoid()'s own arms, which hang at rest and
  // have no exposed rig to rotate -- with a small glowing orb hovering
  // where the raised hands would meet.
  const armRx = -1.1;
  const armRzMag = 0.5;
  const armLen = 0.24;
  const armR = 0.035;
  const armOriginY = built.shoulderY + 0.05;
  const armOriginZ = -0.05;
  pair((s) => {
    // rz applies before rx under the default XYZ Euler order, so a raised
    // limb's outward lean is -s * armRzMag, not s * armRzMag -- the same
    // sign that reads "outward" for a hanging limb flips once the limb is
    // swung up past horizontal.
    add(g, new THREE.CapsuleGeometry(armR, armLen, 4, 10), m.violet, s * 0.2, armOriginY, armOriginZ, armRx, 0, -s * armRzMag);
  });
  // The orb sits at the hands' tip, found by carrying the capsule's local
  // +Y axis through that same Rz-then-Rx rotation (the x-components cancel
  // between the mirrored left/right arms, so only y and z matter here).
  const armReach = armLen / 2 + armR;
  const armTipY = armOriginY + Math.cos(armRzMag) * Math.cos(armRx) * armReach;
  const armTipZ = armOriginZ + Math.cos(armRzMag) * Math.sin(armRx) * armReach;
  add(g, new THREE.SphereGeometry(0.045, 12, 10), m.psychicOrb, 0, armTipY, armTipZ);

  // Honest top: the head sphere's crown, not the halo rings floating
  // above and around it.
  return { group: g, height: built.height };
}

// k -- a great firebird, built entirely from primitives (no shared body
// plan covers a bird). The brightest, grandest piece in the army: large
// flame-colored feather wings, a crested head with a beak, taloned legs, and
// a long fanned tail of glowing flame cones.
function phoenix(m) {
  const g = new THREE.Group();
  const bodyY = 0.5;

  // Torso and breast.
  add(g, new THREE.CapsuleGeometry(0.14, 0.28, 6, 14), m.flame, 0, bodyY, 0, Math.PI / 2, 0, 0);
  add(g, new THREE.SphereGeometry(0.12, 12, 10), m.flameBright, 0, bodyY + 0.02, -0.14);

  // Neck, head, beak, crest and eyes.
  add(g, new THREE.CylinderGeometry(0.05, 0.08, 0.16, 10), m.flame, 0, bodyY + 0.18, -0.24, -0.55, 0, 0);
  const headY = bodyY + 0.32;
  const headZ = -0.34;
  add(g, new THREE.SphereGeometry(0.09, 14, 10), m.flameBright, 0, headY, headZ);
  add(g, new THREE.ConeGeometry(0.035, 0.14, 8), m.gold, 0, headY - 0.01, headZ - 0.13, -Math.PI / 2, 0, 0);
  spikeRow(g, m.flameBright, { from: headZ + 0.02, to: headZ - 0.06, y: headY + 0.08, count: 4, len: 0.06, r: 0.014 });
  glowEyes(g, m.gold, { y: headY + 0.01, x: 0.04, z: headZ - 0.05, r: 0.014 });

  // Taloned legs.
  pair((s) => {
    add(g, new THREE.CylinderGeometry(0.02, 0.024, 0.22, 8), m.gold, s * 0.06, 0.22, 0.02);
    add(g, new THREE.BoxGeometry(0.05, 0.02, 0.09), m.gold, s * 0.06, 0.1, 0.05);
    [-1, 0, 1].forEach((k) => {
      add(g, new THREE.ConeGeometry(0.012, 0.05, 6), m.gold, s * 0.06 + k * 0.018, 0.06, 0.11, Math.PI / 2, 0, 0);
    });
  });

  // Great flame-colored wings.
  addWings(g, m.flameFeather, { x: 0.14, y: bodyY + 0.05, z: 0.0, span: 0.7, chord: 0.35, lift: 1.0, sweep: 0.4 });

  // A long fanned tail of glowing flame cones, radiating from one point at
  // the tail base -- a tail, so it's excluded from the reported height.
  const tailBaseY = bodyY - 0.02;
  const tailBaseZ = 0.16;
  for (let i = 0; i < 7; i++) {
    const t = (i - 3) / 3;
    const len = 0.42 - Math.abs(t) * 0.1;
    const mat = i % 2 === 0 ? m.flame : m.flameBright;
    add(g, new THREE.ConeGeometry(0.02, len, 8), mat, 0, tailBaseY, tailBaseZ, Math.PI / 2, t * 0.5, 0);
  }

  // Honest top: the head crest's tallest spike clears the bare head sphere
  // by a little over 0.1.
  return { group: g, height: headY + 0.11 };
}

const BUILDERS = { pixie, airelemental, fireelemental, earthelemental, psychicelemental, phoenix };

export function buildUnit(unitKey) {
  const builder = BUILDERS[unitKey] || pixie;
  return builder(makeMats());
}
