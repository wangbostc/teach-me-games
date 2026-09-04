// Fortress -- swamp lizardfolk and the beasts of the mire. Hunched gnoll
// levies, upright lizardman archers, and a menagerie of reptilian and insect
// monstrosities culminating in a four-headed hydra. Built from the shared
// body plans in common.js; nothing is loaded from any game or asset pack.
import * as THREE from "three";
import {
  add,
  humanoid,
  quadruped,
  dragon,
  insect,
  spikeRow,
  club,
  bow,
  quiver,
} from "/static/units/common.js";
import {
  hide,
  matte,
  glow,
  polishedMetal,
  wood,
} from "/static/units/materials.js";

const PALETTE = {
  cyanTeal: 0x1f6b85,
  swampGreen: 0x4a6b3f,
  mudBrown: 0x6b5a3f,
  bone: 0xcfc6a8,
  olive: 0x8a9b5c,
  scaleGreen: 0x3f7a5a,
  gnollFur: 0x9c7a4a,
  venomGreen: 0x9fd14b,
  darkHide: 0x3a3428,
};

export const BASE_COLOR = 0x3a4a3a;
export const ACCENT_COLOR = PALETTE.olive;
export const UNITS = { p: "gnoll", n: "dragonfly", b: "lizardman", r: "gorgon", q: "wyvern", k: "hydra" };

// Fresh materials per piece: selection highlighting mutates a piece's
// emissive channel, and shared materials would light up every piece at once.
function makeMats() {
  return {
    fur: hide(PALETTE.gnollFur),
    scale: hide(PALETTE.scaleGreen),
    mud: hide(PALETTE.mudBrown),
    swamp: hide(PALETTE.swampGreen),
    teal: hide(PALETTE.cyanTeal),
    dark: hide(PALETTE.darkHide),
    bone: matte(PALETTE.bone, 0.55),
    verdigris: polishedMetal(PALETTE.olive, { roughness: 0.6, clearcoat: 0.25 }),
    venom: glow(PALETTE.venomGreen, PALETTE.venomGreen, 1.1),
    wood: wood(0x5a4530, 0x2c2216, { repeat: 2, roughness: 0.7 }),
  };
}

// p -- a hyena-headed brute: hunched, digitigrade, minimally armored. The
// humblest unit in the roster; a club and a bone necklace, nothing more.
function gnoll(m) {
  const bulk = 0.95;
  const built = humanoid({
    body: m.fur,
    skin: m.fur,
    accent: m.bone,
    boot: m.dark,
    head: "beast",
    legs: "digitigrade",
    bulk,
    hunch: 0.3,
    legLen: 0.34,
    torsoLen: 0.28,
    headR: 0.088,
  });
  club(built.group, { shaft: m.wood, head: m.bone }, 0.19 * bulk);
  // A single strand of bone beads at the throat -- the only jewelry it owns.
  add(built.group, new THREE.TorusGeometry(0.065, 0.011, 6, 12), m.bone, 0, built.shoulderY + 0.06, 0.01, Math.PI / 2, 0, 0);
  return built;
}

// n -- a giant swamp dragonfly. insect() handles the segmented abdomen,
// thorax, legs, and both wing pairs; a stinger cone is grafted onto the
// abdomen's tip. insect() echoes its `height` input back verbatim rather
// than measuring the geometry it built, so the true top (the head sphere) is
// computed by hand here -- see the report for why.
function dragonfly(m) {
  const height = 0.72;
  const segments = 4;
  const built = insect({
    body: m.teal,
    accent: m.scale,
    wing: m.scale,
    eye: m.venom,
    height,
    wingSpan: 0.42,
    segments,
  });
  const bodyY = height * 0.52;
  const lastAbdomenZ = 0.06 + (segments - 1) * 0.11;
  add(built.group, new THREE.ConeGeometry(0.016, 0.05, 6), m.scale, 0, bodyY, lastAbdomenZ + 0.05, Math.PI / 2, 0, 0);
  built.height = height * 0.52 + 0.082; // true top: the head sphere's crown
  return built;
}

// b -- a scaled archer. Upright and lean, unlike the gnoll's hunch, with a
// crest of spikes along the skull, a bow, and a quiver.
function lizardman(m) {
  const bulk = 0.9;
  const headR = 0.09;
  const built = humanoid({
    body: m.scale,
    skin: m.scale,
    accent: m.bone,
    boot: m.dark,
    head: "beast",
    legs: "straight",
    bulk,
    legLen: 0.42,
    torsoLen: 0.34,
    headR,
  });
  spikeRow(built.group, m.bone, {
    from: -headR * 0.8,
    to: headR * 0.5,
    y: built.headY + headR * 0.6,
    count: 4,
    len: 0.05,
    r: 0.012,
  });
  bow(built.group, { limb: m.wood, string: m.bone }, 0.19 * bulk, { size: 0.24, handY: 0.5 });
  quiver(built.group, { body: m.dark, fletch: m.bone }, { x: -0.16 * bulk, y: 0.62, z: 0.11 });
  return built;
}

// r -- a heavy, armored bull-headed beast. Broad and squat: the immovable
// piece. Glowing venom eyes are its weapon; verdigris plates down the spine
// stand in for armor. quadruped()'s "bull" head already curls a pair of
// horns from the accent material, so no extra hornPair is added on top of
// it (that would draw a second, overlapping pair at nearly the same spot).
function gorgon(m) {
  return quadruped({
    body: m.mud,
    belly: m.bone,
    accent: m.bone,
    eye: m.venom,
    hoof: m.dark,
    bodyLen: 0.5,
    bodyR: 0.22,
    legLen: 0.24,
    neckLen: 0.22,
    neckTilt: -0.5,
    head: "bull",
    digitigrade: false,
    tailStyle: "reptile",
    spikes: { mat: m.verdigris, count: 6, len: 0.09 },
  });
}

// q -- a lean, winged two-legged reptile (in spirit -- dragon() always
// builds two leg pairs; see the report). Smaller and sleeker than the
// hydra, with a long tail ending in a venomous sting.
function wyvern(m) {
  const bodyLen = 0.4;
  const bodyR = 0.13;
  const tailLen = 0.55;
  const droop = 0.4;
  const links = 4;
  const built = dragon({
    body: m.scale,
    belly: m.bone,
    wing: m.teal,
    accent: m.bone,
    eye: m.venom,
    bodyLen,
    bodyR,
    legLen: 0.22,
    neckLen: 0.3,
    heads: 1,
    wingSpan: 0.6,
    wingType: "bat",
    tailLen,
    spikes: true,
  });
  // dragon()'s internal tail() call doesn't expose a tip cone, so the same
  // drooping-link math is walked here to find where the tail ends and cap
  // it with a stinger (see the report for a suggested tipMat/tipLen option).
  let py = built.bodyY - 0.02;
  let pz = bodyLen * 0.5;
  const step = tailLen / links;
  for (let i = 0; i < links; i++) {
    pz += step * Math.cos(droop * (i + 1) * 0.25);
    py -= step * Math.sin(droop * (i + 1) * 0.25);
  }
  add(built.group, new THREE.ConeGeometry(bodyR * 0.25, 0.15, 8), m.venom, 0, py, pz, -1.1, 0, 0);
  return built;
}

// k -- a four-headed swamp hydra: broad and low rather than tall, so it
// reads as the widest, most alarming silhouette on the board. dragon()'s
// per-head loop applies glowing eyes to every head automatically.
function hydra(m) {
  return dragon({
    body: m.swamp,
    belly: m.bone,
    wing: m.dark,
    accent: m.bone,
    eye: m.venom,
    bodyLen: 0.6,
    bodyR: 0.22,
    legLen: 0.2,
    neckLen: 0.3,
    heads: 4,
    wingSpan: 0.16,
    wingType: "bat",
    tailLen: 0.5,
    spikes: true,
  });
}

const BUILDERS = { gnoll, dragonfly, lizardman, gorgon, wyvern, hydra };

export function buildUnit(unitKey) {
  const builder = BUILDERS[unitKey] || gnoll;
  return builder(makeMats());
}
